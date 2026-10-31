export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path === '/manifest.json') {
      return new Response(JSON.stringify({
        name: 'AL2100',
        short_name: 'AL2100',
        description: 'Prywatny system operacyjny AI',
        start_url: '/',
        display: 'standalone',
        background_color: '#07070d',
        theme_color: '#00e5ff',
        icons: [{ src: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#0a0a12"/><text x="50" y="64" font-family="sans-serif" font-weight="800" font-size="44" fill="#00e5ff" text-anchor="middle">AL</text></svg>'), sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
      }), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=86400' } });
    }

    if (path === '/sw.js') {
      const sw = `const C='al2100-v1';
self.addEventListener('install',e=>{self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.pathname.startsWith('/api/')||u.pathname.startsWith('/auth/'))return;
  if(e.request.method!=='GET')return;
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{
    if(res.ok&&u.origin===location.origin){const cl=res.clone();caches.open(C).then(c=>c.put(e.request,cl))}
    return res
  }).catch(()=>caches.match('/')))
)});`;
      return new Response(sw, { headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-cache' } });
    }

    if (path === '/auth/github') return handleGithubAuth(request, env);
    if (path === '/auth/github/callback') return handleGithubCallback(request, env);
    if (path === '/auth/logout' && method === 'POST') return handleLogout(request, env);

    if (path.startsWith('/api/')) return handleApi(request, env, ctx, url);

    return env.ASSETS.fetch(request);
  }
};

const cors = { 'Access-Control-Allow-Origin': 'https://al2100.pages.dev', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-CSRF-Token' };

async function handleGithubAuth(request, env) {
  const state = crypto.randomUUID();
  const redirect = `${new URL(request.url).origin}/auth/github/callback`;
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirect)}&state=${state}&scope=read:user`;
  return new Response(null, { status: 302, headers: { Location: authUrl, 'Set-Cookie': `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600` } });
}

async function handleGithubCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookie = request.headers.get('Cookie') || '';
  const savedState = cookie.match(/oauth_state=([^;]+)/)?.[1];
  if (!code || !state || state !== savedState) return new Response('Invalid OAuth state', { status: 400 });
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code })
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return new Response('OAuth failed', { status: 400 });
  const userRes = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'AL2100' } });
  const ghUser = await userRes.json();
  const userId = `u_${ghUser.id}`;
  await env.AL_DB.prepare(`INSERT INTO users (id, github_id, login, name, avatar_url, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(github_id) DO UPDATE SET login=excluded.login, name=excluded.name, avatar_url=excluded.avatar_url`).bind(userId, String(ghUser.id), ghUser.login, ghUser.name || ghUser.login, ghUser.avatar_url, Date.now()).run();
  const sessionId = crypto.randomUUID();
  const csrf = crypto.randomUUID();
  const expires = Date.now() + 30 * 24 * 3600 * 1000;
  await env.AL_DB.prepare(`INSERT INTO sessions (id, user_id, csrf_token, expires_at, created_at) VALUES (?,?,?,?,?)`).bind(sessionId, userId, csrf, expires, Date.now()).run();
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}; csrf=${csrf}; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}`
    }
  });
}

async function handleLogout(request, env) {
  const sid = getCookie(request, 'session');
  if (sid) await env.AL_DB.prepare('DELETE FROM sessions WHERE id=?').bind(sid).run();
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; csrf=; Secure; SameSite=Lax; Path=/; Max-Age=0' } });
}

function getCookie(req, name) {
  const c = req.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

async function getUser(request, env) {
  const sid = getCookie(request, 'session');
  if (!sid) return null;
  const row = await env.AL_DB.prepare(`SELECT s.id as sid, s.csrf_token, s.expires_at, u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?`).bind(sid).first();
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}

async function handleApi(request, env, ctx, url) {
  const path = url.pathname;
  const method = request.method;
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const user = await getUser(request, env);
  if (path === '/api/me') {
    if (!user) return json({ user: null }, 401);
    return json({ user: { id: user.id, login: user.login, name: user.name, avatar_url: user.avatar_url }, csrf: user.csrf_token });
  }
  if (!user) return json({ error: 'Unauthorized' }, 401);
  const csrf = request.headers.get('X-CSRF-Token');
  if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(method) && csrf !== user.csrf_token) return json({ error: 'CSRF token invalid' }, 403);
  const rate = await checkRate(env, user.id);
  if (!rate.ok) return json({ error: 'Rate limit exceeded' }, 429);
  try {
    if (path === '/api/conversations' && method === 'GET') {
      const r = await env.AL_DB.prepare('SELECT * FROM conversations WHERE user_id=? ORDER BY updated_at DESC').bind(user.id).all();
      return json({ conversations: r.results });
    }
    if (path === '/api/conversations' && method === 'POST') {
      const b = await request.json();
      const id = 'c_' + crypto.randomUUID();
      const title = (b.title || 'Nowa rozmowa').slice(0, 80);
      await env.AL_DB.prepare('INSERT INTO conversations (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)').bind(id, user.id, title, Date.now(), Date.now()).run();
      const c = await env.AL_DB.prepare('SELECT * FROM conversations WHERE id=?').bind(id).first();
      return json({ conversation: c });
    }
    const convMatch = path.match(/^\/api\/conversations\/([^/]+)$/);
    if (convMatch) {
      const id = convMatch[1];
      const conv = await env.AL_DB.prepare('SELECT * FROM conversations WHERE id=? AND user_id=?').bind(id, user.id).first();
      if (!conv) return json({ error: 'Not found' }, 404);
      if (method === 'GET') {
        const msgs = await env.AL_DB.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY position ASC').bind(id).all();
        return json({ conversation: conv, messages: msgs.results });
      }
      if (method === 'PATCH') {
        const b = await request.json();
        await env.AL_DB.prepare('UPDATE conversations SET title=?, updated_at=? WHERE id=? AND user_id=?').bind((b.title || conv.title).slice(0, 80), Date.now(), id, user.id).run();
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        await env.AL_DB.prepare('DELETE FROM messages WHERE conversation_id=?').bind(id).run();
        await env.AL_DB.prepare('DELETE FROM conversations WHERE id=? AND user_id=?').bind(id, user.id).run();
        return json({ ok: true });
      }
    }
    const msgMatch = path.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (msgMatch && method === 'POST') {
      const convId = msgMatch[1];
      const conv = await env.AL_DB.prepare('SELECT * FROM conversations WHERE id=? AND user_id=?').bind(convId, user.id).first();
      if (!conv) return json({ error: 'Not found' }, 404);
      const b = await request.json();
      return await streamChat(request, env, user, conv, b);
    }
    const msgIdMatch = path.match(/^\/api\/messages\/([^/]+)$/);
    if (msgIdMatch) {
      const mid = msgIdMatch[1];
      const msg = await env.AL_DB.prepare('SELECT m.*, c.user_id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.id=? AND c.user_id=?').bind(mid, user.id).first();
      if (!msg) return json({ error: 'Not found' }, 404);
      if (method === 'PATCH') {
        const b = await request.json();
        await env.AL_DB.prepare('UPDATE messages SET content=? WHERE id=?').bind(b.content ?? msg.content, mid).run();
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        await env.AL_DB.prepare('DELETE FROM messages WHERE id=?').bind(mid).run();
        return json({ ok: true });
      }
    }
    if (path === '/api/providers' && method === 'GET') {
      const keys = await env.AL_DB.prepare('SELECT provider, model FROM api_keys WHERE user_id=?').bind(user.id).all();
      const map = {};
      keys.results.forEach(k => { map[k.provider] = k.model });
      const providers = PROVIDERS.map(p => ({ id: p.id, name: p.name, configured: !!map[p.id], model: map[p.id] || p.defaultModel }));
      return json({ providers });
    }
    const provKeyMatch = path.match(/^\/api\/providers\/([^/]+)\/key$/);
    if (provKeyMatch) {
      const pid = provKeyMatch[1];
      if (method === 'POST') {
        const b = await request.json();
        if (b.key) {
          const enc = await encrypt(b.key, env.ENCRYPTION_KEY);
          await env.AL_DB.prepare(`INSERT INTO api_keys (id,user_id,provider,encrypted_key,model,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET encrypted_key=excluded.encrypted_key, model=excluded.model, updated_at=excluded.updated_at`).bind('k_' + crypto.randomUUID(), user.id, pid, enc, b.model || null, Date.now(), Date.now()).run();
        } else if (b.model) {
          await env.AL_DB.prepare('UPDATE api_keys SET model=?, updated_at=? WHERE user_id=? AND provider=?').bind(b.model, Date.now(), user.id, pid).run();
        }
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        await env.AL_DB.prepare('DELETE FROM api_keys WHERE user_id=? AND provider=?').bind(user.id, pid).run();
        return json({ ok: true });
      }
    }
    const provTestMatch = path.match(/^\/api\/providers\/([^/]+)\/test$/);
    if (provTestMatch && method === 'POST') {
      const pid = provTestMatch[1];
      const k = await env.AL_DB.prepare('SELECT * FROM api_keys WHERE user_id=? AND provider=?').bind(user.id, pid).first();
      if (!k) return json({ error: 'Brak klucza' }, 400);
      const dec = await decrypt(k.encrypted_key, env.ENCRYPTION_KEY);
      const ok = await testProvider(pid, dec, k.model, env);
      if (!ok) return json({ error: 'Test nieudany' }, 400);
      return json({ message: 'Połączenie OK' });
    }
    const provModelsMatch = path.match(/^\/api\/providers\/([^/]+)\/models$/);
    if (provModelsMatch) {
      const pid = provModelsMatch[1];
      const p = PROVIDERS.find(x => x.id === pid);
      return json({ models: p ? p.models : [] });
    }
    if (path === '/api/memory') {
      if (method === 'GET') {
        const r = await env.AL_DB.prepare('SELECT * FROM global_memory WHERE user_id=? ORDER BY pinned DESC, created_at DESC').bind(user.id).all();
        return json({ memory: r.results });
      }
      if (method === 'POST') {
        const b = await request.json();
        const id = 'm_' + crypto.randomUUID();
        await env.AL_DB.prepare('INSERT INTO global_memory (id,user_id,type,content,pinned,enabled,created_at) VALUES (?,?,?,?,0,1,?)').bind(id, user.id, b.type || 'fact', b.content, Date.now()).run();
        return json({ ok: true });
      }
    }
    const memMatch = path.match(/^\/api\/memory\/([^/]+)$/);
    if (memMatch) {
      const id = memMatch[1];
      if (method === 'PATCH') {
        const b = await request.json();
        const fields = []; const vals = [];
        if (b.pinned !== undefined) { fields.push('pinned=?'); vals.push(b.pinned ? 1 : 0) }
        if (b.enabled !== undefined) { fields.push('enabled=?'); vals.push(b.enabled ? 1 : 0) }
        if (b.content !== undefined) { fields.push('content=?'); vals.push(b.content) }
        if (!fields.length) return json({ ok: true });
        vals.push(id, user.id);
        await env.AL_DB.prepare(`UPDATE global_memory SET ${fields.join(',')} WHERE id=? AND user_id=?`).bind(...vals).run();
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        await env.AL_DB.prepare('DELETE FROM global_memory WHERE id=? AND user_id=?').bind(id, user.id).run();
        return json({ ok: true });
      }
    }
    if (path === '/api/projects') {
      if (method === 'GET') {
        const r = await env.AL_DB.prepare('SELECT * FROM projects WHERE user_id=? ORDER BY updated_at DESC').bind(user.id).all();
        return json({ projects: r.results });
      }
      if (method === 'POST') {
        const b = await request.json();
        const id = 'p_' + crypto.randomUUID();
        await env.AL_DB.prepare('INSERT INTO projects (id,user_id,name,description,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind(id, user.id, b.name, b.description || '', Date.now(), Date.now()).run();
        return json({ ok: true });
      }
    }
    const projMatch = path.match(/^\/api\/projects\/([^/]+)$/);
    if (projMatch) {
      const id = projMatch[1];
      const p = await env.AL_DB.prepare('SELECT * FROM projects WHERE id=? AND user_id=?').bind(id, user.id).first();
      if (!p) return json({ error: 'Not found' }, 404);
      if (method === 'GET') return json({ project: p });
      if (method === 'DELETE') {
        await env.AL_DB.prepare('DELETE FROM tasks WHERE project_id=?').bind(id).run();
        await env.AL_DB.prepare('DELETE FROM notes WHERE project_id=?').bind(id).run();
        await env.AL_DB.prepare('DELETE FROM files WHERE project_id=?').bind(id).run();
        await env.AL_DB.prepare('DELETE FROM projects WHERE id=? AND user_id=?').bind(id, user.id).run();
        return json({ ok: true });
      }
    }
    const projTasks = path.match(/^\/api\/projects\/([^/]+)\/tasks$/);
    if (projTasks) {
      const pid = projTasks[1];
      const p = await env.AL_DB.prepare('SELECT * FROM projects WHERE id=? AND user_id=?').bind(pid, user.id).first();
      if (!p) return json({ error: 'Not found' }, 404);
      if (method === 'GET') {
        const r = await env.AL_DB.prepare('SELECT * FROM tasks WHERE project_id=? ORDER BY created_at DESC').bind(pid).all();
        return json({ tasks: r.results });
      }
      if (method === 'POST') {
        const b = await request.json();
        const id = 't_' + crypto.randomUUID();
        await env.AL_DB.prepare('INSERT INTO tasks (id,project_id,user_id,title,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, pid, user.id, b.title, b.description || '', 'todo', Date.now(), Date.now()).run();
        return json({ ok: true });
      }
    }
    const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch) {
      const id = taskMatch[1];
      const t = await env.AL_DB.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').bind(id, user.id).first();
      if (!t) return json({ error: 'Not found' }, 404);
      if (method === 'PATCH') {
        const b = await request.json();
        await env.AL_DB.prepare('UPDATE tasks SET status=?, updated_at=? WHERE id=?').bind(b.status || t.status, Date.now(), id).run();
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        await env.AL_DB.prepare('DELETE FROM tasks WHERE id=?').bind(id).run();
        return json({ ok: true });
      }
    }
    const projNotes = path.match(/^\/api\/projects\/([^/]+)\/notes$/);
    if (projNotes) {
      const pid = projNotes[1];
      const p = await env.AL_DB.prepare('SELECT * FROM projects WHERE id=? AND user_id=?').bind(pid, user.id).first();
      if (!p) return json({ error: 'Not found' }, 404);
      if (method === 'GET') {
        const r = await env.AL_DB.prepare('SELECT * FROM notes WHERE project_id=? ORDER BY created_at DESC').bind(pid).all();
        return json({ notes: r.results });
      }
      if (method === 'POST') {
        const b = await request.json();
        const id = 'n_' + crypto.randomUUID();
        await env.AL_DB.prepare('INSERT INTO notes (id,project_id,user_id,title,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(id, pid, user.id, b.title, b.content || '', Date.now(), Date.now()).run();
        return json({ ok: true });
      }
    }
    const noteMatch = path.match(/^\/api\/notes\/([^/]+)$/);
    if (noteMatch && method === 'DELETE') {
      await env.AL_DB.prepare('DELETE FROM notes WHERE id=? AND user_id=?').bind(noteMatch[1], user.id).run();
      return json({ ok: true });
    }
    const projFiles = path.match(/^\/api\/projects\/([^/]+)\/files$/);
    if (projFiles) {
      const pid = projFiles[1];
      const p = await env.AL_DB.prepare('SELECT * FROM projects WHERE id=? AND user_id=?').bind(pid, user.id).first();
      if (!p) return json({ error: 'Not found' }, 404);
      if (method === 'GET') {
        const r = await env.AL_DB.prepare('SELECT * FROM files WHERE project_id=? ORDER BY created_at DESC').bind(pid).all();
        return json({ files: r.results });
      }
      if (method === 'POST') {
        const fd = await request.formData();
        const file = fd.get('file');
        if (!file || !file.name) return json({ error: 'Brak pliku' }, 400);
        const id = 'f_' + crypto.randomUUID();
        const key = `${user.id}/${id}/${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        await env.AL_BUCKET.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
        await env.AL_DB.prepare('INSERT INTO files (id,project_id,user_id,name,mime_type,size,r2_key,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id, pid, user.id, file.name, file.type || 'application/octet-stream', file.size, key, Date.now()).run();
        return json({ ok: true });
      }
    }
    const fileMatch = path.match(/^\/api\/files\/([^/]+)\/content$/);
    if (fileMatch && method === 'GET') {
      const f = await env.AL_DB.prepare('SELECT * FROM files WHERE id=? AND user_id=?').bind(fileMatch[1], user.id).first();
      if (!f) return json({ error: 'Not found' }, 404);
      const obj = await env.AL_BUCKET.get(f.r2_key);
      if (!obj) return json({ error: 'Not found in R2' }, 404);
      return new Response(obj.body, { headers: { 'Content-Type': f.mime_type, 'Content-Disposition': `inline; filename="${f.name}"` } });
    }
    const fileDel = path.match(/^\/api\/files\/([^/]+)$/);
    if (fileDel && method === 'DELETE') {
      const f = await env.AL_DB.prepare('SELECT * FROM files WHERE id=? AND user_id=?').bind(fileDel[1], user.id).first();
      if (!f) return json({ error: 'Not found' }, 404);
      await env.AL_BUCKET.delete(f.r2_key);
      await env.AL_DB.prepare('DELETE FROM files WHERE id=?').bind(fileDel[1]).run();
      return json({ ok: true });
    }
    if (path === '/api/generate-image' && method === 'POST') {
      const b = await request.json();
      const sizes = { '1024x1024': [1024, 1024], '1280x720': [1280, 720], '720x1280': [720, 1280], '512x512': [512, 512] };
      const [w, h] = sizes[b.size] || [1024, 1024];
      const seed = Math.floor(Math.random() * 1e9);
      const style = b.style && b.style !== 'none' ? `&style=${encodeURIComponent(b.style)}` : '';
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(b.prompt)}?width=${w}&height=${h}&nologo=true&seed=${seed}${style}`;
      return json({ url });
    }
    if (path === '/api/generate-video' && method === 'POST') {
      const k = await env.AL_DB.prepare('SELECT * FROM api_keys WHERE user_id=? AND provider=?').bind(user.id, 'huggingface').first();
      if (!k) return json({ message: 'Wideo wymaga klucza Hugging Face. Dodaj go w Ustawieniach.' }, 200);
      const b = await request.json();
      const dec = await decrypt(k.encrypted_key, env.ENCRYPTION_KEY);
      const r = await fetch('https://api-inference.huggingface.co/models/damo-vilab/text-to-video-ms-1.7b', {
        method: 'POST',
        headers: { Authorization: `Bearer ${dec}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: b.prompt })
      });
      if (!r.ok) return json({ error: 'Generowanie wideo nie powiodło się' }, 502);
      const blob = await r.arrayBuffer();
      const id = 'v_' + crypto.randomUUID();
      const key = `videos/${user.id}/${id}.mp4`;
      await env.AL_BUCKET.put(key, blob, { httpMetadata: { contentType: 'video/mp4' } });
      return json({ url: `/api/media/${id}` });
    }
    if (path === '/api/code/generate' && method === 'POST') {
      const b = await request.json();
      const system = `Jesteś światowej klasy inżynierem oprogramowania. Wygeneruj kompletny, produkcyjny kod w języku ${b.language}. Bez komentarzy, bez placeholderów, bez skrótów. Zwróć tylko kod.`;
      const result = await callAI(env, user, [{ role: 'system', content: system }, { role: 'user', content: b.prompt }], { model: 'auto', internet: false });
      const text = await result.text();
      let code = text;
      const m = text.match(/```(?:\w+)?\n?([\s\S]*?)```/);
      if (m) code = m[1];
      return json({ code });
    }
    if (path === '/api/github/token' && method === 'POST') {
      const b = await request.json();
      const enc = await encrypt(b.token, env.ENCRYPTION_KEY);
      await env.AL_DB.prepare(`INSERT INTO github_tokens (user_id, encrypted_token, created_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET encrypted_token=excluded.encrypted_token, created_at=excluded.created_at`).bind(user.id, enc, Date.now()).run();
      return json({ ok: true });
    }
    if (path === '/api/github/test' && method === 'POST') {
      const t = await env.AL_DB.prepare('SELECT * FROM github_tokens WHERE user_id=?').bind(user.id).first();
      if (!t) return json({ error: 'Brak tokenu' }, 400);
      const dec = await decrypt(t.encrypted_token, env.ENCRYPTION_KEY);
      const r = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${dec}`, 'User-Agent': 'AL2100' } });
      if (!r.ok) return json({ error: 'Token nieprawidłowy' }, 400);
      return json({ message: 'Token OK' });
    }
    if (path === '/api/github/push' && method === 'POST') {
      const b = await request.json();
      const t = await env.AL_DB.prepare('SELECT * FROM github_tokens WHERE user_id=?').bind(user.id).first();
      if (!t) return json({ error: 'Brak tokenu GitHub' }, 400);
      const token = await decrypt(t.encrypted_token, env.ENCRYPTION_KEY);
      const [owner, repo] = b.repo.split('/');
      if (!owner || !repo) return json({ error: 'Format repo: owner/repo' }, 400);
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${b.path}`;
      let sha;
      const getR = await fetch(`${apiUrl}?ref=${b.branch}`, { headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'AL2100' } });
      if (getR.ok) { const j = await getR.json(); sha = j.sha }
      const putR = await fetch(apiUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'AL2100' },
        body: JSON.stringify({ message: b.message, content: btoa(unescape(encodeURIComponent(b.content))), branch: b.branch, sha })
      });
      if (!putR.ok) { const e = await putR.json(); return json({ error: e.message || 'Push failed' }, 502) }
      return json({ message: 'Wysłano do GitHub' });
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, 500);
  }
}

async function streamChat(request, env, user, conv, body) {
  const history = await env.AL_DB.prepare('SELECT role, content FROM messages WHERE conversation_id=? ORDER BY position ASC').bind(conv.id).all();
  const memory = await env.AL_DB.prepare('SELECT type, content FROM global_memory WHERE user_id=? AND enabled=1 ORDER BY pinned DESC, created_at DESC LIMIT 30').bind(user.id).all();
  const memText = memory.results.map(m => `[${m.type}] ${m.content}`).join('\n');
  let msgs = history.results.map(m => ({ role: m.role, content: m.content }));
  if (memText) msgs.unshift({ role: 'system', content: `Pamięć globalna użytkownika:\n${memText}` });
  if (!body.retry) {
    msgs.push({ role: 'user', content: body.content });
    const pos = history.results.length;
    await env.AL_DB.prepare('INSERT INTO messages (id,conversation_id,role,content,provider,model,position,created_at) VALUES (?,?,?,?,?,?,?,?)').bind('msg_u_' + crypto.randomUUID(), conv.id, 'user', body.content, null, null, pos, Date.now()).run();
    if (conv.title === 'Nowa rozmowa') {
      const title = body.content.slice(0, 60).replace(/\n/g, ' ');
      await env.AL_DB.prepare('UPDATE conversations SET title=?, updated_at=? WHERE id=?').bind(title, Date.now(), conv.id).run();
    }
  }
  msgs = trimContext(msgs, 12000);
  const { provider, model, stream } = await callAIStream(env, user, msgs, { model: body.model || 'auto', internet: !!body.internet });
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  let full = '';
  (async () => {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break
        while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const j = JSON.parse(data);
              const delta = j.choices?.[0]?.delta?.content || j.choices?.[0]?.text || j.delta || '';
              if (delta) {
                full += delta;
                await writer.write(enc.encode(`data: ${JSON.stringify({ delta })}\n\n`));
              }
            } catch (_) {}
          }
        }
      }
      if (buf.trim().startsWith('data: ')) {
        const data = buf.slice(6).trim();
        if (data !== '[DONE]') {
          try {
            const j = JSON.parse(data);
            const delta = j.choices?.[0]?.delta?.content || '';
            if (delta) { full += delta; await writer.write(enc.encode(`data: ${JSON.stringify({ delta })}\n\n`)) }
          } catch (_) {}
        }
      }
    } catch (e) {
      if (!full) {
        full = `Błąd: ${e.message || 'nie udało się uzyskać odpowiedzi'}`;
        await writer.write(enc.encode(`data: ${JSON.stringify({ delta: full })}\n\n`));
      }
    }
    try {
      const pos = (await env.AL_DB.prepare('SELECT COUNT(*) as c FROM messages WHERE conversation_id=?').bind(conv.id).first()).c;
      await env.AL_DB.prepare('INSERT INTO messages (id,conversation_id,role,content,provider,model,position,created_at) VALUES (?,?,?,?,?,?,?,?)').bind('msg_a_' + crypto.randomUUID(), conv.id, 'assistant', full, provider, model, pos, Date.now()).run();
      await env.AL_DB.prepare('UPDATE conversations SET updated_at=? WHERE id=?').bind(Date.now(), conv.id).run();
      await writer.write(enc.encode(`data: ${JSON.stringify({ meta: { provider, model } })}\n\n`));
      await writer.write(enc.encode('data: [DONE]\n\n'));
    } catch (_) {}
    try { await writer.close() } catch (_) {}
  })();
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}

function trimContext(msgs, maxChars) {
  const total = msgs.reduce((a, m) => a + m.content.length, 0);
  if (total <= maxChars) return msgs;
  const sys = msgs.filter(m => m.role === 'system');
  const rest = msgs.filter(m => m.role !== 'system');
  const head = rest.slice(0, 2);
  const tail = rest.slice(-8);
  let out = [...sys, ...head, { role: 'system', content: '[Kontekst skrócony. Kontynuuj rozmowę na podstawie najnowszych wiadomości.]' }, ...tail];
  let size = out.reduce((a, m) => a + m.content.length, 0);
  while (size > maxChars && out.length > sys.length + 4) {
    out.splice(sys.length + 1, 1);
    size = out.reduce((a, m) => a + m.content.length, 0);
  }
  return out;
}

const PROVIDERS = [
  { id: 'openrouter', name: 'OpenRouter', defaultModel: 'openai/gpt-4o-mini', models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'meta-llama/llama-3.1-70b-instruct', 'google/gemini-pro-1.5', 'mistralai/mistral-large'] },
  { id: 'groq', name: 'Groq', defaultModel: 'llama-3.3-70b-versatile', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'] },
  { id: 'gemini', name: 'Google Gemini', defaultModel: 'gemini-1.5-flash', models: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'] },
  { id: 'mistral', name: 'Mistral', defaultModel: 'mistral-small-latest', models: ['mistral-small-latest', 'mistral-large-latest', 'open-mixtral-8x22b', 'codestral-latest'] },
  { id: 'together', name: 'Together', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'mistralai/Mixtral-8x7B-Instruct-v0.1', 'Qwen/Qwen2.5-72B-Instruct-Turbo'] },
  { id: 'fireworks', name: 'Fireworks', defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct', models: ['accounts/fireworks/models/llama-v3p3-70b-instruct', 'accounts/fireworks/models/mixtral-8x22b-instruct'] },
  { id: 'deepseek', name: 'DeepSeek', defaultModel: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'huggingface', name: 'Hugging Face', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct', models: ['meta-llama/Llama-3.3-70B-Instruct', 'mistralai/Mistral-7B-Instruct-v0.3', 'Qwen/Qwen2.5-72B-Instruct'] },
  { id: 'qwen', name: 'Qwen (DashScope)', defaultModel: 'qwen-plus', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'] },
  { id: 'cloudflare', name: 'Cloudflare Workers AI', defaultModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', models: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct', '@cf/qwen/qwen1.5-14b-chat-awq'] }
];

async function callAIStream(env, user, messages, opts) {
  const keys = await env.AL_DB.prepare('SELECT provider, encrypted_key, model FROM api_keys WHERE user_id=?').bind(user.id).all();
  const keysMap = {};
  keys.results.forEach(k => keysMap[k.provider] = k);
  let order = PROVIDERS.map(p => p.id);
  if (opts.model && opts.model !== 'auto' && opts.model.includes('/')) {
    const [pid] = opts.model.split('/');
    order = [pid, ...order.filter(x => x !== pid)];
  }
  let lastErr = null;
  for (const pid of order) {
    try {
      const p = PROVIDERS.find(x => x.id === pid);
      if (!p) continue;
      const k = keysMap[pid];
      let apiKey = null;
      let model = (opts.model && opts.model.startsWith(pid + '/')) ? opts.model.slice(pid.length + 1) : (k?.model || p.defaultModel);
      if (pid === 'cloudflare') {
        if (!env.AI) continue;
      } else {
        if (!k) continue;
        apiKey = await decrypt(k.encrypted_key, env.ENCRYPTION_KEY);
      }
      const res = await streamProvider(env, pid, apiKey, model, messages, opts.internet);
      if (res.ok) return { provider: p.name, model, stream: res.body };
      lastErr = `${p.name}: HTTP ${res.status}`;
    } catch (e) {
      lastErr = `${pid}: ${e.message}`;
    }
  }
  const errStream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ delta: `Nie udało się uzyskać odpowiedzi. ${lastErr || 'Brak skonfigurowanych dostawców.'}` })}\n\n`));
      c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      c.close();
    }
  });
  return { provider: 'AL2100', model: 'error', stream: errStream };
}

async function streamProvider(env, pid, apiKey, model, messages, internet) {
  if (pid === 'openrouter') {
    const body = { model, messages, stream: true };
    if (internet) body.plugins = [{ id: 'web' }];
    return fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://al2100.pages.dev', 'X-Title': 'AL2100' },
      body: JSON.stringify(body)
    });
  }
  if (pid === 'groq') {
    return fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, stream: true }) });
  }
  if (pid === 'gemini') {
    const sys = messages.find(m => m.role === 'system');
    const contents = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const body = { contents };
    if (sys) body.systemInstruction = { parts: [{ text: sys.content }] };
    return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  if (pid === 'mistral') {
    return fetch('https://api.mistral.ai/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, stream: true }) });
  }
  if (pid === 'together') {
    return fetch('https://api.together.xyz/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, stream: true }) });
  }
  if (pid === 'fireworks') {
    return fetch('https://api.fireworks.ai/inference/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, stream: true }) });
  }
  if (pid === 'deepseek') {
    return fetch('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, stream: true }) });
  }
  if (pid === 'huggingface') {
    return fetch(`https://api-inference.huggingface.co/models/${model}/v1/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, stream: true }) });
  }
  if (pid === 'qwen') {
    return fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, stream: true }) });
  }
  if (pid === 'cloudflare') {
    const r = await env.AI.run(model, { messages, stream: true });
    return new Response(r, { headers: { 'Content-Type': 'text/event-stream' } });
  }
  throw new Error('Nieznany dostawca');
}

async function callAI(env, user, messages, opts) {
  const keys = await env.AL_DB.prepare('SELECT provider, encrypted_key, model FROM api_keys WHERE user_id=?').bind(user.id).all();
  const keysMap = {};
  keys.results.forEach(k => keysMap[k.provider] = k);
  for (const p of PROVIDERS) {
    try {
      const k = keysMap[p.id];
      let apiKey = null;
      const model = (opts.model && opts.model.startsWith(p.id + '/')) ? opts.model.slice(p.id.length + 1) : (k?.model || p.defaultModel);
      if (p.id === 'cloudflare') {
        if (!env.AI) continue;
        const r = await env.AI.run(model, { messages });
        return new Response(r.response || JSON.stringify(r), { headers: { 'Content-Type': 'text/plain' } });
      }
      if (!k) continue;
      apiKey = await decrypt(k.encrypted_key, env.ENCRYPTION_KEY);
      const res = await streamProvider(env, p.id, apiKey, model, messages, false);
      if (!res.ok) continue;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const j = JSON.parse(data);
              const d = j.choices?.[0]?.delta?.content || j.choices?.[0]?.text || '';
              if (d) full += d;
            } catch (_) {}
          }
        }
      }
      return new Response(full, { headers: { 'Content-Type': 'text/plain' } });
    } catch (_) {}
  }
  return new Response('Nie udało się uzyskać odpowiedzi.', { headers: { 'Content-Type': 'text/plain' } });
}

async function testProvider(pid, apiKey, model, env) {
  try {
    const p = PROVIDERS.find(x => x.id === pid);
    if (!p) return false;
    const m = model || p.defaultModel;
    const msgs = [{ role: 'user', content: 'ping' }];
    const r = await streamProvider(env, pid, apiKey, m, msgs, false);
    return r.ok;
  } catch (_) { return false }
}

async function encrypt(plain, secret) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  const key = await crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  const combined = new Uint8Array(iv.length + ct.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(b64, secret) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv = raw.slice(0, 12);
  const data = raw.slice(12);
  const keyMaterial = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  const key = await crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM' }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return dec.decode(pt);
}

async function checkRate(env, userId) {
  const now = Date.now();
  const windowMs = 60000;
  const max = 60;
  const bucket = Math.floor(now / windowMs);
  const key = `rate:${userId}:${bucket}`;
  const raw = await env.AL_KV.get(key);
  const n = raw ? parseInt(raw, 10) : 0;
  if (n >= max) return { ok: false };
  await env.AL_KV.put(key, String(n + 1), { expirationTtl: 120 });
  return { ok: true };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
