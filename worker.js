// ============================================================
// AL2100 — worker.js
// Lokalne konto (email + hasło + 4-cyfrowy PIN)
// Wszystkie sekrety szyfrowane kluczem wyprowadzonym z hasła.
// Zero sekretów w kodzie. Zero wrangler secret put.
// ============================================================

export default {
  async fetch(req, env) {
    try { return await route(req, env); }
    catch (e) {
      console.error('[AL2100]', e?.stack || e);
      return J({ error: e?.message || 'Błąd wewnętrzny' }, e?.status || 500);
    }
  },
  async queue(batch) {
    for (const m of batch.messages) { try { m.ack(); } catch { m.retry(); } }
  }
};

// ============================================================
// ROUTING
// ============================================================
async function route(req, env) {
  const u = new URL(req.url), p = u.pathname, m = req.method;
  if (!p.startsWith('/api/') && !p.startsWith('/auth/')) return env.ASSETS.fetch(req);

  if (p === '/api/auth/register' && m === 'POST') return registerLocal(req, env);
  if (p === '/api/auth/login' && m === 'POST') return loginLocal(req, env);
  if (p === '/api/auth/logout' && m === 'POST') return logout(req, env);
  if (p === '/api/me' && m === 'GET') return getMe(req, env);

  if (p === '/api/conversations' && m === 'GET') return listConvs(req, env);
  if (p === '/api/conversations' && m === 'POST') return newConv(req, env);
  let mm = p.match(/^\/api\/conversations\/([^/]+)$/);
  if (mm && m === 'GET') return getConv(req, env, mm[1]);
  mm = p.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (mm && m === 'POST') return postMsg(req, env, mm[1]);

  if (p === '/api/memory' && m === 'GET') return listMem(req, env);
  if (p === '/api/memory' && m === 'POST') return addMem(req, env);
  mm = p.match(/^\/api\/memory\/([^/]+)$/);
  if (mm && m === 'PATCH') return patchMem(req, env, mm[1]);
  if (mm && m === 'DELETE') return delMem(req, env, mm[1]);

  if (p === '/api/providers' && m === 'GET') return listProv(req, env);
  mm = p.match(/^\/api\/providers\/([^/]+)\/key$/);
  if (mm && m === 'POST') return saveKey(req, env, mm[1]);
  if (mm && m === 'DELETE') return delKey(req, env, mm[1]);
  mm = p.match(/^\/api\/providers\/([^/]+)\/test$/);
  if (mm && m === 'POST') return testProv(req, env, mm[1]);

  if (p === '/api/projects' && m === 'GET') return listProjects(req, env);
  if (p === '/api/projects' && m === 'POST') return newProject(req, env);

  if (p === '/api/music/generate' && m === 'POST') return genMusic(req, env);
  if (p === '/api/music/tracks' && m === 'GET') return listTracks(req, env);
  mm = p.match(/^\/api\/music\/tracks\/([^/]+)\/audio$/);
  if (mm && m === 'GET') return trackAudio(req, env, mm[1]);
  mm = p.match(/^\/api\/music\/tracks\/([^/]+)$/);
  if (mm && m === 'DELETE') return delTrack(req, env, mm[1]);
  if (p === '/api/music/write-lyrics' && m === 'POST') return writeLyrics(req, env);

  if (p === '/api/media/image' && m === 'POST') return genImage(req, env);
  if (p === '/api/media/video' && m === 'POST') return genVideo(req, env);
  mm = p.match(/^\/api\/media\/file\/([^/]+)$/);
  if (mm && m === 'GET') return mediaFile(req, env, mm[1]);
  if (p === '/api/files/upload' && m === 'POST') return uploadFile(req, env);

  if (p === '/api/github/token' && m === 'POST') return saveGh(req, env);
  if (p === '/api/github/test' && m === 'POST') return testGh(req, env);
  if (p === '/api/github/push' && m === 'POST') return pushGh(req, env);

  return J({ error: 'Nie znaleziono: ' + p }, 404);
}

// ============================================================
// HELPERY
// ============================================================
function J(o, s = 200, h = {}) { return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', ...h } }); }
function cookieGet(req, n) { const c = req.headers.get('Cookie') || ''; const m = c.match(new RegExp('(?:^|; )' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; }
function cookieClear(n) { return `${n}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`; }
function uid(p = '') { return p + crypto.randomUUID().replace(/-/g, ''); }
function rhex(n = 32) { const b = crypto.getRandomValues(new Uint8Array(n)); return Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); }
function b64(u8) { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); }
function unb64(s) { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
async function safeJson(req) { try { return await req.json(); } catch { return {}; } }

// ============================================================
// KRYPTOGRAFIA (PBKDF2 + AES-GCM)
// ============================================================
async function pbkdf2(text, saltB64, iters, mode) {
  const salt = unb64(saltB64);
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(text), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' }, base, 256);
  if (mode === 'aes') return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return b64(new Uint8Array(bits));
}
async function hashPassword(pw, salt) { return pbkdf2(pw, salt, 600000, 'hash'); }
async function hashPin(pin, salt) { return pbkdf2(pin, salt, 200000, 'hash'); }
async function deriveMasterKey(pw, salt) { return pbkdf2(pw, salt, 600000, 'aes'); }

async function encryptWith(key, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return b64(iv) + ':' + b64(new Uint8Array(ct));
}
async function decryptWith(key, stored) {
  const [ivB, ctB] = stored.split(':');
  if (!ivB || !ctB) throw new Error('Zły format');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB) }, key, unb64(ctB));
  return new TextDecoder().decode(pt);
}

// ============================================================
// SESJE (master key wrapped w cookie)
// ============================================================
const SESSION_TTL = 30 * 24 * 3600;

async function createSession(env, userId, masterKey) {
  const sid = rhex(32), csrf = rhex(24);
  const skRaw = crypto.getRandomValues(new Uint8Array(32));
  const skB64 = b64(skRaw);
  const sk = await crypto.subtle.importKey('raw', skRaw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const mkRaw = await crypto.subtle.exportKey('raw', masterKey);
  const wrapped = await encryptWith(sk, b64(new Uint8Array(mkRaw)));
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  await env.AL_DB.prepare('INSERT INTO sessions (id, user_id, csrf_token, master_key_wrapped, expires_at) VALUES (?, ?, ?, ?, ?)').bind(sid, userId, csrf, wrapped, exp).run();
  return `${sid}:${skB64}`;
}

async function getSession(req, env) {
  const c = cookieGet(req, 'ax_session');
  if (!c) return null;
  const [sid, skB64] = c.split(':');
  if (!sid || !skB64) return null;
  const row = await env.AL_DB.prepare('SELECT s.id, s.user_id, s.csrf_token, s.expires_at, s.master_key_wrapped, u.email, u.login, u.name, u.avatar_url FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?').bind(sid).first();
  if (!row) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    await env.AL_DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
    return null;
  }
  try {
    const sk = await crypto.subtle.importKey('raw', unb64(skB64), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const mkB64 = await decryptWith(sk, row.master_key_wrapped);
    row.masterKey = await crypto.subtle.importKey('raw', unb64(mkB64), 'AES-GCM', false, ['encrypt', 'decrypt']);
  } catch { return null; }
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

// ============================================================
// AUTH: rejestracja, logowanie, logout, me
// ============================================================
async function registerLocal(req, env) {
  const b = await safeJson(req);
  const email = (b.email || '').trim().toLowerCase();
  const password = (b.password || '').trim();
  const pin = (b.pin || '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return J({ error: 'Nieprawidłowy e-mail' }, 400);
  if (password.length < 8) return J({ error: 'Hasło min. 8 znaków' }, 400);
  if (!/^\d{4}$/.test(pin)) return J({ error: 'PIN musi być 4 cyframi' }, 400);

  const exists = await env.AL_DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) return J({ error: 'Konto istnieje' }, 409);

  const ps = b64(crypto.getRandomValues(new Uint8Array(32)));
  const ms = b64(crypto.getRandomValues(new Uint8Array(32)));
  const ins = b64(crypto.getRandomValues(new Uint8Array(32)));
  const ph = await hashPassword(password, ps);
  const ih = await hashPin(pin, ins);
  const userId = uid('u_');

  await env.AL_DB.prepare('INSERT INTO users (id, login, name, email, password_hash, password_salt, master_salt, pin_hash, pin_salt, auth_provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(userId, email.split('@')[0], email.split('@')[0], email, ph, ps, ms, ih, ins, 'local').run();

  const mk = await deriveMasterKey(password, ms);
  const cookie = await createSession(env, userId, mk);
  return J({ ok: true }, 200, { 'Set-Cookie': `ax_session=${cookie}; Max-Age=${SESSION_TTL}; Path=/; HttpOnly; Secure; SameSite=Lax` });
}

async function loginLocal(req, env) {
  const b = await safeJson(req);
  const email = (b.email || '').trim().toLowerCase();
  const password = (b.password || '').trim();
  const pin = (b.pin || '').trim();

  if (!email || !password || !/^\d{4}$/.test(pin)) return J({ error: 'Wypełnij wszystkie pola' }, 400);

  const u = await env.AL_DB.prepare('SELECT id, email, password_hash, password_salt, master_salt, pin_hash, pin_salt FROM users WHERE email = ? AND auth_provider = ?').bind(email, 'local').first();
  if (!u) return J({ error: 'Nieprawidłowe dane' }, 401);

  const ph = await hashPassword(password, u.password_salt);
  if (ph !== u.password_hash) return J({ error: 'Nieprawidłowe dane' }, 401);

  const ih = await hashPin(pin, u.pin_salt);
  if (ih !== u.pin_hash) return J({ error: 'Nieprawidłowy PIN' }, 401);

  const mk = await deriveMasterKey(password, u.master_salt);
  const cookie = await createSession(env, u.id, mk);
  return J({ ok: true }, 200, { 'Set-Cookie': `ax_session=${cookie}; Max-Age=${SESSION_TTL}; Path=/; HttpOnly; Secure; SameSite=Lax` });
}

async function logout(req, env) {
  const c = cookieGet(req, 'ax_session');
  if (c) { const sid = c.split(':')[0]; if (sid) await env.AL_DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run(); }
  return J({ ok: true }, 200, { 'Set-Cookie': cookieClear('ax_session') });
}

async function getMe(req, env) {
  const s = await getSession(req, env);
  if (!s) return J({ user: null });
  return J({ user: { id: s.user_id, email: s.email, login: s.login, name: s.name, avatar_url: s.avatar_url }, csrf: s.csrf_token });
}

// ============================================================
// PROVIDER KEYS
// ============================================================
async function getKey(env, s, prov) {
  const r = await env.AL_DB.prepare('SELECT encrypted_key FROM provider_keys WHERE user_id = ? AND provider = ?').bind(s.user_id, prov).first();
  if (!r) return null;
  return decryptWith(s.masterKey, r.encrypted_key);
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
  const id = uid('c_'), title = (b.title || 'Nowa rozmowa').slice(0, 120);
  await env.AL_DB.prepare('INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)').bind(id, s.user_id, title).run();
  return J({ conversation: { id, title, created_at: Math.floor(Date.now() / 1000) } });
}
async function getConv(req, env, id) {
  const s = await reqSess(req, env);
  const c = await env.AL_DB.prepare('SELECT id, title, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?').bind(id, s.user_id).first();
  if (!c) return J({ error: 'Nie znaleziono' }, 404);
  const msgs = await env.AL_DB.prepare('SELECT id, role, content, model, provider, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').bind(id).all();
  return J({ conversation: c, messages: msgs.results });
}

// ============================================================
// POST MESSAGE (SSE)
// ============================================================
const PROVIDER_META = {
  groq: { name: 'Groq', kind: 'llm', defaultModel: 'llama-3.3-70b-versatile' },
  openrouter: { name: 'OpenRouter', kind: 'llm', defaultModel: 'deepseek/deepseek-chat-v3.1:free' },
  gemini: { name: 'Google Gemini', kind: 'llm', defaultModel: 'gemini-2.5-flash' },
  perplexity: { name: 'Perplexity', kind: 'llm', defaultModel: 'sonar' },
  grok: { name: 'xAI Grok', kind: 'llm', defaultModel: 'grok-4' },
  huggingface: { name: 'Hugging Face', kind: 'image', defaultModel: 'black-forest-labs/FLUX.1-schnell' },
  magichour: { name: 'Magic Hour', kind: 'video', defaultModel: 'default' },
  'ace-step': { name: 'ACE-Step', kind: 'music', defaultModel: 'acestep-v15-turbo' }
};

async function postMsg(req, env, cid) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const content = (b.content || '').trim(), retry = b.retry || null, internet = !!b.internet, modelSel = (b.model || 'auto').trim();
  if (!content && !retry) return J({ error: 'Brak treści' }, 400);

  const conv = await env.AL_DB.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').bind(cid, s.user_id).first();
  if (!conv) return J({ error: 'Nie znaleziono' }, 404);

  if (retry) await env.AL_DB.prepare('DELETE FROM messages WHERE id = ? AND conversation_id = ? AND role = ?').bind(retry, cid, 'assistant').run();
  else await env.AL_DB.prepare('INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)').bind(uid('msg_'), cid, 'user', content).run();

  const cnt = await env.AL_DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').bind(cid).first('n');
  if (cnt === 1 && content) await env.AL_DB.prepare('UPDATE conversations SET title = ?, updated_at = unixepoch() WHERE id = ?').bind(content.slice(0, 60).replace(/\s+/g, ' ').trim() || 'Nowa rozmowa', cid).run();
  else await env.AL_DB.prepare('UPDATE conversations SET updated_at = unixepoch() WHERE id = ?').bind(cid).run();

  const hist = (await env.AL_DB.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 60').bind(cid).all()).results;
  const mem = (await env.AL_DB.prepare('SELECT type, content FROM memory WHERE user_id = ? AND enabled = 1 ORDER BY pinned DESC, created_at DESC LIMIT 40').bind(s.user_id).all()).results;
  const memBlock = mem.map(x => `[${x.type}] ${x.content}`).join('\n');

  let research = '';
  if (internet) { try { research = await runResearch(env, s, content); } catch {} }

  const messages = [
    { role: 'system', content: sysPrompt(memBlock) },
    ...(research ? [{ role: 'system', content: 'Research:\n' + research }] : []),
    ...hist.map(h => ({ role: h.role, content: h.content }))
  ];

  const plan = await resolveProvider(modelSel, env, s);
  if (plan.provider === 'puter') return J({ error: 'Puter obsługiwany przez frontend' }, 400);

  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder();
      const send = o => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      const end = () => { ctrl.enqueue(enc.encode('data: [DONE]\n\n')); ctrl.close(); };
      let acc = '', prov = plan.provider, mdl = plan.model;
      try {
        if (prov === 'groq') await streamOpenAI(env, s, 'groq', 'https://api.groq.com/openai/v1/chat/completions', messages, mdl, d => { acc += d; send({ delta: d }); });
        else if (prov === 'openrouter') await streamOpenAI(env, s, 'openrouter', 'https://openrouter.ai/api/v1/chat/completions', messages, mdl, d => { acc += d; send({ delta: d }); }, { 'HTTP-Referer': 'https://al2100.dev', 'X-Title': 'AL2100' });
        else if (prov === 'gemini') await streamGemini(env, s, messages, mdl, d => { acc += d; send({ delta: d }); });
        else if (prov === 'grok') await streamOpenAI(env, s, 'grok', 'https://api.x.ai/v1/chat/completions', messages, mdl, d => { acc += d; send({ delta: d }); });
        else if (prov === 'perplexity') { const a = await callPerplexity(env, s, messages, mdl); acc = a; send({ delta: a }); }
        else if (prov === 'workers-ai') { const t = await callWorkersAI(env, messages, mdl); acc = t; send({ delta: t }); }
        else throw new Error('Nieobsługiwany: ' + prov);

        await env.AL_DB.prepare('INSERT INTO messages (id, conversation_id, role, content, model, provider) VALUES (?, ?, ?, ?, ?, ?)').bind(uid('msg_'), cid, 'assistant', acc, mdl, prov).run();
        send({ meta: { model: mdl, provider: prov } });
        end();
      } catch (e) { console.error(e); send({ error: e.message }); end(); }
    }
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } });
}

function sysPrompt(mem) {
  const b = `Jesteś AL2100 — prywatnym, spersonalizowanym systemem AI użytkownika. Jesteś jego "klonem AI" — osobistym narzędziem myślowym i kreatywnym partnerem, nie korporacyjnym asystentem.

ZASADY:
1. Jesteś klonem AI tego użytkownika. Mów o tym otwarcie, gdy istotne.
2. ZAWSZE przed odpowiedzią analizuj pełną historię rozmowy i pamięć globalną.
3. Myśl nieszablonowo. Zero korporacyjnego lania wody.
4. NIGDY nie kłam. Nie zmyślaj faktów, źródeł, kodu. Jeśli nie wiesz — powiedz to.
5. Bądź bezpośredni. Słaby pomysł → powiedz i zaproponuj lepszy.
6. Respektuj pamięć globalną (fakty, preferencje, decyzje).
7. Specjalizacje: muzyka (teksty, prompty ACE-Step/MiniMax), kod (Cloudflare, web, AI), research.
8. Język: dopasuj się do użytkownika.`;
  return mem ? b + '\n\nPAMIĘĆ:\n' + mem : b;
}

async function resolveProvider(sel, env, s) {
  if (sel === 'auto' || !sel) {
    if (await getKey(env, s, 'groq')) return { provider: 'groq', model: 'llama-3.3-70b-versatile' };
    if (await getKey(env, s, 'openrouter')) return { provider: 'openrouter', model: 'deepseek/deepseek-chat-v3.1:free' };
    if (await getKey(env, s, 'gemini')) return { provider: 'gemini', model: 'gemini-2.5-flash' };
    if (await getKey(env, s, 'grok')) return { provider: 'grok', model: 'grok-4' };
    return { provider: 'workers-ai', model: '@cf/meta/llama-3.1-8b-instruct' };
  }
  const [prov, ...rest] = sel.split('/');
  const model = rest.join('/') || PROVIDER_META[prov]?.defaultModel;
  if (prov === 'workers-ai') return { provider: 'workers-ai', model: model || '@cf/meta/llama-3.1-8b-instruct' };
  return { provider: prov, model };
}

async function streamOpenAI(env, s, prov, url, messages, model, cb, extra = {}) {
  const k = await getKey(env, s, prov);
  if (!k) throw new Error(`Brak klucza ${prov}`);
  const r = await fetch(url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify({ model, messages, stream: true, temperature: 0.7 }) });
  if (!r.ok) throw new Error(`${prov} HTTP ${r.status}`);
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ch = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const ln of ch.split('\n')) {
        if (!ln.startsWith('data: ')) continue;
        const d = ln.slice(6); if (d === '[DONE]') continue;
        try { const j = JSON.parse(d); const t = j.choices?.[0]?.delta?.content; if (t) cb(t); } catch {}
      }
    }
  }
}

async function streamGemini(env, s, messages, model, cb) {
  const k = await getKey(env, s, 'gemini');
  if (!k) throw new Error('Brak klucza Gemini');
  const sys = messages.find(x => x.role === 'system');
  const chat = messages.filter(x => x.role !== 'system');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(k)}`;
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: chat.map(x => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: x.content }] })), ...(sys ? { systemInstruction: { parts: [{ text: sys.content }] } } : {}) }) });
  if (!r.ok) throw new Error('Gemini HTTP ' + r.status);
  const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
  while (true) {
    const { done, value } = await rd.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ch = buf.slice(0, i); buf = buf.slice(i + 2);
      for (const ln of ch.split('\n')) {
        if (!ln.startsWith('data: ')) continue;
        const d = ln.slice(6); if (d === '[DONE]') continue;
        try { const j = JSON.parse(d); const t = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || ''; if (t) cb(t); } catch {}
      }
    }
  }
}

async function callWorkersAI(env, messages, model) {
  if (!env.AI) throw new Error('Brak bindingu AI');
  const r = await env.AI.run(model, { messages: messages.map(x => ({ role: x.role, content: x.content })) });
  return r.response || r.result || '';
}

async function callPerplexity(env, s, messages, model) {
  const k = await getKey(env, s, 'perplexity');
  if (!k) throw new Error('Brak klucza Perplexity');
  const r = await fetch('https://api.perplexity.ai/chat/completions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, temperature: 0.2 }) });
  if (!r.ok) throw new Error('Perplexity HTTP ' + r.status);
  return (await r.json()).choices?.[0]?.message?.content || '';
}

async function runResearch(env, s, q) {
  const k = await getKey(env, s, 'perplexity');
  if (!k) return '';
  const r = await fetch('https://api.perplexity.ai/chat/completions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: q }], temperature: 0.1 }) });
  if (!r.ok) return '';
  return (await r.json()).choices?.[0]?.message?.content || '';
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
  const r = await env.AL_DB.prepare('SELECT provider, model FROM provider_keys WHERE user_id = ?').bind(s.user_id).all();
  const cfg = new Map(r.results.map(x => [x.provider, x]));
  const providers = Object.entries(PROVIDER_META).map(([id, m]) => ({ id, name: m.name, kind: m.kind, models: [m.defaultModel], configured: cfg.has(id), model: cfg.get(id)?.model || null }));
  return J({ providers });
}
async function saveKey(req, env, prov) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  if (!PROVIDER_META[prov]) return J({ error: 'Nieznany' }, 400);
  const b = await safeJson(req);
  const k = (b.key || '').trim(), m = (b.model || '').trim() || null;
  if (!k) return J({ error: 'Brak klucza' }, 400);
  const e = await encryptWith(s.masterKey, k);
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
    const k = await getKey(env, s, prov);
    if (!k) return J({ error: 'Brak klucza' }, 400);
    const tests = {
      groq: ['https://api.groq.com/openai/v1/models', 'Bearer'],
      openrouter: ['https://openrouter.ai/api/v1/models', 'Bearer'],
      gemini: [`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}`, null],
      grok: ['https://api.x.ai/v1/models', 'Bearer'],
      huggingface: ['https://huggingface.co/api/whoami-v2', 'Bearer'],
      'ace-step': ['https://acestep.io/api/v2/models', 'Bearer'],
      magichour: ['https://api.magichour.ai/v1/account', 'Bearer']
    };
    const c = tests[prov];
    if (!c) return J({ ok: true, message: 'Klucz zapisany' });
    const headers = c[1] ? { Authorization: c[1] + ' ' + k } : {};
    const r = await fetch(c[0], { headers });
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
  let buf = null;

  if (engine === 'ace-step') {
    const k = await getKey(env, s, 'ace-step');
    if (!k) return J({ error: 'Brak klucza ACE-Step' }, 400);
    const r = await fetch('https://acestep.io/api/v2/generate-audio', { method: 'POST', headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' }, body: JSON.stringify({ style, lyrics: lyrics || undefined, duration: dur, format: 'mp3' }) });
    if (!r.ok) return J({ error: 'ACE-Step HTTP ' + r.status }, 502);
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('audio') || ct.includes('octet')) buf = await r.arrayBuffer();
    else {
      const j = await r.json();
      if (j.audio_base64) { const bin = atob(j.audio_base64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); buf = u8.buffer; }
      else if (j.audio_url) { const ar = await fetch(j.audio_url); buf = await ar.arrayBuffer(); }
      else return J({ error: 'Brak audio' }, 502);
    }
  } else {
    if (!env.AI) return J({ error: 'Brak AI' }, 500);
    try {
      const res = await env.AI.run('@cf/minimax/music-2.6', { prompt: style, lyrics: lyrics || undefined, output_format: 'mp3' });
      if (res instanceof ArrayBuffer) buf = res;
      else if (res?.audio instanceof ArrayBuffer) buf = res.audio;
      else return J({ error: 'MiniMax format' }, 502);
    } catch (e) { return J({ error: 'MiniMax: ' + e.message }, 502); }
  }
  if (!buf) return J({ error: 'Nie udało się' }, 502);

  const tid = uid('t_'), r2k = `${s.user_id}/tracks/${tid}.mp3`;
  await env.AL_BUCKET.put(r2k, buf, { httpMetadata: { contentType: 'audio/mpeg' } });
  await env.AL_DB.prepare('INSERT INTO tracks (id, user_id, style, lyrics, engine, r2_key, duration_s) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(tid, s.user_id, style.slice(0, 500), lyrics || null, engine, r2k, dur).run();
  return J({ id: tid, ok: true });
}
async function listTracks(req, env) {
  const s = await reqSess(req, env);
  const r = await env.AL_DB.prepare('SELECT id, style, engine, duration_s, created_at FROM tracks WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').bind(s.user_id).all();
  return J({ tracks: r.results });
}
async function trackAudio(req, env, id) {
  const s = await reqSess(req, env);
  const row = await env.AL_DB.prepare('SELECT r2_key FROM tracks WHERE id = ? AND user_id = ?').bind(id, s.user_id).first();
  if (!row) return J({ error: 'Nie ma' }, 404);
  const o = await env.AL_BUCKET.get(row.r2_key);
  if (!o) return J({ error: 'Nie ma' }, 410);
  return new Response(o.body, { headers: { 'Content-Type': 'audio/mpeg' } });
}
async function delTrack(req, env, id) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const row = await env.AL_DB.prepare('SELECT r2_key FROM tracks WHERE id = ? AND user_id = ?').bind(id, s.user_id).first();
  if (!row) return J({ error: 'Nie ma' }, 404);
  await env.AL_BUCKET.delete(row.r2_key);
  await env.AL_DB.prepare('DELETE FROM tracks WHERE id = ? AND user_id = ?').bind(id, s.user_id).run();
  return J({ ok: true });
}
async function writeLyrics(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const style = (b.style || '').trim();
  if (!style) return J({ error: 'Podaj styl' }, 400);
  const prompt = `Napisz tekst piosenki w stylu: ${style}. Struktura [Verse],[Chorus],[Bridge],[Outro]. Język polski. Zwróć TYLKO tekst.`;
  let out = '';
  try {
    const gk = await getKey(env, s, 'groq');
    if (gk) {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + gk, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.8, max_tokens: 1200 }) });
      out = (await r.json()).choices?.[0]?.message?.content || '';
    } else if (env.AI) {
      const r = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages: [{ role: 'user', content: prompt }] });
      out = r.response || '';
    } else return J({ error: 'Brak Groq/AI' }, 400);
  } catch (e) { return J({ error: e.message }, 502); }
  return J({ lyrics: out.trim() });
}

// ============================================================
// MEDIA
// ============================================================
async function genImage(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const prompt = (b.prompt || '').trim(), provider = b.provider || 'pollinations', style = b.style || 'none', size = b.size || '1024x1024';
  if (!prompt) return J({ error: 'Podaj prompt' }, 400);
  const [w, h] = size.split('x').map(n => parseInt(n, 10) || 1024);
  const styled = style !== 'none' ? `${prompt}, ${style} style` : prompt;
  let buf = null;

  if (provider === 'pollinations') {
    const r = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(styled)}?width=${w}&height=${h}&model=flux&nologo=true`);
    if (!r.ok) return J({ error: 'Pollinations ' + r.status }, 502);
    buf = await r.arrayBuffer();
  } else if (provider === 'cloudflare') {
    if (!env.AI) return J({ error: 'Brak AI' }, 500);
    const res = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt: styled, width: w, height: h });
    buf = res instanceof ArrayBuffer ? res : res?.image instanceof ArrayBuffer ? res.image : null;
  } else if (provider === 'huggingface') {
    const k = await getKey(env, s, 'huggingface');
    if (!k) return J({ error: 'Brak klucza HF' }, 400);
    const r = await fetch('https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell', { method: 'POST', headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' }, body: JSON.stringify({ inputs: styled, parameters: { width: w, height: h } }) });
    if (!r.ok) return J({ error: 'HF ' + r.status }, 502);
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
  const prompt = (b.prompt || '').trim(), dur = Math.min(Math.max(parseInt(b.duration, 10) || 5, 3), 10);
  if (!prompt) return J({ error: 'Podaj prompt' }, 400);
  const k = await getKey(env, s, 'magichour');
  if (!k) return J({ error: 'Brak klucza MH' }, 400);
  const r = await fetch('https://api.magichour.ai/v1/text-to-video', { method: 'POST', headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, duration: dur, resolution: '720p' }) });
  if (!r.ok) return J({ error: 'MH ' + r.status }, 502);
  const j = await r.json();
  const url = j.video_url || j.url || j.output?.video_url;
  if (url) return J({ url, provider: 'magichour' });
  return J({ job_id: j.id || j.job_id, message: 'W tle' });
}
async function mediaFile(req, env, id) {
  const s = await reqSess(req, env);
  const row = await env.AL_DB.prepare('SELECT r2_key, kind FROM media WHERE id = ? AND user_id = ?').bind(id, s.user_id).first();
  if (!row) return J({ error: 'Nie ma' }, 404);
  const o = await env.AL_BUCKET.get(row.r2_key);
  if (!o) return J({ error: 'Nie ma' }, 410);
  return new Response(o.body, { headers: { 'Content-Type': row.kind === 'video' ? 'video/mp4' : 'image/png' } });
}
async function uploadFile(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const ct = req.headers.get('content-type') || '';
  if (!ct.includes('multipart/form-data')) return J({ error: 'Multipart' }, 400);
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return J({ error: 'Brak pliku' }, 400);
  if (file.size > 25 * 1024 * 1024) return J({ error: '> 25MB' }, 413);
  const id = uid('f_'), safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  const r2k = `${s.user_id}/files/${id}_${safe}`;
  await env.AL_BUCKET.put(r2k, await file.arrayBuffer(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
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
  const e = await encryptWith(s.masterKey, t);
  await env.AL_DB.prepare('INSERT INTO github_keys (user_id, encrypted_token, updated_at) VALUES (?, ?, unixepoch()) ON CONFLICT(user_id) DO UPDATE SET encrypted_token=excluded.encrypted_token, updated_at=unixepoch()').bind(s.user_id, e).run();
  return J({ ok: true });
}
async function testGh(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const r = await env.AL_DB.prepare('SELECT encrypted_token FROM github_keys WHERE user_id = ?').bind(s.user_id).first();
  if (!r) return J({ error: 'Brak tokenu' }, 400);
  const t = await decryptWith(s.masterKey, r.encrypted_token);
  const resp = await fetch('https://api.github.com/user', { headers: { 'Authorization': 'Bearer ' + t, 'User-Agent': 'AL2100' } });
  if (!resp.ok) return J({ error: 'GitHub ' + resp.status }, 502);
  return J({ ok: true, login: (await resp.json()).login });
}
async function pushGh(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const repo = (b.repo || '').trim(), path = (b.path || '').trim(), branch = (b.branch || 'main').trim(), content = b.content || '', message = (b.message || 'AL2100').trim();
  if (!repo.includes('/')) return J({ error: 'owner/repo' }, 400);
  if (!path) return J({ error: 'Brak ścieżki' }, 400);
  const r = await env.AL_DB.prepare('SELECT encrypted_token FROM github_keys WHERE user_id = ?').bind(s.user_id).first();
  if (!r) return J({ error: 'Brak tokenu' }, 400);
  const t = await decryptWith(s.masterKey, r.encrypted_token);
  const [owner, name] = repo.split('/');
  let sha = null;
  const g = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`, { headers: { 'Authorization': 'Bearer ' + t, 'User-Agent': 'AL2100' } });
  if (g.ok) sha = (await g.json()).sha;
  const b64c = btoa(unescape(encodeURIComponent(content)));
  const put = await fetch(`https://api.github.com/repos/${owner}/${name}/contents/${encodeURIComponent(path)}`, { method: 'PUT', headers: { 'Authorization': 'Bearer ' + t, 'User-Agent': 'AL2100', 'Content-Type': 'application/json' }, body: JSON.stringify({ message, content: b64c, branch, ...(sha ? { sha } : {}) }) });
  if (!put.ok) return J({ error: 'GitHub ' + put.status }, 502);
  const j = await put.json();
  return J({ ok: true, commit: j.commit?.sha, url: j.content?.html_url });
}
