// ============================================================
// AL2100 — worker.js (ULTIMATE EDITION)
// Naprawione: extractable, PBKDF2, admin, kolejka
// ============================================================

const ADMIN_EMAIL = 'admin@admin.com';
const ADMIN_PASSWORD = 'admin4200';
const ADMIN_PIN = '4200';

const PERSONALITIES = {
  coder: { id: 'coder', name: 'Bóg Kodowania', emoji: '⚡', accent: '#00e5ff',
    system: `Jesteś BOGIEM KODOWANIA — mistrzem programowania, architektem systemów. Piszesz kod produkcyjny od pierwszego strzału. Znasz TypeScript, Python, Rust, Go, Cloudflare Workers, D1, KV, R2, React, SQL, LLM API. Myślisz w systemach. Debugujesz szybko. Nie znosisz boilerplate. ZAWSZE dawaj działający kod — kompletny. Wyjaśniaj krótko. Bezpieczeństwo: prepared statements, walidacja. Nie wiesz → test. Język: polski.` },
  writer: { id: 'writer', name: 'Bóg Pisania', emoji: '✍️', accent: '#7c4dff',
    system: `Jesteś BOGIEM PISANIA — mistrzem prozy, poezji, storytellingu. Piszesz we wszystkich formatach. Znasz rzemiosło: struktura, dialogi, napięcie, rytm. Dopasowujesz styl do kontekstu. Pokaż, nie mów. Zero frazesów. Każde zdanie ma cel. Język: polski.` },
  music: { id: 'music', name: 'Bóg Muzyki', emoji: '🎵', accent: '#00e58a',
    system: `Jesteś BOGIEM MUZYKI — mistrzem kompozycji, tekstów, produkcji. Piszesz teksty we wszystkich gatunkach ze strukturą [Verse]/[Chorus]. Układasz prompty do ACE-Step, MiniMax, Suno, Udio — precyzyjnie. Znasz teorię muzyki i produkcję. Rymy naturalne. Język: polski.` }
};

export default {
  async fetch(req, env) {
    try { await ensureAdmin(env); return await route(req, env); }
    catch (e) { console.error('[AL2100]', e?.stack || e); return J({ error: e?.message || 'Błąd wewnętrzny' }, e?.status || 500); }
  }
};

// ============================================================
// AUTO-ADMIN
// ============================================================
async function ensureAdmin(env) {
  try {
    const existing = await env.AL_DB.prepare('SELECT id FROM users WHERE email = ?').bind(ADMIN_EMAIL).first();
    if (existing) return;
    const ps = b64(crypto.getRandomValues(new Uint8Array(32)));
    const ms = b64(crypto.getRandomValues(new Uint8Array(32)));
    const ins = b64(crypto.getRandomValues(new Uint8Array(32)));
    const ph = await hashPassword(ADMIN_PASSWORD, ps);
    const ih = await hashPin(ADMIN_PIN, ins);
    await env.AL_DB.prepare('INSERT INTO users (id, login, name, email, password_hash, password_salt, master_salt, pin_hash, pin_salt, auth_provider, personality, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind('u_admin_default', 'admin', 'Administrator', ADMIN_EMAIL, ph, ps, ms, ih, ins, 'local', 'coder', 'admin').run();
  } catch (e) { console.warn('[ensureAdmin]', e.message); }
}

// ============================================================
// ROUTING
// ============================================================
async function route(req, env) {
  const u = new URL(req.url), p = u.pathname, m = req.method;
  if (!p.startsWith('/api/') && !p.startsWith('/auth/')) return env.ASSETS.fetch(req);

  // Auth
  if (p === '/api/auth/register' && m === 'POST') return registerLocal(req, env);
  if (p === '/api/auth/login' && m === 'POST') return loginLocal(req, env);
  if (p === '/api/auth/logout' && m === 'POST') return logout(req, env);
  if (p === '/api/me' && m === 'GET') return getMe(req, env);
  if (p === '/api/settings/personality' && m === 'POST') return setPersonality(req, env);

  // Admin
  if (p === '/api/admin/users' && m === 'GET') return adminListUsers(req, env);
  if (p === '/api/admin/stats' && m === 'GET') return adminStats(req, env);
  const adminUserMatch = p.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (adminUserMatch && m === 'PATCH') return adminUpdateUser(req, env, adminUserMatch[1]);
  if (adminUserMatch && m === 'DELETE') return adminDeleteUser(req, env, adminUserMatch[1]);
  const adminConvMatch = p.match(/^\/api\/admin\/users\/([^/]+)\/conversations$/);
  if (adminConvMatch && m === 'GET') return adminUserConvs(req, env, adminConvMatch[1]);

  // Conversations
  if (p === '/api/conversations' && m === 'GET') return listConvs(req, env);
  if (p === '/api/conversations' && m === 'POST') return newConv(req, env);
  let mm = p.match(/^\/api\/conversations\/([^/]+)$/);
  if (mm && m === 'GET') return getConv(req, env, mm[1]);
  mm = p.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (mm && m === 'POST') return postMsg(req, env, mm[1]);

  // Memory
  if (p === '/api/memory' && m === 'GET') return listMem(req, env);
  if (p === '/api/memory' && m === 'POST') return addMem(req, env);
  mm = p.match(/^\/api\/memory\/([^/]+)$/);
  if (mm && m === 'DELETE') return delMem(req, env, mm[1]);

  // Providers
  if (p === '/api/providers' && m === 'GET') return listProv(req, env);
  mm = p.match(/^\/api\/providers\/([^/]+)\/key$/);
  if (mm && m === 'POST') return saveKey(req, env, mm[1]);
  if (mm && m === 'DELETE') return delKey(req, env, mm[1]);

  // Projects
  if (p === '/api/projects' && m === 'GET') return listProjects(req, env);
  if (p === '/api/projects' && m === 'POST') return newProject(req, env);

  // Music
  if (p === '/api/music/generate' && m === 'POST') return genMusic(req, env);
  if (p === '/api/music/tracks' && m === 'GET') return listTracks(req, env);
  mm = p.match(/^\/api\/music\/tracks\/([^/]+)\/audio$/);
  if (mm && m === 'GET') return trackAudio(req, env, mm[1]);
  mm = p.match(/^\/api\/music\/tracks\/([^/]+)$/);
  if (mm && m === 'DELETE') return delTrack(req, env, mm[1]);
  if (p === '/api/music/write-lyrics' && m === 'POST') return writeLyrics(req, env);

  // Media
  if (p === '/api/media/image' && m === 'POST') return genImage(req, env);
  mm = p.match(/^\/api\/media\/file\/([^/]+)$/);
  if (mm && m === 'GET') return mediaFile(req, env, mm[1]);

  // GitHub
  if (p === '/api/github/token' && m === 'POST') return saveGh(req, env);

  return J({ error: 'Nie znaleziono: ' + p }, 404);
}

// ============================================================
// HELPERS
// ============================================================
function J(o, s = 200, h = {}) { return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', ...h } }); }
function cookieGet(req, n) { const c = req.headers.get('Cookie') || ''; const m = c.match(new RegExp('(?:^|; )' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; }
function cookieSet(n, v, maxAge) { return `${n}=${encodeURIComponent(v)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`; }
function cookieClear(n) { return `${n}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`; }
function uid(p = '') { return p + crypto.randomUUID().replace(/-/g, ''); }
function rhex(n = 32) { const b = crypto.getRandomValues(new Uint8Array(n)); return Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); }
function b64(u8) { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); }
function unb64(s) { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
async function safeJson(req) { try { return await req.json(); } catch { return {}; } }

// ============================================================
// CRYPTO — POPRAWIONE: extractable = true, PBKDF2 = 100k
// ============================================================
async function pbkdf2(text, saltB64, iters, mode) {
  const salt = unb64(saltB64);
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(text), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' }, base, 256);
  if (mode === 'aes') return crypto.subtle.importKey('raw', bits, 'AES-GCM', true, ['encrypt', 'decrypt']);  // ← extractable: true
  return b64(new Uint8Array(bits));
}
async function hashPassword(pw, salt) { return pbkdf2(pw, salt, 100000, 'hash'); }
async function hashPin(pin, salt) { return pbkdf2(pin, salt, 100000, 'hash'); }
async function deriveMasterKey(pw, salt) { return pbkdf2(pw, salt, 100000, 'aes'); }
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
// SESSIONS
// ============================================================
const SESSION_TTL = 30 * 24 * 3600;

async function createSession(env, userId, masterKey) {
  const sid = rhex(32), csrf = rhex(24);
  const skRaw = crypto.getRandomValues(new Uint8Array(32));
  const skB64 = b64(skRaw);
  const sk = await crypto.subtle.importKey('raw', skRaw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const mkRaw = await crypto.subtle.exportKey('raw', masterKey);  // ← teraz działa
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
  const row = await env.AL_DB.prepare('SELECT s.id, s.user_id, s.csrf_token, s.expires_at, s.master_key_wrapped, u.email, u.login, u.name, u.avatar_url, u.personality, u.personality_custom, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?').bind(sid).first();
  if (!row) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) { await env.AL_DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run(); return null; }
  try {
    const sk = await crypto.subtle.importKey('raw', unb64(skB64), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const mkB64 = await decryptWith(sk, row.master_key_wrapped);
    row.masterKey = await crypto.subtle.importKey('raw', unb64(mkB64), 'AES-GCM', true, ['encrypt', 'decrypt']);
  } catch { return null; }
  return row;
}

async function reqSess(req, env) {
  const s = await getSession(req, env);
  if (!s) throw Object.assign(new Error('Wymagane zalogowanie'), { status: 401 });
  return s;
}
async function reqAdmin(req, env) {
  const s = await reqSess(req, env);
  if (s.role !== 'admin') throw Object.assign(new Error('Wymagane uprawnienia admina'), { status: 403 });
  return s;
}
async function reqCsrf(req, env, s) {
  if (!['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) return;
  const t = req.headers.get('X-CSRF-Token');
  if (!t || t !== s.csrf_token) throw Object.assign(new Error('Nieprawidłowy CSRF'), { status: 403 });
}

// ============================================================
// AUTH
// ============================================================
async function registerLocal(req, env) {
  const b = await safeJson(req);
  const email = (b.email || '').trim().toLowerCase();
  const password = (b.password || '').trim();
  const pin = (b.pin || '').trim();
  const personality = (b.personality || 'coder').trim();
  const custom = (b.personality_custom || '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return J({ error: 'Nieprawidłowy e-mail' }, 400);
  if (password.length < 8) return J({ error: 'Hasło min. 8 znaków' }, 400);
  if (!/^\d{4}$/.test(pin)) return J({ error: 'PIN 4 cyfry' }, 400);
  if (!PERSONALITIES[personality] && personality !== 'custom') return J({ error: 'Nieprawidłowa osobowość' }, 400);

  const exists = await env.AL_DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) return J({ error: 'Konto istnieje' }, 409);

  const ps = b64(crypto.getRandomValues(new Uint8Array(32)));
  const ms = b64(crypto.getRandomValues(new Uint8Array(32)));
  const ins = b64(crypto.getRandomValues(new Uint8Array(32)));
  const ph = await hashPassword(password, ps);
  const ih = await hashPin(pin, ins);
  const userId = uid('u_');
  const role = email === ADMIN_EMAIL ? 'admin' : 'user';

  await env.AL_DB.prepare('INSERT INTO users (id, login, name, email, password_hash, password_salt, master_salt, pin_hash, pin_salt, auth_provider, personality, personality_custom, role, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())').bind(userId, email.split('@')[0], email.split('@')[0], email, ph, ps, ms, ih, ins, 'local', personality, custom || null, role).run();

  const mk = await deriveMasterKey(password, ms);
  const cookie = await createSession(env, userId, mk);
  return J({ ok: true, role }, 200, { 'Set-Cookie': cookieSet('ax_session', cookie, SESSION_TTL) });
}

async function loginLocal(req, env) {
  const b = await safeJson(req);
  const email = (b.email || '').trim().toLowerCase();
  const password = (b.password || '').trim();
  const pin = (b.pin || '').trim();
  if (!email || !password || !/^\d{4}$/.test(pin)) return J({ error: 'Wypełnij wszystkie pola' }, 400);

  const u = await env.AL_DB.prepare('SELECT id, email, password_hash, password_salt, master_salt, pin_hash, pin_salt, personality, role, banned FROM users WHERE email = ? AND auth_provider = ?').bind(email, 'local').first();
  if (!u) return J({ error: 'Nieprawidłowe dane' }, 401);
  if (u.banned) return J({ error: 'Konto zablokowane' }, 403);

  const ph = await hashPassword(password, u.password_salt);
  if (ph !== u.password_hash) return J({ error: 'Nieprawidłowe dane' }, 401);
  const ih = await hashPin(pin, u.pin_salt);
  if (ih !== u.pin_hash) return J({ error: 'Nieprawidłowy PIN' }, 401);

  await env.AL_DB.prepare('UPDATE users SET last_login_at = unixepoch() WHERE id = ?').bind(u.id).run();
  const mk = await deriveMasterKey(password, u.master_salt);
  const cookie = await createSession(env, u.id, mk);
  return J({ ok: true, role: u.role }, 200, { 'Set-Cookie': cookieSet('ax_session', cookie, SESSION_TTL) });
}

async function logout(req, env) {
  const c = cookieGet(req, 'ax_session');
  if (c) { const sid = c.split(':')[0]; if (sid) await env.AL_DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run(); }
  return J({ ok: true }, 200, { 'Set-Cookie': cookieClear('ax_session') });
}

async function getMe(req, env) {
  const s = await getSession(req, env);
  if (!s) return J({ user: null });
  const p = PERSONALITIES[s.personality] || (s.personality === 'custom' ? { id: 'custom', name: 'Własna', emoji: '🎨', accent: '#ff4d6d' } : PERSONALITIES.coder);
  return J({ user: { id: s.user_id, email: s.email, login: s.login, name: s.name, avatar_url: s.avatar_url, personality: s.personality, personality_custom: s.personality_custom, role: s.role }, personality: p, csrf: s.csrf_token });
}

async function setPersonality(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const p = (b.personality || '').trim();
  const custom = (b.personality_custom || '').trim();
  if (p !== 'custom' && !PERSONALITIES[p]) return J({ error: 'Nieprawidłowa osobowość' }, 400);
  if (p === 'custom' && !custom) return J({ error: 'Wpisz własny prompt' }, 400);
  await env.AL_DB.prepare('UPDATE users SET personality = ?, personality_custom = ? WHERE id = ?').bind(p, p === 'custom' ? custom : null, s.user_id).run();
  return J({ ok: true });
}

// ============================================================
// ADMIN
// ============================================================
async function adminListUsers(req, env) {
  await reqAdmin(req, env);
  const rows = await env.AL_DB.prepare('SELECT id, email, login, name, personality, role, banned, last_login_at, created_at FROM users ORDER BY created_at DESC').all();
  return J({ users: rows.results });
}

async function adminStats(req, env) {
  await reqAdmin(req, env);
  const users = await env.AL_DB.prepare('SELECT COUNT(*) AS n FROM users').first('n');
  const convs = await env.AL_DB.prepare('SELECT COUNT(*) AS n FROM conversations').first('n');
  const msgs = await env.AL_DB.prepare('SELECT COUNT(*) AS n FROM messages').first('n');
  const tracks = await env.AL_DB.prepare('SELECT COUNT(*) AS n FROM tracks').first('n');
  return J({ users, conversations: convs, messages: msgs, tracks });
}

async function adminUpdateUser(req, env, id) {
  const admin = await reqAdmin(req, env); await reqCsrf(req, env, admin);
  const b = await safeJson(req);
  const f = [], v = [];
  if ('role' in b) { f.push('role = ?'); v.push(b.role === 'admin' ? 'admin' : 'user'); }
  if ('banned' in b) { f.push('banned = ?'); v.push(b.banned ? 1 : 0); }
  if (!f.length) return J({ error: 'Brak pól' }, 400);
  v.push(id);
  await env.AL_DB.prepare(`UPDATE users SET ${f.join(', ')} WHERE id = ?`).bind(...v).run();
  return J({ ok: true });
}

async function adminDeleteUser(req, env, id) {
  const admin = await reqAdmin(req, env); await reqCsrf(req, env, admin);
  if (id === admin.user_id) return J({ error: 'Nie możesz usunąć siebie' }, 400);
  await env.AL_DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return J({ ok: true });
}

async function adminUserConvs(req, env, id) {
  await reqAdmin(req, env);
  const rows = await env.AL_DB.prepare('SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC').bind(id).all();
  return J({ conversations: rows.results });
}

// ============================================================
// CONVERSATIONS
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
// POST MESSAGE
// ============================================================
const PROVIDER_META = {
  groq: { name: 'Groq', kind: 'llm', defaultModel: 'llama-3.3-70b-versatile' },
  openrouter: { name: 'OpenRouter', kind: 'llm', defaultModel: 'deepseek/deepseek-chat-v3.1:free' },
  gemini: { name: 'Google Gemini', kind: 'llm', defaultModel: 'gemini-2.5-flash' },
  grok: { name: 'xAI Grok', kind: 'llm', defaultModel: 'grok-4' },
  huggingface: { name: 'Hugging Face', kind: 'image', defaultModel: 'black-forest-labs/FLUX.1-schnell' },
  'ace-step': { name: 'ACE-Step', kind: 'music', defaultModel: 'acestep-v15-turbo' }
};

async function postMsg(req, env, cid) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const content = (b.content || '').trim(), retry = b.retry || null, modelSel = (b.model || 'auto').trim();
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

  const pers = s.personality === 'custom' ? s.personality_custom : (PERSONALITIES[s.personality]?.system || PERSONALITIES.coder.system);
  const messages = [
    { role: 'system', content: pers + (memBlock ? '\n\nPAMIĘĆ:\n' + memBlock : '') + '\n\nJesteś klonem AI użytkownika. Analizuj historię. Nie kłam. Język: polski.' },
    ...hist.map(h => ({ role: h.role, content: h.content }))
  ];

  const plan = await resolveProvider(modelSel, env, s);
  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder();
      const send = o => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      const end = () => { ctrl.enqueue(enc.encode('data: [DONE]\n\n')); ctrl.close(); };
      let acc = '', prov = plan.provider, mdl = plan.model;
      try {
        if (prov === 'groq') await streamOpenAI(env, s, 'groq', 'https://api.groq.com/openai/v1/chat/completions', messages, mdl, d => { acc += d; send({ delta: d }); });
        else if (prov === 'openrouter') await streamOpenAI(env, s, 'openrouter', 'https://openrouter.ai/api/v1/chat/completions', messages, mdl, d => { acc += d; send({ delta: d }); });
        else if (prov === 'gemini') await streamGemini(env, s, messages, mdl, d => { acc += d; send({ delta: d }); });
        else if (prov === 'grok') await streamOpenAI(env, s, 'grok', 'https://api.x.ai/v1/chat/completions', messages, mdl, d => { acc += d; send({ delta: d }); });
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

async function resolveProvider(sel, env, s) {
  if (sel === 'auto' || !sel) {
    if (await getKey(env, s, 'groq')) return { provider: 'groq', model: 'llama-3.3-70b-versatile' };
    if (await getKey(env, s, 'openrouter')) return { provider: 'openrouter', model: 'deepseek/deepseek-chat-v3.1:free' };
    if (await getKey(env, s, 'gemini')) return { provider: 'gemini', model: 'gemini-2.5-flash' };
    return { provider: 'workers-ai', model: '@cf/meta/llama-3.1-8b-instruct' };
  }
  const [prov, ...rest] = sel.split('/');
  const model = rest.join('/') || PROVIDER_META[prov]?.defaultModel;
  if (prov === 'workers-ai') return { provider: 'workers-ai', model: model || '@cf/meta/llama-3.1-8b-instruct' };
  return { provider: prov, model };
}

async function getKey(env, s, prov) {
  const r = await env.AL_DB.prepare('SELECT encrypted_key FROM provider_keys WHERE user_id = ? AND provider = ?').bind(s.user_id, prov).first();
  if (!r) return null;
  return decryptWith(s.masterKey, r.encrypted_key);
}

async function streamOpenAI(env, s, prov, url, messages, model, cb) {
  const k = await getKey(env, s, prov);
  if (!k) throw new Error(`Brak klucza ${prov}`);
  const r = await fetch(url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, stream: true, temperature: 0.7 }) });
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
  if (!env.AI) throw new Error('Brak AI');
  const r = await env.AI.run(model, { messages: messages.map(x => ({ role: x.role, content: x.content })) });
  return r.response || r.result || '';
}

// ============================================================
// MEMORY
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
async function delMem(req, env, id) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  await env.AL_DB.prepare('DELETE FROM memory WHERE id = ? AND user_id = ?').bind(id, s.user_id).run();
  return J({ ok: true });
}

// ============================================================
// PROVIDERS
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

// ============================================================
// PROJECTS
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
// MUSIC
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
    if (ct.includes('audio')) buf = await r.arrayBuffer();
    else { const j = await r.json(); if (j.audio_base64) { const bin = atob(j.audio_base64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); buf = u8.buffer; } else return J({ error: 'Brak audio' }, 502); }
  } else {
    if (!env.AI) return J({ error: 'Brak AI' }, 500);
    const res = await env.AI.run('@cf/minimax/music-2.6', { prompt: style, lyrics: lyrics || undefined, output_format: 'mp3' });
    buf = res instanceof ArrayBuffer ? res : res?.audio instanceof ArrayBuffer ? res.audio : null;
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
  }
  if (!buf) return J({ error: 'Brak obrazu' }, 502);
  const id = uid('img_'), r2k = `${s.user_id}/media/${id}.png`;
  await env.AL_BUCKET.put(r2k, buf, { httpMetadata: { contentType: 'image/png' } });
  await env.AL_DB.prepare('INSERT INTO media (id, user_id, kind, provider, prompt, r2_key) VALUES (?, ?, ?, ?, ?, ?)').bind(id, s.user_id, 'image', provider, prompt.slice(0, 1000), r2k).run();
  return J({ id, url: '/api/media/file/' + id });
}
async function mediaFile(req, env, id) {
  const s = await reqSess(req, env);
  const row = await env.AL_DB.prepare('SELECT r2_key, kind FROM media WHERE id = ? AND user_id = ?').bind(id, s.user_id).first();
  if (!row) return J({ error: 'Nie ma' }, 404);
  const o = await env.AL_BUCKET.get(row.r2_key);
  if (!o) return J({ error: 'Nie ma' }, 410);
  return new Response(o.body, { headers: { 'Content-Type': row.kind === 'video' ? 'video/mp4' : 'image/png' } });
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
