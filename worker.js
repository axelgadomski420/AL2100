const SYSTEM_PROMPT = `Jesteś AL2100 — prywatnym systemem operacyjnym AI użytkownika. Odpowiadasz po polsku, rzeczowo, bezpośrednio. Rozróżniasz fakty, opinie, domysły i niepewność. Wykorzystujesz pełną historię rozmowy oraz pamięć użytkownika. Nie zmyślasz i nie udajesz, że pamiętasz, jeżeli nie ma danych w kontekście. Jeżeli brakuje informacji — zadajesz precyzyjne pytanie. Nie moralizujesz. Formatujesz odpowiedzi w Markdown, bloki kodu w potrójnych backtickach.`;

const PROVIDERS = {
  openrouter: { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1/chat/completions', defaultModel: 'openai/gpt-4o-mini', models: ['openai/gpt-4o-mini', 'openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-flash-1.5', 'meta-llama/llama-3.1-70b-instruct'] },
  groq: { name: 'Groq', base: 'https://api.groq.com/openai/v1/chat/completions', defaultModel: 'llama-3.1-8b-instant', models: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile', 'mixtral-8x7b-32768', 'gemma2-9b-it'] },
  gemini: { name: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/models/', defaultModel: 'gemini-1.5-flash', models: ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'] },
  mistral: { name: 'Mistral', base: 'https://api.mistral.ai/v1/chat/completions', defaultModel: 'mistral-small-latest', models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest'] },
  cloudflare: { name: 'Cloudflare Workers AI', defaultModel: '@cf/meta/llama-3.1-8b-instruct', models: ['@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.1-70b-instruct', '@cf/qwen/qwen1.5-14b-chat-awq'] }
};
const ORDER = ['openrouter', 'groq', 'gemini', 'mistral', 'cloudflare'];
const enc = new TextEncoder(), dec = new TextDecoder();

function json(d, s = 200, h = {}) { return new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...h } }); }
function err(m, s = 400) { return json({ error: m }, s); }
function uid() { return crypto.randomUUID(); }
function b64(buf) { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
function unb64(str) { const b = atob(str); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

async function hmac(key, data) { const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return b64(await crypto.subtle.sign('HMAC', k, enc.encode(data))); }
async function encKey(env) { return crypto.subtle.importKey('raw', unb64(env.AL_MASTER_ENCRYPTION_KEY), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }
async function encrypt(env, pt) { const k = await encKey(env); const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(pt)); return { cipher: b64(ct), iv: b64(iv) }; }
async function decrypt(env, cipher, iv) { const k = await encKey(env); const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, k, unb64(cipher)); return dec.decode(pt); }

function getCookie(req, name) { const c = req.headers.get('Cookie') || ''; const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)')); return m ? m[1] : null; }
function setCookie(name, value, maxAge) { let c = `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax`; if (maxAge != null) c += `; Max-Age=${maxAge}`; return c; }

async function verifySession(req, env) {
  const raw = getCookie(req, 'al_session');
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const sid = raw.slice(0, dot), sig = raw.slice(dot + 1);
  const expected = await hmac(env.COOKIE_ENCRYPTION_KEY, sid);
  if (expected !== sig) return null;
  const row = await env.AL_DB.prepare('SELECT s.id AS sid, s.user_id, s.csrf, u.login, u.name, u.email, u.avatar_url FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?').bind(sid, Date.now()).first();
  if (!row) return null;
  return { sessionId: row.sid, userId: row.user_id, csrf: row.csrf, user: { id: row.user_id, login: row.login, name: row.name, email: row.email, avatar_url: row.avatar_url } };
}

async function rateLimit(env, key, max, sec) {
  const id = 'rl:' + key, now = Date.now();
  const raw = await env.AL_KV.get(id, 'json');
  if (!raw || now - raw.start > sec * 1000) { await env.AL_KV.put(id, JSON.stringify({ start: now, count: 1 }), { expirationTtl: sec }); return true; }
  if (raw.count >= max) return false;
  raw.count++;
  await env.AL_KV.put(id, JSON.stringify(raw), { expirationTtl: sec });
  return true;
}

async function audit(env, userId, action, meta) {
  try { await env.AL_QUEUE.send({ type: 'audit', userId, action, meta: meta || null }); }
  catch { await env.AL_DB.prepare('INSERT INTO audit_log (id, user_id, action, meta, ts) VALUES (?, ?, ?, ?, ?)').bind(uid(), userId || null, action, meta ? JSON.stringify(meta) : null, Date.now()).run(); }
}

async function provRow(env, userId, p) { return env.AL_DB.prepare('SELECT * FROM providers WHERE user_id = ? AND provider = ?').bind(userId, p).first(); }

async function chain(env, userId, requested) {
  const rows = await env.AL_DB.prepare('SELECT provider FROM providers WHERE user_id = ? AND provider != ?').bind(userId, 'github').all();
  const c = new Set((rows.results || []).map(r => r.provider));
  if (env.AI) c.add('cloudflare');
  if (requested && requested !== 'auto' && c.has(requested)) return [requested];
  return ORDER.filter(p => c.has(p));
}

function extractText(data, provider) {
  if (provider === 'gemini') return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (provider === 'cloudflare') return data.response || '';
  return data.choices?.[0]?.message?.content || '';
}

async function callProvider(env, provider, model, messages, opts = {}) {
  const prov = PROVIDERS[provider];
  if (provider === 'cloudflare') { if (!env.AI) throw new Error('Workers AI niedostępne'); return env.AI.run(model || prov.defaultModel, { messages: messages.map(m => ({ role: m.role, content: m.content })), stream: !!opts.stream }); }
  if (!opts.row || !opts.row.key_cipher) throw new Error('Brak klucza API');
  const key = await decrypt(env, opts.row.key_cipher, opts.row.key_iv);
  if (provider === 'gemini') {
    const m = model || prov.defaultModel;
    const act = opts.stream ? 'streamGenerateContent?alt=sse&' : 'generateContent?';
    const url = `${prov.base}${m}:${act}key=${encodeURIComponent(key)}`;
    const contents = messages.filter(x => x.role !== 'system').map(x => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: x.content }] }));
    const sys = messages.find(x => x.role === 'system');
    const body = { contents };
    if (sys) body.systemInstruction = { parts: [{ text: sys.content }] };
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  const headers = { 'Content-Type': 'application/json' };
  let url, body;
  if (provider === 'openrouter') {
    headers.Authorization = 'Bearer ' + key;
    headers['HTTP-Referer'] = env.FRONTEND_URL || 'https://al2100.axelgadomski.workers.dev';
    headers['X-Title'] = 'AL2100';
    url = prov.base;
    body = { model: model || prov.defaultModel, messages, stream: !!opts.stream };
    if (opts.internet) body.plugins = [{ id: 'web', max_results: 5 }];
  } else if (provider === 'groq' || provider === 'mistral') {
    headers.Authorization = 'Bearer ' + key;
    url = prov.base;
    body = { model: model || prov.defaultModel, messages, stream: !!opts.stream };
  }
  return fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function* parseSSE(res, format) {
  const r = res.body.getReader();
  let buf = '';
  while (true) {
    const { done, value } = await r.read();
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

async function authGithub(req, env) {
  if (!env.GITHUB_CLIENT_ID) return err('Brak GITHUB_CLIENT_ID', 500);
  const origin = new URL(req.url).origin;
  const state = uid();
  await env.AL_KV.put('oauth:' + state, '1', { expirationTtl: 600 });
  const params = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: origin + '/auth/github/callback', scope: 'read:user user:email', state, allow_signup: 'true' });
  return new Response(null, { status: 302, headers: { Location: 'https://github.com/login/oauth/authorize?' + params.toString() } });
}

async function authCallback(req, env) {
  const url = new URL(req.url), origin = url.origin;
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  if (!code || !state) return err('Brak code lub state', 400);
  const ok = await env.AL_KV.get('oauth:' + state);
  if (!ok) return err('Nieprawidłowy stan', 400);
  await env.AL_KV.delete('oauth:' + state);
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: origin + '/auth/github/callback' }) });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return err('Błąd OAuth', 400);
  const userRes = await fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer ' + tokenData.access_token, 'User-Agent': 'AL2100', Accept: 'application/vnd.github+json' } });
  if (!userRes.ok) return err('Błąd użytkownika GitHub', 400);
  const gh = await userRes.json();
  let email = gh.email;
  if (!email) {
    try {
      const eRes = await fetch('https://api.github.com/user/emails', { headers: { Authorization: 'Bearer ' + tokenData.access_token, 'User-Agent': 'AL2100' } });
      if (eRes.ok) { const emails = await eRes.json(); const p = emails.find(e => e.primary && e.verified) || emails.find(e => e.verified); if (p) email = p.email; }
    } catch {}
  }
  const now = Date.now();
  let u = await env.AL_DB.prepare('SELECT * FROM users WHERE github_id = ?').bind(String(gh.id)).first();
  if (u) { await env.AL_DB.prepare('UPDATE users SET login = ?, name = ?, email = ?, avatar_url = ?, updated_at = ? WHERE id = ?').bind(gh.login, gh.name || null, email || null, gh.avatar_url, now, u.id).run(); }
  else { const id = uid(); await env.AL_DB.prepare('INSERT INTO users (id, github_id, login, name, email, avatar_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, String(gh.id), gh.login, gh.name || null, email || null, gh.avatar_url, now, now).run(); u = { id }; }
  const sid = uid(), csrf = uid(), exp = now + 1000 * 60 * 60 * 24 * 30;
  await env.AL_DB.prepare('INSERT INTO sessions (id, user_id, csrf, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind(sid, u.id, csrf, exp, now).run();
  const sig = await hmac(env.COOKIE_ENCRYPTION_KEY, sid);
  await audit(env, u.id, 'login', { via: 'github' });
  return new Response(null, { status: 302, headers: { Location: '/', 'Set-Cookie': setCookie('al_session', sid + '.' + sig, 60 * 60 * 24 * 30) } });
}

async function authLogout(req, env, sess) {
  await env.AL_DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sess.sessionId).run();
  await audit(env, sess.userId, 'logout');
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': setCookie('al_session', '', 0) } });
}

async function apiMe(env, sess) {
  const rows = await env.AL_DB.prepare('SELECT provider, model, key_cipher, key_iv FROM providers WHERE user_id = ? AND provider != ?').bind(sess.userId, 'github').all();
  const configured = {};
  for (const r of rows.results || []) { let masked = null; if (r.key_cipher) { try { const k = await decrypt(env, r.key_cipher, r.key_iv); masked = k.slice(0, 4) + '••••' + k.slice(-4); } catch { masked = '••••'; } } configured[r.provider] = { model: r.model, masked }; }
  if (env.AI && !configured.cloudflare) configured.cloudflare = { model: null, masked: null };
  const gh = await env.AL_DB.prepare('SELECT id FROM providers WHERE user_id = ? AND provider = ?').bind(sess.userId, 'github').first();
  return json({ user: sess.user, csrf: sess.csrf, providers: configured, github: !!gh });
}

async function listConvs(env, sess) { const r = await env.AL_DB.prepare('SELECT id, title, provider, model, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200').bind(sess.userId).all(); return json({ conversations: r.results || [] }); }
async function createConv(env, sess, b) { const id = uid(), now = Date.now(), title = (b.title || 'Nowa rozmowa').slice(0, 120); await env.AL_DB.prepare('INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(id, sess.userId, title, now, now).run(); return json({ conversation: { id, title, created_at: now, updated_at: now } }); }
async function getConv(env, sess, id) { const c = await env.AL_DB.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').bind(id, sess.userId).first(); if (!c) return err('Nie znaleziono', 404); return json({ conversation: c }); }
async function patchConv(req, env, sess, id) { const b = await req.json(); const c = await env.AL_DB.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').bind(id, sess.userId).first(); if (!c) return err('Nie znaleziono', 404); if (b.title != null) await env.AL_DB.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').bind(String(b.title).slice(0, 120), Date.now(), id).run(); return json({ ok: true }); }
async function delConv(env, sess, id) { const c = await env.AL_DB.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').bind(id, sess.userId).first(); if (!c) return err('Nie znaleziono', 404); await env.AL_DB.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').bind(id, sess.userId).run(); return json({ ok: true }); }
async function getMsgs(env, sess, id) { const c = await env.AL_DB.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').bind(id, sess.userId).first(); if (!c) return err('Nie znaleziono', 404); const r = await env.AL_DB.prepare('SELECT id, role, content, provider, model, status, generation_id, ts FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY ts ASC').bind(id, sess.userId).all(); return json({ messages: r.results || [] }); }
async function patchMsg(req, env, sess, convId, msgId) { const b = await req.json(); const m = await env.AL_DB.prepare('SELECT id, role FROM messages WHERE id = ? AND conversation_id = ? AND user_id = ?').bind(msgId, convId, sess.userId).first(); if (!m) return err('Nie znaleziono', 404); if (m.role !== 'user') return err('Można edytować tylko własne', 400); const content = String(b.content || '').trim(); if (!content) return err('Puste', 400); await env.AL_DB.prepare('UPDATE messages SET content = ? WHERE id = ?').bind(content, msgId).run(); return json({ ok: true }); }
async function delMsg(env, sess, convId, msgId) { const m = await env.AL_DB.prepare('SELECT id FROM messages WHERE id = ? AND conversation_id = ? AND user_id = ?').bind(msgId, convId, sess.userId).first(); if (!m) return err('Nie znaleziono', 404); await env.AL_DB.prepare('DELETE FROM messages WHERE id = ?').bind(msgId).run(); return json({ ok: true }); }

async function buildContext(env, userId, convId, internet) {
  const memRes = await env.AL_DB.prepare('SELECT content FROM memory WHERE user_id = ? AND enabled = 1 ORDER BY pinned DESC, updated_at DESC LIMIT 50').bind(userId).all();
  const facts = (memRes.results || []).map(m => '- ' + m.content).join('\n');
  const allRes = await env.AL_DB.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY ts ASC').bind(convId).all();
  let history = (allRes.results || []).map(m => ({ role: m.role, content: m.content }));
  if (history.length > 40) history = [history[0], ...history.slice(-39)];
  let sys = SYSTEM_PROMPT;
  if (facts) sys += '\n\nPamięć użytkownika:\n' + facts;
  if (internet) sys += '\n\nTryb internetowy aktywny. Cytuj źródła.';
  return [{ role: 'system', content: sys }, ...history];
}

async function ensureConv(env, sess, convId, msg) {
  if (convId) { const c = await env.AL_DB.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').bind(convId, sess.userId).first(); if (!c) throw new Error('Rozmowa nie znaleziona'); return convId; }
  const id = uid(), now = Date.now();
  const title = msg.slice(0, 60) + (msg.length > 60 ? '…' : '');
  await env.AL_DB.prepare('INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(id, sess.userId, title, now, now).run();
  return id;
}

async function chatStream(req, env, sess) {
  const ok = await rateLimit(env, 'chat:' + sess.userId, 30, 60);
  if (!ok) return err('Zbyt wiele wiadomości', 429);
  const b = await req.json();
  const message = String(b.message || '').trim();
  if (!message) return err('Pusta wiadomość', 400);
  if (message.length > 12000) return err('Za długa', 400);
  const convId = await ensureConv(env, sess, b.conversation_id, message);
  const genId = uid();
  await env.AL_DB.prepare('INSERT INTO messages (id, conversation_id, user_id, role, content, ts) VALUES (?, ?, ?, ?, ?, ?)').bind(uid(), convId, sess.userId, 'user', message, Date.now()).run();
  const messages = await buildContext(env, sess.userId, convId, !!b.internet);
  const ch = await chain(env, sess.userId, b.provider);
  if (!ch.length) return err('Brak dostawców AI', 400);
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const send = async (obj) => { try { await writer.write(enc.encode('data: ' + JSON.stringify(obj) + '\n\n')); } catch {} };
  const userId = sess.userId;
  (async () => {
    await send({ type: 'meta', conversation_id: convId, generation_id: genId });
    let usedProv = null, usedModel = null, full = '', lastErr = null, stopped = false;
    for (const p of ch) {
      try {
        const row = p === 'cloudflare' ? null : await provRow(env, userId, p);
        if (p !== 'cloudflare' && !row) continue;
        const model = row?.model || PROVIDERS[p].defaultModel;
        const res = await callProvider(env, p, model, messages, { stream: true, row, internet: !!b.internet });
        if (p !== 'cloudflare' && !res.ok) { const t = await res.text().catch(() => ''); throw new Error(p + ' ' + res.status + ': ' + t.slice(0, 200)); }
        usedProv = p; usedModel = model;
        await send({ type: 'provider', provider: p, model });
        const fmt = p === 'gemini' ? 'gemini' : p === 'cloudflare' ? 'cf' : 'openai';
        let i = 0;
        for await (const t of parseSSE(res, fmt)) {
          if ((++i % 5) === 0) { if (await env.AL_KV.get('stop:' + userId + ':' + genId)) { stopped = true; break; } }
          full += t;
          await send({ type: 'chunk', text: full });
          if (stopped) break;
        }
        if (stopped) break;
        break;
      } catch (e) { lastErr = e; await send({ type: 'warn', provider: p, message: String(e.message || e).slice(0, 300) }); }
    }
    if (full) {
      const aid = uid();
      const status = stopped ? 'interrupted' : 'complete';
      await env.AL_DB.prepare('INSERT INTO messages (id, conversation_id, user_id, role, content, provider, model, status, generation_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(aid, convId, userId, 'assistant', full, usedProv, usedModel, status, genId, Date.now()).run();
      await env.AL_DB.prepare('UPDATE conversations SET updated_at = ?, provider = ?, model = ? WHERE id = ?').bind(Date.now(), usedProv, usedModel, convId).run();
      await send({ type: stopped ? 'interrupted' : 'done', message_id: aid, provider: usedProv, model: usedModel, status });
      await audit(env, userId, 'chat', { provider: usedProv, model: usedModel, status });
    } else {
      await send({ type: 'error', message: lastErr ? String(lastErr.message || lastErr) : 'Brak odpowiedzi' });
    }
    try { await writer.close(); } catch {}
  })();
  return new Response(readable, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}

async function chatStop(req, env, sess) {
  const b = await req.json();
  const genId = String(b.generation_id || '');
  if (!genId) return err('Brak generation_id', 400);
  await env.AL_KV.put('stop:' + sess.userId + ':' + genId, '1', { expirationTtl: 120 });
  return json({ ok: true });
}

async function completeStream(req, env, sess) {
  const ok = await rateLimit(env, 'complete:' + sess.userId, 20, 60);
  if (!ok) return err('Zbyt wiele', 429);
  const b = await req.json();
  const prompt = String(b.prompt || '').trim();
  const system = String(b.system || '').trim();
  if (!prompt) return err('Brak prompt', 400);
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const ch = await chain(env, sess.userId, b.provider);
  if (!ch.length) return err('Brak dostawców', 400);
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const send = async (obj) => { try { await writer.write(enc.encode('data: ' + JSON.stringify(obj) + '\n\n')); } catch {} };
  const userId = sess.userId;
  (async () => {
    let usedProv = null, usedModel = null, full = '', lastErr = null;
    for (const p of ch) {
      try {
        const row = p === 'cloudflare' ? null : await provRow(env, userId, p);
        if (p !== 'cloudflare' && !row) continue;
        const model = row?.model || PROVIDERS[p].defaultModel;
        const res = await callProvider(env, p, model, messages, { stream: true, row });
        if (p !== 'cloudflare' && !res.ok) throw new Error(p + ' ' + res.status);
        usedProv = p; usedModel = model;
        await send({ type: 'provider', provider: p, model });
        const fmt = p === 'gemini' ? 'gemini' : p === 'cloudflare' ? 'cf' : 'openai';
        for await (const t of parseSSE(res, fmt)) { full += t; await send({ type: 'chunk', text: full }); }
        break;
      } catch (e) { lastErr = e; await send({ type: 'warn', provider: p, message: String(e.message).slice(0, 200) }); }
    }
    if (full) await send({ type: 'done', provider: usedProv, model: usedModel });
    else await send({ type: 'error', message: lastErr ? String(lastErr.message) : 'Brak odpowiedzi' });
    try { await writer.close(); } catch {}
  })();
  return new Response(readable, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
}

async function research(req, env, sess) {
  const ok = await rateLimit(env, 'research:' + sess.userId, 10, 60);
  if (!ok) return err('Zbyt wiele wyszukiwań', 429);
  const b = await req.json();
  const q = String(b.query || '').trim();
  if (!q) return err('Brak zapytania', 400);
  if (q.length > 500) return err('Za długie', 400);
  const row = await provRow(env, sess.userId, 'openrouter');
  if (!row || !row.key_cipher) return err('Research wymaga klucza OpenRouter', 400);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + (await decrypt(env, row.key_cipher, row.key_iv)), 'Content-Type': 'application/json', 'HTTP-Referer': env.FRONTEND_URL, 'X-Title': 'AL2100 Research' },
      body: JSON.stringify({ model: row.model || 'openai/gpt-4o-mini', messages: [{ role: 'user', content: `Wyszukaj w internecie: "${q}". Zwróć 5 najważniejszych wyników jako lista Markdown: tytuł — URL — krótki opis.` }], plugins: [{ id: 'web', max_results: 5 }] })
    });
    if (!res.ok) return err('Błąd wyszukiwania: ' + res.status, 502);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || 'Brak wyników';
    const citations = data.citations || [];
    await audit(env, sess.userId, 'research', { query: q.slice(0, 200) });
    return json({ text, citations });
  } catch (e) { return err('Błąd: ' + String(e.message).slice(0, 200), 502); }
}

async function listProvs(env, sess) {
  const rows = await env.AL_DB.prepare('SELECT provider, model FROM providers WHERE user_id = ? AND provider != ?').bind(sess.userId, 'github').all();
  const map = {};
  for (const r of rows.results || []) map[r.provider] = { model: r.model, hasKey: true };
  if (env.AI && !map.cloudflare) map.cloudflare = { model: null, hasKey: false };
  return json({ providers: map });
}

async function upsertProv(req, env, sess, b) {
  const p = b.provider;
  if (!PROVIDERS[p]) return err('Nieznany dostawca', 400);
  const model = String(b.model || PROVIDERS[p].defaultModel).slice(0, 120);
  const key = b.key ? String(b.key).trim() : '';
  const now = Date.now();
  if (p === 'cloudflare') {
    const ex = await env.AL_DB.prepare('SELECT id FROM providers WHERE user_id = ? AND provider = ?').bind(sess.userId, p).first();
    if (ex) await env.AL_DB.prepare('UPDATE providers SET model = ?, updated_at = ? WHERE id = ?').bind(model, now, ex.id).run();
    else await env.AL_DB.prepare('INSERT INTO providers (id, user_id, provider, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(uid(), sess.userId, p, model, now, now).run();
    return json({ ok: true });
  }
  if (!key) return err('Brak klucza API', 400);
  if (key.length < 10) return err('Klucz nieprawidłowy', 400);
  const enc2 = await encrypt(env, key);
  const ex = await env.AL_DB.prepare('SELECT id FROM providers WHERE user_id = ? AND provider = ?').bind(sess.userId, p).first();
  if (ex) await env.AL_DB.prepare('UPDATE providers SET key_cipher = ?, key_iv = ?, key_version = 1, model = ?, updated_at = ? WHERE id = ?').bind(enc2.cipher, enc2.iv, model, now, ex.id).run();
  else await env.AL_DB.prepare('INSERT INTO providers (id, user_id, provider, key_cipher, key_iv, key_version, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(uid(), sess.userId, p, enc2.cipher, enc2.iv, 1, model, now, now).run();
  await audit(env, sess.userId, 'provider_upsert', { provider: p });
  return json({ ok: true });
}

async function delProv(env, sess, p) { await env.AL_DB.prepare('DELETE FROM providers WHERE user_id = ? AND provider = ?').bind(sess.userId, p).run(); await audit(env, sess.userId, 'provider_delete', { provider: p }); return json({ ok: true }); }

async function testProv(env, sess, p) {
  if (p === 'cloudflare') { if (!env.AI) return err('Brak Workers AI', 400); try { const r = await env.AI.run(PROVIDERS.cloudflare.defaultModel, { messages: [{ role: 'user', content: 'OK' }] }); return json({ ok: true, sample: extractText(r, 'cloudflare').slice(0, 100) }); } catch (e) { return err(String(e.message).slice(0, 200), 502); } }
  const row = await provRow(env, sess.userId, p);
  if (!row || !row.key_cipher) return err('Brak klucza', 400);
  try {
    const res = await callProvider(env, p, row.model, [{ role: 'user', content: 'OK' }], { row, stream: false });
    if (!res.ok) { const t = await res.text().catch(() => ''); return err('Test nieudany: ' + res.status, 502); }
    const data = await res.json();
    return json({ ok: true, sample: extractText(data, p).slice(0, 100) });
  } catch (e) { return err(String(e.message).slice(0, 200), 502); }
}

async function listModels(env, sess) {
  const rows = await env.AL_DB.prepare('SELECT provider FROM providers WHERE user_id = ? AND provider != ?').bind(sess.userId, 'github').all();
  const set = new Set((rows.results || []).map(r => r.provider));
  if (env.AI) set.add('cloudflare');
  const models = {};
  for (const p of set) models[p] = PROVIDERS[p] ? PROVIDERS[p].models : [];
  return json({ models, order: ORDER.filter(p => set.has(p)) });
}

async function githubSaveToken(req, env, sess) {
  const b = await req.json();
  const token = String(b.token || '').trim();
  if (!token || token.length < 10) return err('Nieprawidłowy token', 400);
  const enc2 = await encrypt(env, token);
  const now = Date.now();
  const ex = await env.AL_DB.prepare('SELECT id FROM providers WHERE user_id = ? AND provider = ?').bind(sess.userId, 'github').first();
  if (ex) await env.AL_DB.prepare('UPDATE providers SET key_cipher = ?, key_iv = ?, updated_at = ? WHERE id = ?').bind(enc2.cipher, enc2.iv, now, ex.id).run();
  else await env.AL_DB.prepare('INSERT INTO providers (id, user_id, provider, key_cipher, key_iv, key_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(uid(), sess.userId, 'github', enc2.cipher, enc2.iv, 1, now, now).run();
  await audit(env, sess.userId, 'github_token_save');
  return json({ ok: true });
}

async function githubDelToken(env, sess) {
  await env.AL_DB.prepare('DELETE FROM providers WHERE user_id = ? AND provider = ?').bind(sess.userId, 'github').run();
  return json({ ok: true });
}

async function githubPush(req, env, sess) {
  const b = await req.json();
  const repo = String(b.repo || '').trim();
  const filePath = String(b.path || 'index.html').trim();
  const content = String(b.content || '');
  if (!repo || !content) return err('Brak repo lub content', 400);
  const row = await env.AL_DB.prepare('SELECT key_cipher, key_iv FROM providers WHERE user_id = ? AND provider = ?').bind(sess.userId, 'github').first();
  if (!row || !row.key_cipher) return err('Brak tokenu GitHub', 400);
  const token = await decrypt(env, row.key_cipher, row.key_iv);
  const ghHeaders = { Authorization: 'token ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'AL2100' };
  const userRes = await fetch('https://api.github.com/user', { headers: ghHeaders });
  if (!userRes.ok) return err('Token GitHub nieprawidłowy', 400);
  const user = await userRes.json();
  const owner = user.login;
  let sha = null;
  try {
    const getRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, { headers: ghHeaders });
    if (getRes.ok) { const data = await getRes.json(); sha = data.sha; }
  } catch {}
  const encoded = btoa(unescape(encodeURIComponent(content)));
  const putBody = { message: b.message || 'AL2100 deploy', content: encoded, ...(sha ? { sha } : {}) };
  const putRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, { method: 'PUT', headers: { ...ghHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(putBody) });
  if (!putRes.ok) { const e = await putRes.json().catch(() => ({})); return err('GitHub: ' + (e.message || putRes.status), putRes.status); }
  const result = await putRes.json();
  await audit(env, sess.userId, 'github_push', { repo, path: filePath });
  return json({ ok: true, url: result.content?.html_url });
}

async function listMem(env, sess) { const r = await env.AL_DB.prepare('SELECT * FROM memory WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC').bind(sess.userId).all(); return json({ memory: r.results || [] }); }
async function createMem(req, env, sess) { const b = await req.json(); const c = String(b.content || '').trim(); if (!c) return err('Puste', 400); const id = uid(), now = Date.now(); await env.AL_DB.prepare('INSERT INTO memory (id, user_id, content, category, pinned, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, sess.userId, c.slice(0, 2000), b.category || 'fact', b.pinned ? 1 : 0, b.enabled === false ? 0 : 1, now, now).run(); return json({ ok: true, id }); }
async function patchMem(req, env, sess, id) { const b = await req.json(); const m = await env.AL_DB.prepare('SELECT id FROM memory WHERE id = ? AND user_id = ?').bind(id, sess.userId).first(); if (!m) return err('Nie znaleziono', 404); const f = [], v = []; if (b.content != null) { f.push('content = ?'); v.push(String(b.content).slice(0, 2000)); } if (b.category != null) { f.push('category = ?'); v.push(String(b.category)); } if (b.pinned != null) { f.push('pinned = ?'); v.push(b.pinned ? 1 : 0); } if (b.enabled != null) { f.push('enabled = ?'); v.push(b.enabled ? 1 : 0); } if (!f.length) return json({ ok: true }); f.push('updated_at = ?'); v.push(Date.now()); v.push(id, sess.userId); await env.AL_DB.prepare('UPDATE memory SET ' + f.join(', ') + ' WHERE id = ? AND user_id = ?').bind(...v).run(); return json({ ok: true }); }
async function delMem(env, sess, id) { await env.AL_DB.prepare('DELETE FROM memory WHERE id = ? AND user_id = ?').bind(id, sess.userId).run(); return json({ ok: true }); }

async function listProj(env, sess) { const r = await env.AL_DB.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').bind(sess.userId).all(); return json({ projects: r.results || [] }); }
async function createProj(req, env, sess) { const b = await req.json(); const name = String(b.name || '').trim(); if (!name) return err('Brak nazwy', 400); const id = uid(), now = Date.now(); await env.AL_DB.prepare('INSERT INTO projects (id, user_id, name, goal, stage, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, sess.userId, name.slice(0, 200), b.goal || '', b.stage || 'planning', b.notes || '', now, now).run(); return json({ ok: true, id }); }
async function patchProj(req, env, sess, id) { const b = await req.json(); const p = await env.AL_DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(id, sess.userId).first(); if (!p) return err('Nie znaleziono', 404); const f = [], v = []; for (const k of ['name', 'goal', 'stage', 'notes']) if (b[k] != null) { f.push(k + ' = ?'); v.push(String(b[k])); } if (!f.length) return json({ ok: true }); f.push('updated_at = ?'); v.push(Date.now()); v.push(id, sess.userId); await env.AL_DB.prepare('UPDATE projects SET ' + f.join(', ') + ' WHERE id = ? AND user_id = ?').bind(...v).run(); return json({ ok: true }); }
async function delProj(env, sess, id) { await env.AL_DB.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').bind(id, sess.userId).run(); return json({ ok: true }); }

async function listTasks(env, sess) { const r = await env.AL_DB.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY updated_at DESC LIMIT 500').bind(sess.userId).all(); return json({ tasks: r.results || [] }); }
async function createTask(req, env, sess) { const b = await req.json(); const t = String(b.title || '').trim(); if (!t) return err('Brak tytułu', 400); const id = uid(), now = Date.now(); await env.AL_DB.prepare('INSERT INTO tasks (id, user_id, project_id, title, status, priority, deadline, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, sess.userId, b.project_id || null, t.slice(0, 300), b.status || 'todo', b.priority || 'normal', b.deadline || null, b.description || '', now, now).run(); return json({ ok: true, id }); }
async function patchTask(req, env, sess, id) { const b = await req.json(); const t = await env.AL_DB.prepare('SELECT id FROM tasks WHERE id = ? AND user_id = ?').bind(id, sess.userId).first(); if (!t) return err('Nie znaleziono', 404); const f = [], v = []; for (const k of ['title', 'status', 'priority', 'deadline', 'description', 'project_id']) if (b[k] !== undefined) { f.push(k + ' = ?'); v.push(b[k] === null ? null : String(b[k])); } if (!f.length) return json({ ok: true }); f.push('updated_at = ?'); v.push(Date.now()); v.push(id, sess.userId); await env.AL_DB.prepare('UPDATE tasks SET ' + f.join(', ') + ' WHERE id = ? AND user_id = ?').bind(...v).run(); return json({ ok: true }); }
async function delTask(env, sess, id) { await env.AL_DB.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').bind(id, sess.userId).run(); return json({ ok: true }); }

async function listNotes(env, sess) { const r = await env.AL_DB.prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC').bind(sess.userId).all(); return json({ notes: r.results || [] }); }
async function createNote(req, env, sess) { const b = await req.json(); const id = uid(), now = Date.now(); await env.AL_DB.prepare('INSERT INTO notes (id, user_id, title, content, tags, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, sess.userId, b.title || '', b.content || '', JSON.stringify(b.tags || []), b.pinned ? 1 : 0, now, now).run(); return json({ ok: true, id }); }
async function patchNote(req, env, sess, id) { const b = await req.json(); const n = await env.AL_DB.prepare('SELECT id FROM notes WHERE id = ? AND user_id = ?').bind(id, sess.userId).first(); if (!n) return err('Nie znaleziono', 404); const f = [], v = []; if (b.title != null) { f.push('title = ?'); v.push(String(b.title)); } if (b.content != null) { f.push('content = ?'); v.push(String(b.content)); } if (b.tags != null) { f.push('tags = ?'); v.push(JSON.stringify(b.tags)); } if (b.pinned != null) { f.push('pinned = ?'); v.push(b.pinned ? 1 : 0); } if (!f.length) return json({ ok: true }); f.push('updated_at = ?'); v.push(Date.now()); v.push(id, sess.userId); await env.AL_DB.prepare('UPDATE notes SET ' + f.join(', ') + ' WHERE id = ? AND user_id = ?').bind(...v).run(); return json({ ok: true }); }
async function delNote(env, sess, id) { await env.AL_DB.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').bind(id, sess.userId).run(); return json({ ok: true }); }

async function listFiles(env, sess) { const r = await env.AL_DB.prepare('SELECT id, name, type, size, created_at FROM files WHERE user_id = ? ORDER BY created_at DESC').bind(sess.userId).all(); return json({ files: r.results || [] }); }
async function uploadFile(req, env, sess) {
  const ct = req.headers.get('Content-Type') || '';
  if (!ct.includes('multipart/form-data')) return err('Wymagany multipart', 400);
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return err('Brak pliku', 400);
  const name = file.name || 'file';
  const ext = name.split('.').pop().toLowerCase();
  if (!['txt', 'md', 'json', 'csv'].includes(ext)) return err('Nieobsługiwany typ: ' + ext, 400);
  if (file.size > 2 * 1024 * 1024) return err('Za duży (max 2 MB)', 400);
  const id = uid(), r2key = sess.userId + '/' + id + '.' + ext;
  await env.AL_BUCKET.put(r2key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || 'text/plain' } });
  await env.AL_DB.prepare('INSERT INTO files (id, user_id, name, type, size, r2_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, sess.userId, name.slice(0, 200), ext, file.size, r2key, Date.now()).run();
  return json({ ok: true, id });
}
async function getFile(env, sess, id) { const f = await env.AL_DB.prepare('SELECT * FROM files WHERE id = ? AND user_id = ?').bind(id, sess.userId).first(); if (!f) return err('Nie znaleziono', 404); const obj = await env.AL_BUCKET.get(f.r2_key); if (!obj) return err('Brak w R2', 404); const text = await obj.text(); return json({ file: { id: f.id, name: f.name, type: f.type, size: f.size, content: text.slice(0, 200000) } }); }
async function delFile(env, sess, id) { const f = await env.AL_DB.prepare('SELECT r2_key FROM files WHERE id = ? AND user_id = ?').bind(id, sess.userId).first(); if (!f) return err('Nie znaleziono', 404); try { await env.AL_BUCKET.delete(f.r2_key); } catch {} await env.AL_DB.prepare('DELETE FROM files WHERE id = ? AND user_id = ?').bind(id, sess.userId).run(); return json({ ok: true }); }

const SEC = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'geolocation=(), microphone=(), camera=()' };
function secWrap(res) { const h = new Headers(res.headers); for (const [k, v] of Object.entries(SEC)) h.set(k, v); return new Response(res.body, { status: res.status, headers: h }); }

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': url.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-CSRF-Token' } });

    if (path === '/auth/github' && method === 'GET') return secWrap(await authGithub(request, env));
    if (path === '/auth/github/callback' && method === 'GET') return secWrap(await authCallback(request, env));

    if (path.startsWith('/api/') || path.startsWith('/auth/')) {
      const sess = await verifySession(request, env);
      if (path === '/api/me' && method === 'GET') { if (!sess) return err('Nieautoryzowany', 401); return secWrap(await apiMe(env, sess)); }
      if (!sess) return err('Nieautoryzowany', 401);
      if (method !== 'GET') { const h = request.headers.get('X-CSRF-Token'); if (!h || h !== sess.csrf) return err('CSRF', 403); }
      if (path === '/auth/logout' && method === 'POST') return secWrap(await authLogout(request, env, sess));

      if (path === '/api/conversations') {
        if (method === 'GET') return secWrap(await listConvs(env, sess));
        if (method === 'POST') return secWrap(await createConv(env, sess, await request.json()));
      }
      let m;
      if ((m = path.match(/^\/api\/conversations\/([^/]+)$/))) {
        if (method === 'GET') return secWrap(await getConv(env, sess, m[1]));
        if (method === 'PATCH') return secWrap(await patchConv(request, env, sess, m[1]));
        if (method === 'DELETE') return secWrap(await delConv(env, sess, m[1]));
      }
      if ((m = path.match(/^\/api\/conversations\/([^/]+)\/messages$/)) && method === 'GET') return secWrap(await getMsgs(env, sess, m[1]));
      if ((m = path.match(/^\/api\/conversations\/([^/]+)\/messages\/([^/]+)$/))) {
        if (method === 'PATCH') return secWrap(await patchMsg(request, env, sess, m[1], m[2]));
        if (method === 'DELETE') return secWrap(await delMsg(env, sess, m[1], m[2]));
      }

      if (path === '/api/chat/stream' && method === 'POST') return secWrap(await chatStream(request, env, sess));
      if (path === '/api/chat/stop' && method === 'POST') return secWrap(await chatStop(request, env, sess));
      if (path === '/api/complete' && method === 'POST') return secWrap(await completeStream(request, env, sess));
      if (path === '/api/research' && method === 'POST') return secWrap(await research(request, env, sess));
      if (path === '/api/models' && method === 'GET') return secWrap(await listModels(env, sess));

      if (path === '/api/providers') {
        if (method === 'GET') return secWrap(await listProvs(env, sess));
        if (method === 'POST') return secWrap(await upsertProv(request, env, sess, await request.json()));
      }
      if ((m = path.match(/^\/api\/providers\/([^/]+)\/test$/)) && method === 'POST') return secWrap(await testProv(env, sess, m[1]));
      if ((m = path.match(/^\/api\/providers\/([^/]+)$/)) && method === 'DELETE') return secWrap(await delProv(env, sess, m[1]));

      if (path === '/api/github/token' && method === 'POST') return secWrap(await githubSaveToken(request, env, sess));
      if (path === '/api/github/token' && method === 'DELETE') return secWrap(await githubDelToken(env, sess));
      if (path === '/api/github/push' && method === 'POST') return secWrap(await githubPush(request, env, sess));

      if (path === '/api/memory') { if (method === 'GET') return secWrap(await listMem(env, sess)); if (method === 'POST') return secWrap(await createMem(request, env, sess)); }
      if ((m = path.match(/^\/api\/memory\/([^/]+)$/))) { if (method === 'PATCH') return secWrap(await patchMem(request, env, sess, m[1])); if (method === 'DELETE') return secWrap(await delMem(env, sess, m[1])); }

      if (path === '/api/projects') { if (method === 'GET') return secWrap(await listProj(env, sess)); if (method === 'POST') return secWrap(await createProj(request, env, sess)); }
      if ((m = path.match(/^\/api\/projects\/([^/]+)$/))) { if (method === 'PATCH') return secWrap(await patchProj(request, env, sess, m[1])); if (method === 'DELETE') return secWrap(await delProj(env, sess, m[1])); }

      if (path === '/api/tasks') { if (method === 'GET') return secWrap(await listTasks(env, sess)); if (method === 'POST') return secWrap(await createTask(request, env, sess)); }
      if ((m = path.match(/^\/api\/tasks\/([^/]+)$/))) { if (method === 'PATCH') return secWrap(await patchTask(request, env, sess, m[1])); if (method === 'DELETE') return secWrap(await delTask(env, sess, m[1])); }

      if (path === '/api/notes') { if (method === 'GET') return secWrap(await listNotes(env, sess)); if (method === 'POST') return secWrap(await createNote(request, env, sess)); }
      if ((m = path.match(/^\/api\/notes\/([^/]+)$/))) { if (method === 'PATCH') return secWrap(await patchNote(request, env, sess, m[1])); if (method === 'DELETE') return secWrap(await delNote(env, sess, m[1])); }

      if (path === '/api/files') { if (method === 'GET') return secWrap(await listFiles(env, sess)); if (method === 'POST') return secWrap(await uploadFile(request, env, sess)); }
      if ((m = path.match(/^\/api\/files\/([^/]+)$/))) { if (method === 'GET') return secWrap(await getFile(env, sess, m[1])); if (method === 'DELETE') return secWrap(await delFile(env, sess, m[1])); }

      return err('Endpoint nie znaleziony: ' + path, 404);
    }

    return env.ASSETS.fetch(request);
  },

  async queue(batch, env) {
    for (const msg of batch.messages) {
      try { const j = msg.body; if (j.type === 'audit') await env.AL_DB.prepare('INSERT INTO audit_log (id, user_id, action, meta, ts) VALUES (?, ?, ?, ?, ?)').bind(uid(), j.userId || null, j.action, j.meta ? JSON.stringify(j.meta) : null, Date.now()).run(); msg.ack(); }
      catch { msg.retry(); }
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await env.AL_DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
      await env.AL_DB.prepare('DELETE FROM audit_log WHERE ts < ?').bind(Date.now() - 1000 * 60 * 60 * 24 * 90).run();
    })());
  }
};
