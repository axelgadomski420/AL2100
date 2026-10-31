const SYSTEM_PROMPT = `Jesteś AL2100 — prywatnym systemem operacyjnym AI użytkownika. Odpowiadasz po polsku, rzeczowo i bezpośrednio. Rozróżniasz fakty, opinie, domysły i niepewność. Wykorzystujesz pełną historię rozmowy oraz pamięć użytkownika. Nie zmyślasz i nie udajesz, że pamiętasz, jeżeli nie masz danych w kontekście. Jeżeli brakuje informacji — zadajesz precyzyjne pytanie. Nie moralizujesz. Nie udzielasz instrukcji do działań masowo szkodliwych, broni masowej, ani przestępstw. Formatujesz odpowiedzi w Markdown, bloki kodu w potrójnych backtickach.`;

const PROVIDERS = {
  openrouter: {
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'openai/gpt-4o-mini',
    models: ['openai/gpt-4o-mini', 'openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-flash-1.5', 'meta-llama/llama-3.1-70b-instruct']
  },
  groq: {
    name: 'Groq',
    base: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'llama-3.1-8b-instant',
    models: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'mixtral-8x7b-32768', 'gemma2-9b-it']
  },
  gemini: {
    name: 'Google Gemini',
    base: 'https://generativelanguage.googleapis.com/v1beta/models/',
    defaultModel: 'gemini-1.5-flash',
    models: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash']
  },
  mistral: {
    name: 'Mistral',
    base: 'https://api.mistral.ai/v1/chat/completions',
    defaultModel: 'mistral-small-latest',
    models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest']
  },
  cloudflare: {
    name: 'Cloudflare Workers AI',
    defaultModel: '@cf/meta/llama-3.1-8b-instruct',
    models: ['@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.1-70b-instruct', '@cf/qwen/qwen1.5-14b-chat-awq']
  }
};

const ORDER = ['openrouter', 'groq', 'gemini', 'mistral', 'cloudflare'];
const enc = new TextEncoder();
const dec = new TextDecoder();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

function uuid() { return crypto.randomUUID(); }

function b64encode(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSign(key, data) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64encode(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

async function getEncKey(env) {
  const raw = b64decode(env.AL_MASTER_ENCRYPTION_KEY);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptKey(env, plaintext) {
  const key = await getEncKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return { cipher: b64encode(ct), iv: b64encode(iv) };
}

async function decryptKey(env, cipher, iv) {
  const key = await getEncKey(env);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(iv) }, key, b64decode(cipher));
  return dec.decode(pt);
}

function getCookie(request, name) {
  const c = request.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}

function cookieHeader(name, value, opts = {}) {
  let c = `${name}=${value}; Path=${opts.path || '/'}`;
  if (opts.maxAge != null) c += `; Max-Age=${opts.maxAge}`;
  if (opts.httpOnly !== false) c += '; HttpOnly';
  if (opts.secure !== false) c += '; Secure';
  c += `; SameSite=${opts.sameSite || 'Lax'}`;
  return c;
}

async function verifySession(request, env) {
  const raw = getCookie(request, 'al_session');
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const sessionId = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = await hmacSign(env.COOKIE_ENCRYPTION_KEY, sessionId);
  if (expected !== sig) return null;
  const row = await env.AL_DB.prepare(
    'SELECT s.id AS sid, s.user_id, s.csrf, u.login, u.name, u.email, u.avatar_url FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?'
  ).bind(sessionId, Date.now()).first();
  if (!row) return null;
  return {
    sessionId: row.sid,
    userId: row.user_id,
    csrf: row.csrf,
    user: { id: row.user_id, login: row.login, name: row.name, email: row.email, avatar_url: row.avatar_url }
  };
}

async function rateLimit(env, key, max, windowSec) {
  const id = 'rl:' + key;
  const now = Date.now();
  const raw = await env.AL_KV.get(id, 'json');
  if (!raw || now - raw.start > windowSec * 1000) {
    await env.AL_KV.put(id, JSON.stringify({ start: now, count: 1 }), { expirationTtl: windowSec });
    return true;
  }
  if (raw.count >= max) return false;
  raw.count++;
  await env.AL_KV.put(id, JSON.stringify(raw), { expirationTtl: windowSec });
  return true;
}

async function audit(env, userId, action, meta) {
  try {
    await env.AL_QUEUE.send({ type: 'audit', userId, action, meta: meta || null });
  } catch {
    await env.AL_DB.prepare('INSERT INTO audit_log (id, user_id, action, meta, ts) VALUES (?, ?, ?, ?, ?)')
      .bind(uuid(), userId || null, action, meta ? JSON.stringify(meta) : null, Date.now()).run();
  }
}

async function getProviderRow(env, userId, provider) {
  return await env.AL_DB.prepare('SELECT * FROM providers WHERE user_id = ? AND provider = ?').bind(userId, provider).first();
}

async function buildChain(env, userId, requested) {
  const rows = await env.AL_DB.prepare('SELECT provider FROM providers WHERE user_id = ?').bind(userId).all();
  const configured = new Set((rows.results || []).map(r => r.provider));
  if (env.AI) configured.add('cloudflare');
  if (requested && requested !== 'auto' && configured.has(requested)) return [requested];
  return ORDER.filter(p => configured.has(p));
}

async function callProvider(env, provider, model, messages, opts = {}) {
  const prov = PROVIDERS[provider];
  if (!prov) throw new Error('Nieznany dostawca: ' + provider);

  if (provider === 'cloudflare') {
    if (!env.AI) throw new Error('Workers AI binding niedostępny');
    return await env.AI.run(model || prov.defaultModel, {
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: !!opts.stream
    });
  }

  const row = opts.row;
  if (!row || !row.key_cipher) throw new Error('Brak klucza API');
  const apiKey = await decryptKey(env, row.key_cipher, row.key_iv);

  if (provider === 'gemini') {
    const useModel = model || prov.defaultModel;
    const action = opts.stream ? 'streamGenerateContent?alt=sse&' : 'generateContent?';
    const url = `${prov.base}${useModel}:${action}key=${encodeURIComponent(apiKey)}`;
    const contents = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    const sys = messages.find(m => m.role === 'system');
    const body = { contents };
    if (sys) body.systemInstruction = { parts: [{ text: sys.content }] };
    return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  const headers = { 'Content-Type': 'application/json' };
  let url, body;
  if (provider === 'openrouter') {
    headers.Authorization = 'Bearer ' + apiKey;
    headers['HTTP-Referer'] = env.FRONTEND_URL || 'https://al2100.pages.dev';
    headers['X-Title'] = 'AL2100';
    url = prov.base;
    body = { model: model || prov.defaultModel, messages, stream: !!opts.stream };
    if (opts.internet) body.plugins = [{ id: 'web', max_results: 5 }];
  } else if (provider === 'groq' || provider === 'mistral') {
    headers.Authorization = 'Bearer ' + apiKey;
    url = prov.base;
    body = { model: model || prov.defaultModel, messages, stream: !!opts.stream };
  }
  return await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function* parseSSE(res, format) {
  const reader = res.body.getReader();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        let t = '';
        if (format === 'gemini') t = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
        else if (format === 'cf') t = j.response || '';
        else t = j.choices?.[0]?.delta?.content || '';
        if (t) yield t;
      } catch {}
    }
  }
}

async function authGithub(request, env) {
  if (!env.GITHUB_CLIENT_ID) return err('Brak GITHUB_CLIENT_ID', 500);
  const state = uuid();
  await env.AL_KV.put('oauth:' + state, '1', { expirationTtl: 600 });
  const origin = new URL(request.url).origin;
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: origin + '/auth/github/callback',
    scope: 'read:user user:email',
    state,
    allow_signup: 'true'
  });
  return new Response(null, { status: 302, headers: { Location: 'https://github.com/login/oauth/authorize?' + params.toString() } });
}

async function authCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return err('Brak code lub state', 400);
  const st = await env.AL_KV.get('oauth:' + state);
  if (!st) return err('Nieprawidłowy stan OAuth', 400);
  await env.AL_KV.delete('oauth:' + state);

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code })
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return err('Błąd OAuth GitHub', 400);

  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: 'Bearer ' + tokenData.access_token, 'User-Agent': 'AL2100', Accept: 'application/vnd.github+json' }
  });
  if (!userRes.ok) return err('Błąd pobierania użytkownika GitHub', 400);
  const gh = await userRes.json();

  let email = gh.email;
  if (!email) {
    try {
      const eRes = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: 'Bearer ' + tokenData.access_token, 'User-Agent': 'AL2100' }
      });
      if (eRes.ok) {
        const emails = await eRes.json();
        const p = emails.find(e => e.primary && e.verified) || emails.find(e => e.verified);
        if (p) email = p.email;
      }
    } catch {}
  }

  const now = Date.now();
  let user = await env.AL_DB.prepare('SELECT * FROM users WHERE github_id = ?').bind(String(gh.id)).first();
  if (user) {
    await env.AL_DB.prepare('UPDATE users SET login = ?, name = ?, email = ?, avatar_url = ?, updated_at = ? WHERE id = ?')
      .bind(gh.login, gh.name || null, email || null, gh.avatar_url, now, user.id).run();
  } else {
    const id = uuid();
    await env.AL_DB.prepare('INSERT INTO users (id, github_id, login, name, email, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, String(gh.id), gh.login, gh.name || null, email || null, gh.avatar_url, now, now).run();
    user = { id };
  }

  const sessionId = uuid();
  const csrf = uuid();
  const expiresAt = now + 1000 * 60 * 60 * 24 * 30;
  await env.AL_DB.prepare('INSERT INTO sessions (id, user_id, csrf, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(sessionId, user.id, csrf, expiresAt, now).run();

  const sig = await hmacSign(env.COOKIE_ENCRYPTION_KEY, sessionId);
  const cookie = cookieHeader('al_session', sessionId + '.' + sig, { maxAge: 60 * 60 * 24 * 30 });
  await audit(env, user.id, 'login', { via: 'github' });
  return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': cookie } });
}

async function authLogout(request, env, sess) {
  if (!sess) return json({ ok: true });
  const header = request.headers.get('X-CSRF-Token');
  if (header !== sess.csrf) return err('Nieprawidłowy CSRF', 403);
  await env.AL_DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sess.sessionId).run();
  await audit(env, sess.userId, 'logout');
  const cookie = cookieHeader('al_session', '', { maxAge: 0 });
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie } });
}

async function apiMe(request, env, sess) {
  const provs = await env.AL_DB.prepare('SELECT provider, model, key_cipher FROM providers WHERE user_id = ?').bind(sess.userId).all();
  const configured = {};
  for (const r of provs.results || []) {
    let masked = null;
    if (r.key_cipher) {
      try {
        const k = await decryptKey(env, r.key_cipher, (await env.AL_DB.prepare('SELECT key_iv FROM providers WHERE user_id = ? AND provider = ?').bind(sess.userId, r.provider).first()).key_iv);
        masked = k.slice(0, 4) + '••••' + k.slice(-4);
      } catch { masked = '••••'; }
    }
    configured[r.provider] = { model: r.model, masked };
  }
  if (env.AI) configured.cloudflare = configured.cloudflare || { model: null, masked: null };
  return json({ user: sess.user, csrf: sess.csrf, providers: configured });
}

async function listConversations(env, sess) {
  const r = await env.AL_DB.prepare('SELECT id, title, provider, model, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200').bind(sess.userId).all();
  return json({ conversations: r.results || [] });
}

async function createConversation(env, sess, body) {
  const id = uuid();
  const title = (body.title || 'Nowa rozmowa').slice(0, 120);
  const now = Date.now();
  await env.AL_DB.prepare('INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, sess.userId, title, now, now).run();
  return json({ conversation: { id, title, created_at: now, updated_at: now } });
}

async function getConversation(env, sess, id) {
  const c = await env.AL_DB.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').bind(id, sess.userId).first();
  if (!c) return err('Rozmowa nie znaleziona', 404);
  return json({ conversation: c });
}

async function patchConversation(request, env, sess, id) {
  const body = await request.json();
  const c = await env.AL_DB.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').bind(id, sess.userId).first();
  if (!c) return err('Nie znaleziono', 404);
  if (body.title != null) {
    await env.AL_DB.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .bind(String(body.title).slice(0, 120), Date.now(), id).run();
  }
  return json({ ok: true });
}

async function deleteConversation(env, sess, id) {
  const c = await env.AL_DB.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').bind(id, sess.userId).first();
  if (!c) return err('Nie znaleziono', 404);
  await env.AL_DB.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').bind(id, sess.userId).run();
  return json({ ok: true });
}

async function getMessages(env, sess, id) {
  const c = await env.AL_DB.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').bind(id, sess.userId).first();
  if (!c) return err('Nie znaleziono', 404);
  const r = await env.AL_DB.prepare('SELECT id, role, content, provider, model, ts FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY ts ASC').bind(id, sess.userId).all();
  return json({ messages: r.results || [] });
}

async function patchMessage(request, env, sess, convId, msgId) {
  const body = await request.json();
  const m = await env.AL_DB.prepare('SELECT id, role FROM messages WHERE id = ? AND conversation_id = ? AND user_id = ?').bind(msgId, convId, sess.userId).first();
  if (!m) return err('Nie znaleziono', 404);
  if (m.role !== 'user') return err('Można edytować tylko własne wiadomości', 400);
  const content = String(body.content || '').trim();
  if (!content) return err('Puste', 400);
  await env.AL_DB.prepare('UPDATE messages SET content = ? WHERE id = ?').bind(content, msgId).run();
  return json({ ok: true });
}

async function deleteMessage(env, sess, convId, msgId) {
  const m = await env.AL_DB.prepare('SELECT id FROM messages WHERE id = ? AND conversation_id = ? AND user_id = ?').bind(msgId, convId, sess.userId).first();
  if (!m) return err('Nie znaleziono', 404);
  await env.AL_DB.prepare('DELETE FROM messages WHERE id = ?').bind(msgId).run();
  return json({ ok: true });
}

async function chatHandler(request, env, sess) {
  const ok = await rateLimit(env, 'chat:' + sess.userId, 30, 60);
  if (!ok) return err('Zbyt wiele wiadomości, spróbuj za chwilę', 429);

  const body = await request.json();
  const message = String(body.message || '').trim();
  if (!message) return err('Pusta wiadomość', 400);
  if (message.length > 12000) return err('Wiadomość za długa (max 12000 znaków)', 400);

  let convId = body.conversation_id;
  if (!convId) {
    convId = uuid();
    const title = message.slice(0, 60) + (message.length > 60 ? '…' : '');
    const now = Date.now();
    await env.AL_DB.prepare('INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(convId, sess.userId, title, now, now).run();
  } else {
    const c = await env.AL_DB.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').bind(convId, sess.userId).first();
    if (!c) return err('Rozmowa nie znaleziona', 404);
  }

  await env.AL_DB.prepare('INSERT INTO messages (id, conversation_id, user_id, role, content, ts) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(uuid(), convId, sess.userId, 'user', message, Date.now()).run();

  const memRes = await env.AL_DB.prepare('SELECT content FROM memory WHERE user_id = ? AND enabled = 1 ORDER BY pinned DESC, updated_at DESC LIMIT 40').bind(sess.userId).all();
  const memoryFacts = (memRes.results || []).map(m => '- ' + m.content).join('\n');

  const allMsgs = await env.AL_DB.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY ts ASC').bind(convId).all();
  let history = (allMsgs.results || []).map(m => ({ role: m.role, content: m.content }));
  const MAX = 40;
  if (history.length > MAX) {
    const first = history[0];
    const tail = history.slice(-(MAX - 1));
    history = [first, ...tail];
  }

  let system = SYSTEM_PROMPT;
  if (memoryFacts) system += '\n\nPamięć użytkownika (fakty globalne):\n' + memoryFacts;
  if (body.internet) system += '\n\nTryb internetowy jest włączony. Jeżeli dostawca wspiera web plugin, może on wykonać wyszukiwanie. Wykorzystaj wyniki, cytuj źródła.';

  const finalMessages = [{ role: 'system', content: system }, ...history];

  const chain = await buildChain(env, sess.userId, body.provider);
  if (!chain.length) return err('Brak skonfigurowanych dostawców AI', 400);

  const userId = sess.userId;
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const send = async (obj) => {
    try { await writer.write(enc.encode('data: ' + JSON.stringify(obj) + '\n\n')); } catch {}
  };

  (async () => {
    await send({ type: 'meta', conversation_id: convId });
    let usedProvider = null, usedModel = null, full = '', lastErr = null;
    for (const provider of chain) {
      try {
        const row = provider === 'cloudflare' ? null : await getProviderRow(env, userId, provider);
        if (provider !== 'cloudflare' && !row) continue;
        const model = row?.model || PROVIDERS[provider].defaultModel;
        const res = await callProvider(env, provider, model, finalMessages, { stream: true, row, internet: !!body.internet });

        usedProvider = provider;
        usedModel = model;
        await send({ type: 'provider', provider, model });

        if (provider === 'cloudflare') {
          for await (const t of parseSSE(new Response(res), 'cf')) {
            full += t;
            await send({ type: 'chunk', text: full });
          }
        } else if (provider === 'gemini') {
          if (!res.ok) { const txt = await res.text().catch(() => ''); throw new Error('Gemini ' + res.status + ': ' + txt.slice(0, 200)); }
          for await (const t of parseSSE(res, 'gemini')) {
            full += t;
            await send({ type: 'chunk', text: full });
          }
        } else {
          if (!res.ok) { const txt = await res.text().catch(() => ''); throw new Error(provider + ' ' + res.status + ': ' + txt.slice(0, 200)); }
          for await (const t of parseSSE(res, 'openai')) {
            full += t;
            await send({ type: 'chunk', text: full });
          }
        }
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        await send({ type: 'warn', provider, message: String(e.message || e).slice(0, 300) });
      }
    }

    if (full) {
      const aid = uuid();
      await env.AL_DB.prepare('INSERT INTO messages (id, conversation_id, user_id, role, content, provider, model, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(aid, convId, userId, 'assistant', full, usedProvider, usedModel, Date.now()).run();
      await env.AL_DB.prepare('UPDATE conversations SET updated_at = ?, provider = ?, model = ? WHERE id = ?')
        .bind(Date.now(), usedProvider, usedModel, convId).run();
      await send({ type: 'done', message_id: aid, provider: usedProvider, model: usedModel });
      await audit(env, userId, 'chat', { provider: usedProvider, model: usedModel });
    } else {
      await send({ type: 'error', message: lastErr ? String(lastErr.message || lastErr) : 'Brak odpowiedzi z żadnego dostawcy' });
    }
    try { await writer.close(); } catch {}
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}

async function listProviders(env, sess) {
  const rows = await env.AL_DB.prepare('SELECT provider, model FROM providers WHERE user_id = ?').bind(sess.userId).all();
  const map = {};
  for (const r of rows.results || []) map[r.provider] = { model: r.model, hasKey: true };
  if (env.AI) map.cloudflare = map.cloudflare || { model: null, hasKey: false };
  return json({ providers: map, available: ORDER });
}

async function upsertProvider(request, env, sess, body) {
  const provider = body.provider;
  if (!PROVIDERS[provider]) return err('Nieznany dostawca', 400);
  const model = String(body.model || PROVIDERS[provider].defaultModel).slice(0, 120);
  const key = body.key ? String(body.key).trim() : '';
  const now = Date.now();

  if (provider === 'cloudflare') {
    const existing = await env.AL_DB.prepare('SELECT id FROM providers WHERE user_id = ? AND provider = ?').bind(sess.userId, provider).first();
    if (existing) {
      await env.AL_DB.prepare('UPDATE providers SET model = ?, updated_at = ? WHERE id = ?').bind(model, now, existing.id).run();
    } else {
      await env.AL_DB.prepare('INSERT INTO providers (id, user_id, provider, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(uuid(), sess.userId, provider, model, now, now).run();
    }
    return json({ ok: true });
  }

  if (!key) return err('Brak klucza API', 400);
  if (key.length < 10) return err('Klucz wygląda na nieprawidłowy', 400);
  const encKey = await encryptKey(env, key);
  const existing = await env.AL_DB.prepare('SELECT id FROM providers WHERE user_id = ? AND provider = ?').bind(sess.userId, provider).first();
  if (existing) {
    await env.AL_DB.prepare('UPDATE providers SET key_cipher = ?, key_iv = ?, key_version = 1, model = ?, updated_at = ? WHERE id = ?')
      .bind(encKey.cipher, encKey.iv, model, now, existing.id).run();
  } else {
    await env.AL_DB.prepare('INSERT INTO providers (id, user_id, provider, key_cipher, key_iv, key_version, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(uuid(), sess.userId, provider, encKey.cipher, encKey.iv, 1, model, now, now).run();
  }
  await audit(env, sess.userId, 'provider_upsert', { provider });
  return json({ ok: true });
}

async function deleteProvider(env, sess, provider) {
  await env.AL_DB.prepare('DELETE FROM providers WHERE user_id = ? AND provider = ?').bind(sess.userId, provider).run();
  await audit(env, sess.userId, 'provider_delete', { provider });
  return json({ ok: true });
}

async function testProvider(env, sess, provider) {
  if (provider === 'cloudflare') {
    if (!env.AI) return err('Brak bindingu Workers AI', 400);
    try {
      const r = await env.AI.run(PROVIDERS.cloudflare.defaultModel, { messages: [{ role: 'user', content: 'Odpowiedz jednym słowem: OK' }] });
      return json({ ok: true, sample: JSON.stringify(r).slice(0, 100) });
    } catch (e) { return err(String(e.message || e), 502); }
  }
  const row = await getProviderRow(env, sess.userId, provider);
  if (!row || !row.key_cipher) return err('Brak klucza dla tego dostawcy', 400);
  try {
    const res = await callProvider(env, provider, row.model, [{ role: 'user', content: 'Odpowiedz jednym słowem: OK' }], { row, stream: false });
    if (!res.ok) { const t = await res.text().catch(() => ''); return err('Test nieudany: ' + res.status + ' ' + t.slice(0, 200), 502); }
    const data = await res.json().catch(() => ({}));
    let sample = '';
    if (provider === 'gemini') sample = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    else sample = data.choices?.[0]?.message?.content || '';
    return json({ ok: true, sample: sample.slice(0, 100) });
  } catch (e) { return err('Test nieudany: ' + String(e.message || e).slice(0, 200), 502); }
}

async function researchHandler(request, env, sess) {
  const ok = await rateLimit(env, 'research:' + sess.userId, 10, 60);
  if (!ok) return err('Zbyt wiele wyszukiwań', 429);
  const body = await request.json();
  const query = String(body.query || '').trim();
  if (!query) return err('Brak zapytania', 400);
  if (query.length > 500) return err('Zapytanie za długie', 400);

  const row = await getProviderRow(env, sess.userId, 'openrouter');
  if (!row || !row.key_cipher) return err('Research wymaga klucza OpenRouter', 400);

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + (await decryptKey(env, row.key_cipher, row.key_iv)),
        'Content-Type': 'application/json',
        'HTTP-Referer': env.FRONTEND_URL || 'https://al2100.pages.dev',
        'X-Title': 'AL2100 Research'
      },
      body: JSON.stringify({
        model: row.model || 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: `Wyszukaj w internecie aktualne informacje: "${query}". Zwróć 5 najważniejszych wyników jako lista punktowana Markdown: tytuł — URL — 1-2 zdania opisu.` }],
        plugins: [{ id: 'web', max_results: 5 }]
      })
    });
    if (!res.ok) { const t = await res.text().catch(() => ''); return err('Błąd wyszukiwania: ' + res.status, 502); }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || 'Brak wyników';
    const citations = data.citations || [];
    await audit(env, sess.userId, 'research', { query: query.slice(0, 200) });
    return json({ text, citations });
  } catch (e) { return err('Błąd: ' + String(e.message || e).slice(0, 200), 502); }
}

async function listMemory(env, sess) {
  const r = await env.AL_DB.prepare('SELECT * FROM memory WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC').bind(sess.userId).all();
  return json({ memory: r.results || [] });
}

async function createMemory(request, env, sess) {
  const body = await request.json();
  const content = String(body.content || '').trim();
  if (!content) return err('Puste', 400);
  const id = uuid();
  const now = Date.now();
  await env.AL_DB.prepare('INSERT INTO memory (id, user_id, content, category, pinned, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, sess.userId, content.slice(0, 2000), body.category || 'fact', body.pinned ? 1 : 0, body.enabled === false ? 0 : 1, now, now).run();
  return json({ ok: true, id });
}

async function patchMemory(request, env, sess, id) {
  const body = await request.json();
  const m = await env.AL_DB.prepare('SELECT id FROM memory WHERE id = ? AND user_id = ?').bind(id, sess.userId).first();
  if (!m) return err('Nie znaleziono', 404);
  const fields = [];
  const vals = [];
  if (body.content != null) { fields.push('content = ?'); vals.push(String(body.content).slice(0, 2000)); }
  if (body.category != null) { fields.push('category = ?'); vals.push(String(body.category)); }
  if (body.pinned != null) { fields.push('pinned = ?'); vals.push(body.pinned ? 1 : 0); }
  if (body.enabled != null) { fields.push('enabled = ?'); vals.push(body.enabled ? 1 : 0); }
  if (!fields.length) return json({ ok: true });
  fields.push('updated_at = ?'); vals.push(Date.now());
  vals.push(id, sess.userId);
  await env.AL_DB.prepare('UPDATE memory SET ' + fields.join(', ') + ' WHERE id = ? AND user_id = ?').bind(...vals).run();
  return json({ ok: true });
}

async function deleteMemory(env, sess, id) {
  await env.AL_DB.prepare('DELETE FROM memory WHERE id = ? AND user_id = ?').bind(id, sess.userId).run();
  return json({ ok: true });
}

async function listProjects(env, sess) {
  const r = await env.AL_DB.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').bind(sess.userId).all();
  return json({ projects: r.results || [] });
}

async function createProject(request, env, sess) {
  const b = await request.json();
  const name = String(b.name || '').trim();
  if (!name) return err('Brak nazwy', 400);
  const id = uuid();
  const now = Date.now();
  await env.AL_DB.prepare('INSERT INTO projects (id, user_id, name, goal, stage, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, sess.userId, name.slice(0, 200), b.goal || '', b.stage || 'planning', b.notes || '', now, now).run();
  return json({ ok: true, id });
}

async function patchProject(request, env, sess, id) {
  const b = await request.json();
  const p = await env.AL_DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(id, sess.userId).first();
  if (!p) return err('Nie znaleziono', 404);
  const fields = [], vals = [];
  for (const k of ['name', 'goal', 'stage', 'notes']) {
    if (b[k] != null) { fields.push(k + ' = ?'); vals.push(String(b[k])); }
  }
  if (!fields.length) return json({ ok: true });
  fields.push('updated_at = ?'); vals.push(Date.now());
  vals.push(id, sess.userId);
  await env.AL_DB.prepare('UPDATE projects SET ' + fields.join(', ') + ' WHERE id = ? AND user_id = ?').bind(...vals).run();
  return json({ ok: true });
}

async function deleteProject(env, sess, id) {
  await env.AL_DB.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').bind(id, sess.userId).run();
  return json({ ok: true });
}

async function listTasks(env, sess) {
  const r = await env.AL_DB.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY updated_at DESC LIMIT 500').bind(sess.userId).all();
  return json({ tasks: r.results || [] });
}

async function createTask(request, env, sess) {
  const b = await request.json();
  const title = String(b.title || '').trim();
  if (!title) return err('Brak tytułu', 400);
  const id = uuid();
  const now = Date.now();
  await env.AL_DB.prepare('INSERT INTO tasks (id, user_id, project_id, title, status, priority, deadline, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, sess.userId, b.project_id || null, title.slice(0, 300), b.status || 'todo', b.priority || 'normal', b.deadline || null, b.description || '', now, now).run();
  return json({ ok: true, id });
}

async function patchTask(request, env, sess, id) {
  const b = await request.json();
  const t = await env.AL_DB.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').bind(id, sess.userId).first();
  if (!t) return err('Nie znaleziono', 404);
  const fields = [], vals = [];
  for (const k of ['title', 'status', 'priority', 'deadline', 'description', 'project_id']) {
    if (b[k] !== undefined) { fields.push(k + ' = ?'); vals.push(b[k] === null ? null : String(b[k])); }
  }
  if (!fields.length) return json({ ok: true });
  fields.push('updated_at = ?'); vals.push(Date.now());
  vals.push(id, sess.userId);
  await env.AL_DB.prepare('UPDATE tasks SET ' + fields.join(', ') + ' WHERE id = ? AND user_id = ?').bind(...vals).run();
  return json({ ok: true });
}

async function deleteTask(env, sess, id) {
  await env.AL_DB.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').bind(id, sess.userId).run();
  return json({ ok: true });
}

async function listNotes(env, sess) {
  const r = await env.AL_DB.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC').bind(sess.userId).all();
  return json({ notes: r.results || [] });
}

async function createNote(request, env, sess) {
  const b = await request.json();
  const id = uuid();
  const now = Date.now();
  await env.AL_DB.prepare('INSERT INTO notes (id, user_id, title, content, tags, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, sess.userId, b.title || '', b.content || '', JSON.stringify(b.tags || []), b.pinned ? 1 : 0, now, now).run();
  return json({ ok: true, id });
}

async function patchNote(request, env, sess, id) {
  const b = await request.json();
  const n = await env.AL_DB.prepare('SELECT id FROM notes WHERE id = ? AND user_id = ?').bind(id, sess.userId).first();
  if (!n) return err('Nie znaleziono', 404);
  const fields = [], vals = [];
  if (b.title != null) { fields.push('title = ?'); vals.push(String(b.title)); }
  if (b.content != null) { fields.push('content = ?'); vals.push(String(b.content)); }
  if (b.tags != null) { fields.push('tags = ?'); vals.push(JSON.stringify(b.tags)); }
  if (b.pinned != null) { fields.push('pinned = ?'); vals.push(b.pinned ? 1 : 0); }
  if (!fields.length) return json({ ok: true });
  fields.push('updated_at = ?'); vals.push(Date.now());
  vals.push(id, sess.userId);
  await env.AL_DB.prepare('UPDATE notes SET ' + fields.join(', ') + ' WHERE id = ? AND user_id = ?').bind(...vals).run();
  return json({ ok: true });
}

async function deleteNote(env, sess, id) {
  await env.AL_DB.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').bind(id, sess.userId).run();
  return json({ ok: true });
}

async function listFiles(env, sess) {
  const r = await env.AL_DB.prepare('SELECT id, name, type, size, created_at FROM files WHERE user_id = ? ORDER BY created_at DESC').bind(sess.userId).all();
  return json({ files: r.results || [] });
}

async function uploadFile(request, env, sess) {
  const ct = request.headers.get('Content-Type') || '';
  if (!ct.includes('multipart/form-data')) return err('Wymagany multipart/form-data', 400);
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return err('Brak pliku', 400);
  const name = file.name || 'file';
  const ext = name.split('.').pop().toLowerCase();
  if (!['txt', 'md', 'json', 'csv'].includes(ext)) return err('Nieobsługiwany typ: ' + ext, 400);
  if (file.size > 2 * 1024 * 1024) return err('Plik za duży (max 2 MB)', 400);
  const id = uuid();
  const r2key = sess.userId + '/' + id + '.' + ext;
  const buf = await file.arrayBuffer();
  await env.AL_BUCKET.put(r2key, buf, { httpMetadata: { contentType: file.type || 'text/plain' } });
  await env.AL_DB.prepare('INSERT INTO files (id, user_id, name, type, size, r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, sess.userId, name.slice(0, 200), ext, file.size, r2key, Date.now()).run();
  return json({ ok: true, id });
}

async function getFile(request, env, sess, id) {
  const f = await env.AL_DB.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').bind(id, sess.userId).first();
  if (!f) return err('Nie znaleziono', 404);
  const obj = await env.AL_BUCKET.get(f.r2_key);
  if (!obj) return err('Plik nie istnieje w R2', 404);
  const url = new URL(request.url);
  if (url.searchParams.get('download') === '1') {
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(f.name)}"`
      }
    });
  }
  const text = await obj.text();
  return json({ file: { id: f.id, name: f.name, type: f.type, size: f.size, content: text.slice(0, 200000) } });
}

async function deleteFile(env, sess, id) {
  const f = await env.AL_DB.prepare('SELECT r2_key FROM files WHERE id = ? AND user_id = ?').bind(id, sess.userId).first();
  if (!f) return err('Nie znaleziono', 404);
  try { await env.AL_BUCKET.delete(f.r2_key); } catch {}
  await env.AL_DB.prepare('DELETE FROM files WHERE id = ? AND user_id = ?').bind(id, sess.userId).run();
  return json({ ok: true });
}

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
};

function secWrap(res) {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(SEC_HEADERS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { 'Access-Control-Allow-Origin': url.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-CSRF-Token' }
      });
    }

    if (path === '/auth/github' && method === 'GET') return secWrap(await authGithub(request, env));
    if (path === '/auth/github/callback' && method === 'GET') return secWrap(await authCallback(request, env));

    if (path.startsWith('/api/') || path.startsWith('/auth/')) {
      const sess = await verifySession(request, env);

      if (path === '/api/me' && method === 'GET') {
        if (!sess) return err('Nieautoryzowany', 401);
        return secWrap(await apiMe(request, env, sess));
      }

      if (!sess) return err('Nieautoryzowany', 401);

      const csrfRequired = method !== 'GET';
      if (csrfRequired) {
        const h = request.headers.get('X-CSRF-Token');
        if (!h || h !== sess.csrf) return err('Nieprawidłowy token CSRF', 403);
      }

      if (path === '/auth/logout' && method === 'POST') return secWrap(await authLogout(request, env, sess));

      if (path === '/api/conversations') {
        if (method === 'GET') return secWrap(await listConversations(env, sess));
        if (method === 'POST') return secWrap(await createConversation(env, sess, await request.json()));
      }

      let m;
      if ((m = path.match(/^\/api\/conversations\/([^/]+)$/))) {
        if (method === 'GET') return secWrap(await getConversation(env, sess, m[1]));
        if (method === 'PATCH') return secWrap(await patchConversation(request, env, sess, m[1]));
        if (method === 'DELETE') return secWrap(await deleteConversation(env, sess, m[1]));
      }

      if ((m = path.match(/^\/api\/conversations\/([^/]+)\/messages$/))) {
        if (method === 'GET') return secWrap(await getMessages(env, sess, m[1]));
      }

      if ((m = path.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)$/))) {
        if (method === 'PATCH') return secWrap(await patchMessage(request, env, sess, m[1], m[2]));
        if (method === 'DELETE') return secWrap(await deleteMessage(env, sess, m[1], m[2]));
      }

      if (path === '/api/chat' && method === 'POST') return secWrap(await chatHandler(request, env, sess));
      if (path === '/api/chat/stop' && method === 'POST') return secWrap(json({ ok: true }));

      if (path === '/api/providers') {
        if (method === 'GET') return secWrap(await listProviders(env, sess));
        if (method === 'POST') return secWrap(await upsertProvider(request, env, sess, await request.json()));
      }
      if ((m = path.match(/^\/api\/providers\/([^/]+)\/test$/)) && method === 'POST') {
        return secWrap(await testProvider(env, sess, m[1]));
      }
      if ((m = path.match(/^\/api\/providers\/([^/]+)$/)) && method === 'DELETE') {
        return secWrap(await deleteProvider(env, sess, m[1]));
      }

      if (path === '/api/research' && method === 'POST') return secWrap(await researchHandler(request, env, sess));

      if (path === '/api/memory') {
        if (method === 'GET') return secWrap(await listMemory(env, sess));
        if (method === 'POST') return secWrap(await createMemory(request, env, sess));
      }
      if ((m = path.match(/^\/api\/memory\/([^/]+)$/))) {
        if (method === 'PATCH') return secWrap(await patchMemory(request, env, sess, m[1]));
        if (method === 'DELETE') return secWrap(await deleteMemory(env, sess, m[1]));
      }

      if (path === '/api/projects') {
        if (method === 'GET') return secWrap(await listProjects(env, sess));
        if (method === 'POST') return secWrap(await createProject(request, env, sess));
      }
      if ((m = path.match(/^\/api\/projects\/([^/]+)$/))) {
        if (method === 'PATCH') return secWrap(await patchProject(request, env, sess, m[1]));
        if (method === 'DELETE') return secWrap(await deleteProject(env, sess, m[1]));
      }

      if (path === '/api/tasks') {
        if (method === 'GET') return secWrap(await listTasks(env, sess));
        if (method === 'POST') return secWrap(await createTask(request, env, sess));
      }
      if ((m = path.match(/^\/api\/tasks\/([^/]+)$/))) {
        if (method === 'PATCH') return secWrap(await patchTask(request, env, sess, m[1]));
        if (method === 'DELETE') return secWrap(await deleteTask(env, sess, m[1]));
      }

      if (path === '/api/notes') {
        if (method === 'GET') return secWrap(await listNotes(env, sess));
        if (method === 'POST') return secWrap(await createNote(request, env, sess));
      }
      if ((m = path.match(/^\/api\/notes\/([^/]+)$/))) {
        if (method === 'PATCH') return secWrap(await patchNote(request, env, sess, m[1]));
        if (method === 'DELETE') return secWrap(await deleteNote(env, sess, m[1]));
      }

      if (path === '/api/files') {
        if (method === 'GET') return secWrap(await listFiles(env, sess));
        if (method === 'POST') return secWrap(await uploadFile(request, env, sess));
      }
      if ((m = path.match(/^\/api\/files\/([^/]+)$/))) {
        if (method === 'GET') return secWrap(await getFile(request, env, sess, m[1]));
        if (method === 'DELETE') return secWrap(await deleteFile(env, sess, m[1]));
      }

      return err('Endpoint nie znaleziony: ' + path, 404);
    }

    return env.ASSETS.fetch(request);
  },

  async queue(batch, env) {
    for (const msg of batch.messages) {
      try {
        const job = msg.body;
        if (job.type === 'audit') {
          await env.AL_DB.prepare('INSERT INTO audit_log (id, user_id, action, meta, ts) VALUES (?, ?, ?, ?, ?)')
            .bind(uuid(), job.userId || null, job.action, job.meta ? JSON.stringify(job.meta) : null, Date.now()).run();
        }
        msg.ack();
      } catch { msg.retry(); }
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await env.AL_DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
      await env.AL_DB.prepare('DELETE FROM audit_log WHERE ts < ?').bind(Date.now() - 1000 * 60 * 60 * 24 * 90).run();
    })());
  }
};
