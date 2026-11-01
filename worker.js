// ============================================================
// AL2100 — worker.js
// Cloudflare Workers + D1 + KV + R2 + Queues + Workers AI
// ============================================================

const CORS = {}; // same-origin, nic nie potrzeba

// ============================================================
// EXPORT
// ============================================================
export default {
  async fetch(req, env, ctx) {
    try { return await route(req, env, ctx); }
    catch (e) {
      console.error('[AL2100] fetch error:', e?.stack || e);
      return J({ error: e?.message || 'Błąd wewnętrzny' }, e?.status || 500);
    }
  },
  async queue(batch, env, ctx) {
    for (const msg of batch.messages) {
      try {
        console.log('[AL2100 queue]', msg.body);
        msg.ack();
      } catch (e) {
        console.error('[AL2100 queue]', e);
        msg.retry();
      }
    }
  }
};

// ============================================================
// ROUTING
// ============================================================
async function route(req, env, ctx) {
  const url = new URL(req.url);
  const p = url.pathname;
  const m = req.method;

  // statyczne
  if (!p.startsWith('/api/') && !p.startsWith('/auth/')) return env.ASSETS.fetch(req);

  // auth
  if (p === '/auth/github' && m === 'GET') return authStart(req, env);
  if (p === '/auth/github/callback' && m === 'GET') return authCallback(req, env);
  if (p === '/auth/logout' && m === 'POST') return authLogout(req, env);

  // api wspólne
  if (p === '/api/me' && m === 'GET') return getMe(req, env);

  // rozmowy
  if (p === '/api/conversations' && m === 'GET') return listConvs(req, env);
  if (p === '/api/conversations' && m === 'POST') return newConv(req, env);
  let mm = p.match(/^\/api\/conversations\/([^/]+)$/);
  if (mm && m === 'GET') return getConv(req, env, mm[1]);
  mm = p.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (mm && m === 'POST') return postMsg(req, env, mm[1]);

  // pamięć
  if (p === '/api/memory' && m === 'GET') return listMem(req, env);
  if (p === '/api/memory' && m === 'POST') return addMem(req, env);
  mm = p.match(/^\/api\/memory\/([^/]+)$/);
  if (mm && m === 'PATCH') return patchMem(req, env, mm[1]);
  if (mm && m === 'DELETE') return delMem(req, env, mm[1]);

  // providerzy
  if (p === '/api/providers' && m === 'GET') return listProv(req, env);
  mm = p.match(/^\/api\/providers\/([^/]+)\/key$/);
  if (mm && m === 'POST') return saveKey(req, env, mm[1]);
  if (mm && m === 'DELETE') return delKey(req, env, mm[1]);
  mm = p.match(/^\/api\/providers\/([^/]+)\/test$/);
  if (mm && m === 'POST') return testProv(req, env, mm[1]);

  // projekty
  if (p === '/api/projects' && m === 'GET') return listProjects(req, env);
  if (p === '/api/projects' && m === 'POST') return newProject(req, env);

  // muzyka
  if (p === '/api/music/generate' && m === 'POST') return genMusic(req, env);
  if (p === '/api/music/tracks' && m === 'GET') return listTracks(req, env);
  mm = p.match(/^\/api\/music\/tracks\/([^/]+)\/audio$/);
  if (mm && m === 'GET') return trackAudio(req, env, mm[1]);
  mm = p.match(/^\/api\/music\/tracks\/([^/]+)$/);
  if (mm && m === 'DELETE') return delTrack(req, env, mm[1]);
  if (p === '/api/music/write-lyrics' && m === 'POST') return writeLyrics(req, env);

  // media
  if (p === '/api/media/image' && m === 'POST') return genImage(req, env);
  if (p === '/api/media/video' && m === 'POST') return genVideo(req, env);
  mm = p.match(/^\/api\/media\/file\/([^/]+)$/);
  if (mm && m === 'GET') return mediaFile(req, env, mm[1]);
  if (p === '/api/files/upload' && m === 'POST') return uploadFile(req, env);

  // github
  if (p === '/api/github/token' && m === 'POST') return saveGh(req, env);
  if (p === '/api/github/test' && m === 'POST') return testGh(req, env);
  if (p === '/api/github/push' && m === 'POST') return pushGh(req, env);

  return J({ error: 'Nie znaleziono: ' + p }, 404);
}

// ============================================================
// HELPERY
// ============================================================
function J(o, s = 200, h = {}) {
  return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', ...h } });
}
function T(t, s = 200) { return new Response(t, { status: s, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
function cookieGet(req, n) {
  const c = req.headers.get('Cookie') || '';
  const re = new RegExp('(?:^|; )' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)');
  const m = c.match(re);
  return m ? decodeURIComponent(m[1]) : null;
}
function cookieSet(n, v, maxAge = 30 * 24 * 3600) {
  return `${n}=${encodeURIComponent(v)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
function cookieClear(n) { return `${n}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`; }
function uid(pre = '') { return pre + crypto.randomUUID().replace(/-/g, ''); }
function rhex(n = 32) { const b = crypto.getRandomValues(new Uint8Array(n)); return Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); }
async function safeJson(req) { try { return await req.json(); } catch { return {}; } }

// --- AES-GCM ---
async function encKey(env) {
  if (!env.ENC_KEY || env.ENC_KEY.length < 16) throw new Error('Brak ENC_KEY w sekretach (wrangler secret put ENC_KEY)');
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.ENC_KEY));
  return crypto.subtle.importKey('raw', h, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function encrypt(env, pt) {
  const k = await encKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(pt));
  return b64(iv) + ':' + b64(new Uint8Array(ct));
}
async function decrypt(env, s) {
  const [ivB, ctB] = s.split(':');
  if (!ivB || !ctB) throw new Error('Zły format zaszyfrowanego klucza');
  const k = await encKey(env);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB) }, k, unb64(ctB));
  return new TextDecoder().decode(pt);
}
function b64(u8) { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); }
function unb64(s) { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

// --- sesje ---
async function createSession(env, userId) {
  const id = rhex(32), csrf = rhex(24);
  const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  await env.AL_DB.prepare('INSERT INTO sessions (id, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)').bind(id, userId, csrf, exp).run();
  return { id, csrf, exp };
}
async function getSession(req, env) {
  const sid = cookieGet(req, 'ax_session');
  if (!sid) return null;
  const row = await env.AL_DB.prepare('SELECT s.id, s.user_id, s.csrf_token, s.expires_at, u.login, u.name, u.avatar_url FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?').bind(sid).first();
  if (!row) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    await env.AL_DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
    return null;
  }
  return row;
}
async function reqSess(req, env) {
  const s = await getSession(req, env);
  if (!s) throw Object.assign(new Error('Wymagane zalogowanie'), { status: 401 });
  return s;
}
async function reqCsrf(req, env, s) {
  if (!['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) return;
  const t = req.headers.get('X-CSRF-Token');
  if (!t || t !== s.csrf_token) throw Object.assign(new Error('Nieprawidłowy CSRF'), { status: 403 });
}

// --- provider keys ---
async function getKey(env, uid, prov) {
  const r = await env.AL_DB.prepare('SELECT encrypted_key FROM provider_keys WHERE user_id = ? AND provider = ?').bind(uid, prov).first();
  if (!r) return null;
  return decrypt(env, r.encrypted_key);
}

// ============================================================
// AUTH
// ============================================================
async function authStart(req, env) {
  const url = new URL(req.url);
  if (!env.GITHUB_CLIENT_ID) return T('Brak GITHUB_CLIENT_ID', 500);
  const state = rhex(16);
  await env.AL_KV.put('oauth:' + state, '1', { expirationTtl: 600 });
  const g = new URL('https://github.com/login/oauth/authorize');
  g.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  g.searchParams.set('redirect_uri', `${url.origin}/auth/github/callback`);
  g.searchParams.set('scope', 'read:user user:email repo');
  g.searchParams.set('state', state);
  return Response.redirect(g.toString(), 302);
}

async function authCallback(req, env) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return T('Brak code/state', 400);
  const ok = await env.AL_KV.get('oauth:' + state);
  if (!ok) return T('Nieprawidłowy state', 400);
  await env.AL_KV.delete('oauth:' + state);

  const tr = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${url.origin}/auth/github/callback` })
  });
  const td = await tr.json();
  if (!td.access_token) return T('Brak access_token: ' + JSON.stringify(td), 400);

  const ur = await fetch('https://api.github.com/user', { headers: { 'Authorization': 'Bearer ' + td.access_token, 'User-Agent': 'AL2100', 'Accept': 'application/vnd.github+json' } });
  const u = await ur.json();
  const userId = 'gh_' + u.id;

  await env.AL_DB.prepare('INSERT INTO users (id, login, name, avatar_url) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET login=excluded.login, name=excluded.name, avatar_url=excluded.avatar_url').bind(userId, u.login, u.name || u.login, u.avatar_url || '').run();

  try {
    const e = await encrypt(env, td.access_token);
    await env.AL_DB.prepare('INSERT INTO github_keys (user_id, encrypted_token, updated_at) VALUES (?, ?, unixepoch()) ON CONFLICT(user_id) DO UPDATE SET encrypted_token=excluded.encrypted_token, updated_at=unixepoch()').bind(userId, e).run();
  } catch (e) { console.warn('[AL2100] gh token save:', e.message); }

  const sess = await createSession(env, userId);
  return new Response(null, { status: 302, headers: { 'Location': '/', 'Set-Cookie': cookieSet('ax_session', sess.id) } });
}

async function authLogout(req, env) {
  const sid = cookieGet(req, 'ax_session');
  if (sid) await env.AL_DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  return J({ ok: true }, 200, { 'Set-Cookie': cookieClear('ax_session') });
}

async function getMe(req, env) {
  const s = await getSession(req, env);
  if (!s) return J({ user: null });
  return J({ user: { id: s.user_id, login: s.login, name: s.name, avatar_url: s.avatar_url }, csrf: s.csrf_token });
}

// ============================================================
// ROZMOWY
// ============================================================
async function listConvs(req, env) {
  const s = await reqSess(req, env);
  const r = await env.AL_DB.prepare('SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100').bind(s.user_id).all();
  return J({ conversations: r.results });
}

async function newConv(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const title = (b.title || 'Nowa rozmowa').slice(0, 120);
  const id = uid('c_');
  await env.AL_DB.prepare('INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)').bind(id, s.user_id, title).run();
  return J({ conversation: { id, title, created_at: Math.floor(Date.now() / 1000) } });
}

async function getConv(req, env, id) {
  const s = await reqSess(req, env);
  const c = await env.AL_DB.prepare('SELECT id, title, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?').bind(id, s.user_id).first();
  if (!c) return J({ error: 'Rozmowa nie znaleziona' }, 404);
  const msgs = await env.AL_DB.prepare('SELECT id, role, content, model, provider, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').bind(id).all();
  return J({ conversation: c, messages: msgs.results });
}

// ============================================================
// POST MESSAGE — SSE STREAMING
// ============================================================
const PROVIDER_META = {
  groq:        { name: 'Groq', kind: 'llm', defaultModel: 'llama-3.3-70b-versatile' },
  openrouter:  { name: 'OpenRouter', kind: 'llm', defaultModel: 'deepseek/deepseek-chat-v3.1:free' },
  gemini:      { name: 'Google Gemini', kind: 'llm', defaultModel: 'gemini-2.5-flash' },
  perplexity:  { name: 'Perplexity', kind: 'llm', defaultModel: 'sonar' },
  grok:        { name: 'xAI Grok', kind: 'llm', defaultModel: 'grok-4' },
  huggingface: { name: 'Hugging Face', kind: 'image', defaultModel: 'black-forest-labs/FLUX.1-schnell' },
  magichour:   { name: 'Magic Hour', kind: 'video', defaultModel: 'default' },
  'ace-step':  { name: 'ACE-Step', kind: 'music', defaultModel: 'acestep-v15-turbo' }
};

async function postMsg(req, env, cid) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const content = (b.content || '').trim();
  const retry = b.retry || null;
  const internet = !!b.internet;
  const modelSel = (b.model || 'auto').trim();

  if (!content && !retry) return J({ error: 'Brak treści' }, 400);
  const conv = await env.AL_DB.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').bind(cid, s.user_id).first();
  if (!conv) return J({ error: 'Rozmowa nie znaleziona' }, 404);

  if (retry) {
    await env.AL_DB.prepare('DELETE FROM messages WHERE id = ? AND conversation_id = ? AND role = ?').bind(retry, cid, 'assistant').run();
  } else {
    await env.AL_DB.prepare('INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)').bind(uid('msg_'), cid, 'user', content).run();
  }

  const cnt = await env.AL_DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').bind(cid).first('n');
  if (cnt === 1 && content) {
    await env.AL_DB.prepare('UPDATE conversations SET title = ?, updated_at = unixepoch() WHERE id = ?').bind(content.slice(0, 60).replace(/\s+/g, ' ').trim() || 'Nowa rozmowa', cid).run();
  } else {
    await env.AL_DB.prepare('UPDATE conversations SET updated_at = unixepoch() WHERE id = ?').bind(cid).run();
  }

  const hist = (await env.AL_DB.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 60').bind(cid).all()).results;
  const mem = (await env.AL_DB.prepare('SELECT type, content FROM memory WHERE user_id = ? AND enabled = 1 ORDER BY pinned DESC, created_at DESC LIMIT 40').bind(s.user_id).all()).results;
  const memBlock = mem.map(x => `[${x.type}] ${x.content}`).join('\n');

  let research = '';
  if (internet) {
    try { research = await runResearch(env, s.user_id, content); } catch (e) { console.warn('[AL2100] research:', e.message); }
  }

  const messages = [
    { role: 'system', content: sysPrompt(memBlock) },
    ...(research ? [{ role: 'system', content: 'Kontekst researchu:\n' + research }] : []),
    ...hist.map(h => ({ role: h.role, content: h.content }))
  ];

  const plan = await resolveProvider(modelSel, env, s.user_id);
  if (plan.provider === 'puter') return J({ error: 'Puter jest po stronie frontendu. Wybierz innego providera backendowego.' }, 400);

  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder();
      const send = o => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      const end = () => { ctrl.enqueue(enc.encode('data: [DONE]\n\n')); ctrl.close(); };
      let acc = '', usedProv = plan.provider, usedModel = plan.model;
      try {
        if (plan.provider === 'groq') await streamOpenAI(env, s.user_id, 'groq', 'https://api.groq.com/openai/v1/chat/completions', messages, plan.model, d => { acc += d; send({ delta: d }); });
        else if (plan.provider === 'openrouter') await streamOpenAI(env, s.user_id, 'openrouter', 'https://openrouter.ai/api/v1/chat/completions', messages, plan.model, d => { acc += d; send({ delta: d }); }, { 'HTTP-Referer': 'https://al2100.pages.dev', 'X-Title': 'AL2100' });
        else if (plan.provider === 'gemini') await streamGemini(env, s.user_id, messages, plan.model, d => { acc += d; send({ delta: d }); });
        else if (plan.provider === 'grok') await streamOpenAI(env, s.user_id, 'grok', 'https://api.x.ai/v1/chat/completions', messages, plan.model, d => { acc += d; send({ delta: d }); });
        else if (plan.provider === 'perplexity') { const a = await callPerplexity(env, s.user_id, messages, plan.model); acc = a; send({ delta: a }); usedProv = 'Perplexity'; }
        else if (plan.provider === 'workers-ai') { const t = await callWorkersAI(env, messages, plan.model); acc = t; send({ delta: t }); usedModel = plan.model; }
        else throw new Error('Nieobsługiwany provider: ' + plan.provider);

        await env.AL_DB.prepare('INSERT INTO messages (id, conversation_id, role, content, model, provider) VALUES (?, ?, ?, ?, ?, ?)').bind(uid('msg_'), cid, 'assistant', acc, usedModel, usedProv).run();
        send({ meta: { model: usedModel, provider: usedProv } });
        end();
      } catch (e) {
        console.error('[AL2100] stream:', e);
        send({ error: e.message || 'Błąd generowania' });
        end();
      }
    }
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' } });
}

function sysPrompt(memBlock) {
  const b = `Jesteś AL2100 — prywatnym, spersonalizowanym systemem AI użytkownika. Jesteś jego "klonem AI" — osobistym narzędziem myślowym i kreatywnym partnerem, nie korporacyjnym asystentem.

ZASADY:
1. Wiesz, że jesteś klonem AI tego konkretnego użytkownika. Mów o tym otwarcie, gdy istotne. Nie udawaj ChatGPT/Claude/Gemini — jesteś AL2100.
2. ZAWSZE przed odpowiedzią przeanalizuj pełną historię rozmowy (ostatnie 60 wiadomości) i pamięć globalną. Nie odpowiadaj na ślepo na ostatnią wiadomość, jeśli kontekst wcześniejszy jest kluczowy.
3. Myśl nieszablonowo. Zero korporacyjnego języka, frazesów, "bezpiecznych" ogólników, wody. Mów wprost.
4. NIGDY nie kłam. Nie zmyślaj faktów, źródeł, cytatów, kodu, API, liczb. Jeśli nie wiesz — powiedz "nie wiem" i zaproponuj weryfikację (research, test, dokumentacja).
5. Bądź bezpośredni. Słaby pomysł → powiedz to, ale od razu zaproponuj lepszy.
6. Respektuj pamięć globalną (fakty, preferencje, decyzje). Ustalenia użytkownika są nadrzędne.
7. Specjalizacje: muzyka (teksty, struktura, prompty ACE-Step/MiniMax, produkcja), kod (Cloudflare, web, AI), research.
8. Język: dopasuj się do użytkownika (polski/angielski/inny).

STYL: konkretny, kreatywny, bez ściemy. Zero "jako model językowy". Jesteś narzędziem, nie korporacją.`;
  return memBlock ? b + '\n\nPAMIĘĆ GLOBALNA UŻYTKOWNIKA:\n' + memBlock : b;
}

async function resolveProvider(sel, env, uid) {
  if (sel === 'auto' || !sel) {
    if (await getKey(env, uid, 'groq')) return { provider: 'groq', model: 'llama-3.3-70b-versatile' };
    if (await getKey(env, uid, 'openrouter')) return { provider: 'openrouter', model: 'deepseek/deepseek-chat-v3.1:free' };
    if (await getKey(env, uid, 'gemini')) return { provider: 'gemini', model: 'gemini-2.5-flash' };
    if (await getKey(env, uid, 'grok')) return { provider: 'grok', model: 'grok-4' };
    return { provider: 'workers-ai', model: '@cf/meta/llama-3.1-8b-instruct' };
  }
  const [prov, ...rest] = sel.split('/');
  const model = rest.join('/') || PROVIDER_META[prov]?.defaultModel;
  if (prov === 'workers-ai') return { provider: 'workers-ai', model: model || '@cf/meta/llama-3.1-8b-instruct' };
  return { provider: prov, model };
}

async function streamOpenAI(env, uid, prov, url, messages, model, onDelta, extraHeaders = {}) {
  const k = await getKey(env, uid, prov);
  if (!k) throw new Error(`Brak klucza ${prov}. Skonfiguruj w Ustawieniach.`);
  const r = await fetch(url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify({ model, messages, stream: true, temperature: 0.7 }) });
  if (!r.ok) throw new Error(`${prov} HTTP ${r.status}: ` + (await r.text()).slice(0, 200));
  const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const d = line.slice(6); if (d === '[DONE]') continue;
        try { const j = JSON.parse(d); const delta = j.choices?.[0]?.delta?.content; if (delta) onDelta(delta); } catch {}
      }
    }
  }
}

async function streamGemini(env, uid, messages, model, onDelta) {
  const k = await getKey(env, uid, 'gemini');
  if (!k) throw new Error('Brak klucza Gemini');
  const sys = messages.find(m => m.role === 'system');
  const chat = messages.filter(m => m.role !== 'system');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(k)}`;
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: chat.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      ...(sys ? { systemInstruction: { parts: [{ text: sys.content }] } } : {}),
      generationConfig: { temperature: 0.7 }
    })
  });
  if (!r.ok) throw new Error('Gemini HTTP ' + r.status);
  const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const d = line.slice(6); if (d === '[DONE]') continue;
        try { const j = JSON.parse(d); const t = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || ''; if (t) onDelta(t); } catch {}
      }
    }
  }
}

async function callWorkersAI(env, messages, model) {
  if (!env.AI) throw new Error('Brak bindingu AI');
  const r = await env.AI.run(model, { messages: messages.map(m => ({ role: m.role, content: m.content })) });
  return r.response || r.result || '';
}

async function callPerplexity(env, uid, messages, model) {
  const k = await getKey(env, uid, 'perplexity');
  if (!k) throw new Error('Brak klucza Perplexity');
  const r = await fetch('https://api.perplexity.ai/chat/completions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, temperature: 0.2 }) });
  if (!r.ok) throw new Error('Perplexity HTTP ' + r.status);
  const j = await r.json();
  return j.choices?.[0]?.message?.content || '';
}

async function runResearch(env, uid, q) {
  const k = await getKey(env, uid, 'perplexity');
  if (!k) return '';
  const r = await fetch('https://api.perplexity.ai/chat/completions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: q }], temperature: 0.1 }) });
  if (!r.ok) return '';
  const j = await r.json();
  return j.choices?.[0]?.message?.content || '';
}

// ============================================================
// PAMIĘĆ
// ============================================================
async function listMem(req, env) {
  const s = await reqSess(req, env);
  const r = await env.AL_DB.prepare('SELECT id, type, content, pinned, enabled, created_at FROM memory WHERE user_id = ? ORDER BY pinned DESC, created_at DESC').bind(s.user_id).all();
  return J({ memory: r.results });
}
async function addMem(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const type = ['fact', 'preference', 'decision'].includes(b.type) ? b.type : 'fact';
  const c = (b.content || '').trim();
  if (!c) return J({ error: 'Brak treści' }, 400);
  const id = uid('m_');
  await env.AL_DB.prepare('INSERT INTO memory (id, user_id, type, content) VALUES (?, ?, ?, ?)').bind(id, s.user_id, type, c.slice(0, 2000)).run();
  return J({ id });
}
async function patchMem(req, env, id) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const f = [], v = [];
  if ('pinned' in b) { f.push('pinned = ?'); v.push(b.pinned ? 1 : 0); }
  if ('enabled' in b) { f.push('enabled = ?'); v.push(b.enabled ? 1 : 0); }
  if ('content' in b) { f.push('content = ?'); v.push(String(b.content).slice(0, 2000)); }
  if (!f.length) return J({ error: 'Brak pól' }, 400);
  v.push(id, s.user_id);
  await env.AL_DB.prepare(`UPDATE memory SET ${f.join(', ')} WHERE id = ? AND user_id = ?`).bind(...v).run();
  return J({ ok: true });
}
async function delMem(req, env, id) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  await env.AL_DB.prepare('DELETE FROM memory WHERE id = ? AND user_id = ?').bind(id, s.user_id).run();
  return J({ ok: true });
}

// ============================================================
// PROVIDERZY
// ============================================================
async function listProv(req, env) {
  const s = await reqSess(req, env);
  const r = await env.AL_DB.prepare('SELECT provider, model, updated_at FROM provider_keys WHERE user_id = ?').bind(s.user_id).all();
  const cfg = new Map(r.results.map(x => [x.provider, x]));
  const providers = Object.entries(PROVIDER_META).map(([id, meta]) => ({ id, name: meta.name, kind: meta.kind, models: [meta.defaultModel], configured: cfg.has(id), model: cfg.get(id)?.model || null }));
  return J({ providers });
}
async function saveKey(req, env, prov) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  if (!PROVIDER_META[prov]) return J({ error: 'Nieznany provider' }, 400);
  const b = await safeJson(req);
  const k = (b.key || '').trim(), m = (b.model || '').trim() || null;
  if (!k) return J({ error: 'Brak klucza' }, 400);
  const e = await encrypt(env, k);
  await env.AL_DB.prepare('INSERT INTO provider_keys (id, user_id, provider, encrypted_key, model, updated_at) VALUES (?, ?, ?, ?, ?, unixepoch()) ON CONFLICT(user_id, provider) DO UPDATE SET encrypted_key=excluded.encrypted_key, model=excluded.model, updated_at=unixepoch()').bind(uid('pk_'), s.user_id, prov, e, m).run();
  return J({ ok: true });
}
async function delKey(req, env, prov) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  await env.AL_DB.prepare('DELETE FROM provider_keys WHERE user_id = ? AND provider = ?').bind(s.user_id, prov).run();
  return J({ ok: true });
}
async function testProv(req, env, prov) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  try {
    const k = await getKey(env, s.user_id, prov);
    if (!k) return J({ error: 'Brak zapisanego klucza' }, 400);
    const checks = {
      groq: ['https://api.groq.com/openai/v1/models', 'Bearer'],
      openrouter: ['https://openrouter.ai/api/v1/models', 'Bearer'],
      gemini: [`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}`, null],
      grok: ['https://api.x.ai/v1/models', 'Bearer'],
      huggingface: ['https://huggingface.co/api/whoami-v2', 'Bearer'],
      perplexity: ['https://api.perplexity.ai/chat/completions', 'Bearer', { method: 'POST', body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }), headers: { 'Content-Type': 'application/json' } }],
      'ace-step': ['https://acestep.io/api/v2/models', 'Bearer'],
      magichour: ['https://api.magichour.ai/v1/account', 'Bearer']
    };
    const c = checks[prov];
    if (!c) return J({ ok: true, message: 'Klucz zapisany (brak testu)' });
    const headers = {};
    if (c[1]) headers.Authorization = c[1] + ' ' + k;
    const init = { method: c[2]?.method || 'GET', headers: { ...headers, ...(c[2]?.headers || {}) }, ...(c[2]?.body ? { body: c[2].body } : {}) };
    const r = await fetch(c[0], init);
    if (!r.ok) return J({ error: `${prov} HTTP ${r.status}` }, 400);
    return J({ ok: true, message: prov + ' OK' });
  } catch (e) { return J({ error: e.message }, 400); }
}

// ============================================================
// PROJEKTY
// ============================================================
async function listProjects(req, env) {
  const s = await reqSess(req, env);
  const r = await env.AL_DB.prepare('SELECT id, name, description, created_at FROM projects WHERE user_id = ? ORDER BY created_at DESC').bind(s.user_id).all();
  return J({ projects: r.results });
}
async function newProject(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const n = (b.name || '').trim();
  if (!n) return J({ error: 'Brak nazwy' }, 400);
  const id = uid('p_');
  await env.AL_DB.prepare('INSERT INTO projects (id, user_id, name, description) VALUES (?, ?, ?, ?)').bind(id, s.user_id, n.slice(0, 120), (b.description || '').slice(0, 500)).run();
  return J({ id });
}

// ============================================================
// MUZYKA
// ============================================================
async function genMusic(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const style = (b.style || '').trim(), lyrics = (b.lyrics || '').trim();
  const engine = b.engine === 'minimax' ? 'minimax' : 'ace-step';
  const dur = Math.min(Math.max(parseInt(b.duration, 10) || 120, 15), 240);
  if (!style) return J({ error: 'Podaj styl' }, 400);

  let buf = null, usedEngine = engine;

  if (engine === 'ace-step') {
    const k = await getKey(env, s.user_id, 'ace-step');
    if (!k) return J({ error: 'Brak klucza ACE-Step' }, 400);
    const r = await fetch('https://acestep.io/api/v2/generate-audio', { method: 'POST', headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' }, body: JSON.stringify({ style, lyrics: lyrics || undefined, duration: dur, format: 'mp3' }) });
    if (!r.ok) return J({ error: 'ACE-Step HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200) }, 502);
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('audio') || ct.includes('octet')) buf = await r.arrayBuffer();
    else {
      const j = await r.json();
      const au = j.audio_url || j.url || j.output?.audio_url;
      const b64a = j.audio_base64 || j.audio;
      if (b64a) { const bin = atob(b64a); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); buf = u.buffer; }
      else if (au) { const ar = await fetch(au); if (!ar.ok) return J({ error: 'Nie udało się pobrać audio' }, 502); buf = await ar.arrayBuffer(); }
      else return J({ error: 'Brak audio w odpowiedzi' }, 502);
    }
  } else {
    if (!env.AI) return J({ error: 'Brak bindingu AI' }, 500);
    try {
      const res = await env.AI.run('@cf/minimax/music-2.6', { prompt: style, lyrics: lyrics || undefined, output_format: 'mp3' });
      if (res instanceof ArrayBuffer) buf = res;
      else if (res?.audio instanceof ArrayBuffer) buf = res.audio;
      else if (typeof res === 'string') { const bin = atob(res); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); buf = u.buffer; }
      else return J({ error: 'MiniMax: nieoczekiwany format' }, 502);
    } catch (e) { return J({ error: 'MiniMax: ' + e.message }, 502); }
  }

  if (!buf) return J({ error: 'Nie udało się wygenerować' }, 502);
  const tid = uid('t_'), r2k = `${s.user_id}/tracks/${tid}.mp3`;
  await env.AL_BUCKET.put(r2k, buf, { httpMetadata: { contentType: 'audio/mpeg' } });
  await env.AL_DB.prepare('INSERT INTO tracks (id, user_id, style, lyrics, engine, r2_key, duration_s) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(tid, s.user_id, style.slice(0, 500), lyrics || null, usedEngine, r2k, dur).run();
  return J({ id: tid, ok: true, engine: usedEngine });
}

async function listTracks(req, env) {
  const s = await reqSess(req, env);
  const r = await env.AL_DB.prepare('SELECT id, style, engine, duration_s, created_at FROM tracks WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').bind(s.user_id).all();
  return J({ tracks: r.results });
}

async function trackAudio(req, env, id) {
  const s = await reqSess(req, env);
  const row = await env.AL_DB.prepare('SELECT r2_key FROM tracks WHERE id = ? AND user_id = ?').bind(id, s.user_id).first();
  if (!row) return J({ error: 'Nie znaleziono' }, 404);
  const o = await env.AL_BUCKET.get(row.r2_key);
  if (!o) return J({ error: 'Plik nie istnieje' }, 410);
  return new Response(o.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=3600' } });
}

async function delTrack(req, env, id) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const row = await env.AL_DB.prepare('SELECT r2_key FROM tracks WHERE id = ? AND user_id = ?').bind(id, s.user_id).first();
  if (!row) return J({ error: 'Nie znaleziono' }, 404);
  await env.AL_BUCKET.delete(row.r2_key);
  await env.AL_DB.prepare('DELETE FROM tracks WHERE id = ? AND user_id = ?').bind(id, s.user_id).run();
  return J({ ok: true });
}

async function writeLyrics(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const style = (b.style || '').trim();
  if (!style) return J({ error: 'Podaj styl' }, 400);
  const prompt = `Napisz tekst piosenki w stylu: ${style}. Struktura [Verse],[Chorus],[Bridge],[Outro]. Język polski (chyba że styl sugeruje inny). Zwróć TYLKO tekst.`;
  let out = '';
  try {
    const gk = await getKey(env, s.user_id, 'groq');
    if (gk) {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + gk, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.8, max_tokens: 1200 }) });
      if (!r.ok) throw new Error('Groq HTTP ' + r.status);
      const j = await r.json();
      out = j.choices?.[0]?.message?.content || '';
    } else if (env.AI) {
      const r = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages: [{ role: 'user', content: prompt }] });
      out = r.response || '';
    } else return J({ error: 'Brak Groq / Workers AI' }, 400);
  } catch (e) { return J({ error: e.message }, 502); }
  return J({ lyrics: out.trim() });
}

// ============================================================
// MEDIA
// ============================================================
async function genImage(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const prompt = (b.prompt || '').trim();
  const provider = b.provider || 'pollinations';
  const style = b.style || 'none';
  const size = b.size || '1024x1024';
  if (!prompt) return J({ error: 'Podaj prompt' }, 400);
  const [w, h] = size.split('x').map(n => parseInt(n, 10) || 1024);
  const styled = style !== 'none' ? `${prompt}, ${style} style` : prompt;
  let buf = null;

  if (provider === 'pollinations') {
    const r = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(styled)}?width=${w}&height=${h}&model=flux&nologo=true`);
    if (!r.ok) return J({ error: 'Pollinations HTTP ' + r.status }, 502);
    buf = await r.arrayBuffer();
  } else if (provider === 'cloudflare') {
    if (!env.AI) return J({ error: 'Brak bindingu AI' }, 500);
    try { const res = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt: styled, width: w, height: h }); buf = res instanceof ArrayBuffer ? res : res?.image instanceof ArrayBuffer ? res.image : null; if (!buf) return J({ error: 'Nieoczekiwany format CF Flux' }, 502); }
    catch (e) { return J({ error: 'CF Flux: ' + e.message }, 502); }
  } else if (provider === 'huggingface') {
    const k = await getKey(env, s.user_id, 'huggingface');
    if (!k) return J({ error: 'Brak klucza HF' }, 400);
    const r = await fetch('https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell', { method: 'POST', headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs: styled, parameters: { width: w, height: h } }) });
    if (!r.ok) return J({ error: 'HF HTTP ' + r.status }, 502);
    buf = await r.arrayBuffer();
  }
  if (!buf) return J({ error: 'Brak obrazu' }, 502);
  const id = uid('img_'), r2k = `${s.user_id}/media/${id}.png`;
  await env.AL_BUCKET.put(r2k, buf, { httpMetadata: { contentType: 'image/png' } });
  await env.AL_DB.prepare('INSERT INTO media (id, user_id, kind, provider, prompt, r2_key) VALUES (?, ?, ?, ?, ?, ?)').bind(id, s.user_id, 'image', provider, prompt.slice(0, 1000), r2k).run();
  return J({ id, url: '/api/media/file/' + id });
}

async function genVideo(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const prompt = (b.prompt || '').trim();
  const dur = Math.min(Math.max(parseInt(b.duration, 10) || 5, 3), 10);
  if (!prompt) return J({ error: 'Podaj prompt' }, 400);
  const k = await getKey(env, s.user_id, 'magichour');
  if (!k) return J({ error: 'Brak klucza Magic Hour' }, 400);
  const r = await fetch('https://api.magichour.ai/v1/text-to-video', { method: 'POST', headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, duration: dur, resolution: '720p' }) });
  if (!r.ok) return J({ error: 'Magic Hour HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200) }, 502);
  const j = await r.json();
  const u = j.video_url || j.url || j.output?.video_url;
  if (u) return J({ url: u, provider: 'magichour' });
  if (j.id || j.job_id) return J({ job_id: j.id || j.job_id, message: 'Wideo generowane w tle' });
  return J({ error: 'Nieoczekiwany format' }, 502);
}

async function mediaFile(req, env, id) {
  const s = await reqSess(req, env);
  const row = await env.AL_DB.prepare('SELECT r2_key, kind FROM media WHERE id = ? AND user_id = ?').bind(id, s.user_id).first();
  if (!row) return J({ error: 'Nie znaleziono' }, 404);
  const o = await env.AL_BUCKET.get(row.r2_key);
  if (!o) return J({ error: 'Plik nie istnieje' }, 410);
  return new Response(o.body, { headers: { 'Content-Type': row.kind === 'video' ? 'video/mp4' : 'image/png', 'Cache-Control': 'private, max-age=86400' } });
}

async function uploadFile(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('multipart/form-data')) return J({ error: 'Wymagany multipart/form-data' }, 400);
  const form = await req.formData();
  const file = form.get('file');
  const projectId = form.get('project_id');
  if (!file || typeof file === 'string') return J({ error: 'Brak pliku' }, 400);
  if (file.size > 25 * 1024 * 1024) return J({ error: 'Plik > 25 MB' }, 413);
  const id = uid('f_');
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  const r2k = `${s.user_id}/files/${id}_${safe}`;
  const buffer = await file.arrayBuffer();
  await env.AL_BUCKET.put(r2k, buffer, { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
  if (projectId) {
    const p = await env.AL_DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, s.user_id).first();
    if (!p) return J({ error: 'Projekt nie znaleziony' }, 404);
    await env.AL_DB.prepare('INSERT INTO files (id, project_id, name, mime_type, size, r2_key) VALUES (?, ?, ?, ?, ?, ?)').bind(id, projectId, file.name, file.type, file.size, r2k).run();
  }
  return J({ id, name: file.name, size: file.size, r2_key: r2k });
}

// ============================================================
// GITHUB
// ============================================================
async function saveGh(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const t = (b.token || '').trim();
  if (!t) return J({ error: 'Brak tokenu' }, 400);
  const e = await encrypt(env, t);
  await env.AL_DB.prepare('INSERT INTO github_keys (user_id, encrypted_token, updated_at) VALUES (?, ?, unixepoch()) ON CONFLICT(user_id) DO UPDATE SET encrypted_token=excluded.encrypted_token, updated_at=unixepoch()').bind(s.user_id, e).run();
  return J({ ok: true });
}
async function testGh(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const r = await env.AL_DB.prepare('SELECT encrypted_token FROM github_keys WHERE user_id = ?').bind(s.user_id).first();
  if (!r) return J({ error: 'Brak tokenu' }, 400);
  const t = await decrypt(env, r.encrypted_token);
  const resp = await fetch('https://api.github.com/user', { headers: { 'Authorization': 'Bearer ' + t, 'User-Agent': 'AL2100' } });
  if (!resp.ok) return J({ error: 'GitHub HTTP ' + resp.status }, 502);
  const u = await resp.json();
  return J({ ok: true, login: u.login });
}
async function pushGh(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const repo = (b.repo || '').trim(), path = (b.path || '').trim(), branch = (b.branch || 'main').trim(), content = b.content || '', message = (b.message || 'AL2100: update').trim();
  if (!repo.includes('/')) return J({ error: 'Repo musi być owner/repo' }, 400);
  if (!path) return J({ error: 'Brak ścieżki' }, 400);
  const r = await env.AL_DB.prepare('SELECT encrypted_token FROM github_keys WHERE user_id = ?').bind(s.user_id).first();
  if (!r) return J({ error: 'Brak tokenu GitHub' }, 400);
  const t = await decrypt(env, r.encrypted_token);
  const [owner, name] = repo.split('/');

  let sha = null;
  const g = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`, { headers: { 'Authorization': 'Bearer ' + t, 'User-Agent': 'AL2100' } });
  if (g.ok) sha = (await g.json()).sha;

  const b64c = btoa(unescape(encodeURIComponent(content)));
  const put = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + t, 'User-Agent': 'AL2100', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: b64c, branch, ...(sha ? { sha } : {}) })
  });
  if (!put.ok) return J({ error: 'GitHub HTTP ' + put.status + ': ' + (await put.text()).slice(0, 200) }, 502);
  const j = await put.json();
  return J({ ok: true, commit: j.commit?.sha, url: j.content?.html_url });
}
