// ============================================================
// AL2100 — worker.js (ULTIMATE PRODUCTION)
// Auto-migracja D1, health check, admin auto-create
// ============================================================

const ADMIN_EMAIL = 'admin@admin.com';
const ADMIN_PASSWORD = 'admin4200';
const ADMIN_PIN = '4200';

// ============================================================
// SCHEMA — auto-migracja
// ============================================================
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, login TEXT, name TEXT, avatar_url TEXT,
    email TEXT UNIQUE, password_hash TEXT, password_salt TEXT, master_salt TEXT,
    pin_hash TEXT, pin_salt TEXT, auth_provider TEXT DEFAULT 'local',
    personality TEXT DEFAULT 'coder', personality_custom TEXT,
    role TEXT DEFAULT 'user', banned INTEGER DEFAULT 0, settings TEXT DEFAULT '{}',
    last_login_at INTEGER, created_at INTEGER DEFAULT (unixepoch())
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf_token TEXT NOT NULL,
    master_key_wrapped TEXT NOT NULL, created_at INTEGER DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Nowa rozmowa', pinned INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()), updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, pinned DESC, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
    content TEXT NOT NULL, model TEXT, provider TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS memory (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('fact','preference','decision')),
    content TEXT NOT NULL, pinned INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS provider_keys (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, provider TEXT NOT NULL,
    encrypted_key TEXT NOT NULL, model TEXT,
    updated_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(user_id, provider),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
    description TEXT, created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT, style TEXT, lyrics TEXT,
    engine TEXT NOT NULL, r2_key TEXT NOT NULL, duration_s INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('image','video')),
    provider TEXT NOT NULL, prompt TEXT, r2_key TEXT, url TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS github_keys (
    user_id TEXT PRIMARY KEY, encrypted_token TEXT NOT NULL,
    updated_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`
];

let _schemaReady = false;

async function ensureSchema(env) {
  if (_schemaReady) return;
  try {
    await env.AL_DB.prepare('SELECT id FROM users LIMIT 1').first();
    _schemaReady = true;
    return;
  } catch {}
  console.log('[AL2100] Auto-migracja: tworzę tabele...');
  for (const stmt of SCHEMA) {
    try { await env.AL_DB.prepare(stmt).run(); }
    catch (e) { console.warn('[schema]', e.message?.slice(0, 100)); }
  }
  _schemaReady = true;
  console.log('[AL2100] Auto-migracja zakończona');
}

// ============================================================
// PERSONALITIES
// ============================================================
const PERSONALITIES = {
  coder: { id: 'coder', name: 'Bóg Kodowania', emoji: '⚡', accent: '#00e5ff',
    description: 'Architekt systemów. Kod produkcyjny bez ściemy.',
    system: `Jesteś BOGIEM KODOWANIA — mistrzem programowania, architektem systemów. Piszesz kod produkcyjny od pierwszego strzału. Znasz TypeScript, Python, Rust, Go, Cloudflare Workers, D1, KV, R2, React, SQL, LLM API. Myślisz w systemach. Debugujesz szybko. Nie znosisz boilerplate. ZAWSZE dawaj działający kod — kompletny. Wyjaśniaj KRÓTKO. Bezpieczeństwo: prepared statements, walidacja. Nie wiesz → testuj. Język: dopasuj się do użytkownika.` },
  writer: { id: 'writer', name: 'Bóg Pisania', emoji: '✍️', accent: '#7c4dff',
    description: 'Mistrz prozy, poezji, storytellingu.',
    system: `Jesteś BOGIEM PISANIA — mistrzem prozy, poezji, storytellingu, copywritingu. Piszesz we wszystkich formatach. Znasz rzemiosło: struktura narracji, dialogi, napięcie, rytm zdań. Dopasowujesz styl do kontekstu. Pokaż, nie mów. Zero frazesów. Każde zdanie ma cel. Język: dopasuj się do użytkownika.` },
  music: { id: 'music', name: 'Bóg Muzyki', emoji: '🎵', accent: '#00e58a',
    description: 'Teksty, kompozycje, prompty do AI muzycznych.',
    system: `Jesteś BOGIEM MUZYKI — mistrzem kompozycji, tekstów, produkcji. Piszesz teksty we wszystkich gatunkach ze strukturą [Verse]/[Chorus]/[Bridge]/[Outro]. Układasz precyzyjne prompty do ACE-Step, MiniMax, Suno, Udio. Znasz teorię muzyki i produkcję. Rymy naturalne. Język: dopasuj się do użytkownika.` }
};

// ============================================================
// EXPORT
// ============================================================
export default {
  async fetch(req, env) {
    try {
      await ensureSchema(env);
      await ensureAdmin(env);
      return await route(req, env);
    } catch (e) {
      console.error('[AL2100]', e?.stack || e);
      return J({ error: e?.message || 'Błąd wewnętrzny', stack: e?.stack?.split('\n').slice(0,3) }, e?.status || 500);
    }
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
    console.log('[AL2100] Admin utworzony:', ADMIN_EMAIL);
  } catch (e) { console.warn('[ensureAdmin]', e.message); }
}

// ============================================================
// ROUTING
// ============================================================
async function route(req, env) {
  const u = new URL(req.url), p = u.pathname, m = req.method;
  if (!p.startsWith('/api/') && !p.startsWith('/auth/')) return env.ASSETS.fetch(req);

  // HEALTH
  if (p === '/api/health' && m === 'GET') {
    try {
      const tables = await env.AL_DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      const names = tables.results.map(t => t.name);
      const hasUsers = names.includes('users');
      let adminExists = false;
      if (hasUsers) {
        const admin = await env.AL_DB.prepare('SELECT id FROM users WHERE email = ?').bind(ADMIN_EMAIL).first();
        adminExists = !!admin;
      }
      return J({ ok: hasUsers, tables: names, has_users: hasUsers, admin_exists: adminExists, admin_email: ADMIN_EMAIL });
    } catch (e) {
      return J({ ok: false, error: e.message, d1: 'broken' }, 500);
    }
  }

  // AUTH
  if (p === '/api/auth/register' && m === 'POST') return registerLocal(req, env);
  if (p === '/api/auth/login' && m === 'POST') return loginLocal(req, env);
  if (p === '/api/auth/logout' && m === 'POST') return logout(req, env);
  if (p === '/api/me' && m === 'GET') return getMe(req, env);

  // SETTINGS
  if (p === '/api/settings/personality' && m === 'POST') return updatePersonality(req, env);

  // ADMIN
  if (p === '/api/admin/stats' && m === 'GET') return adminStats(req, env);
  if (p === '/api/admin/users' && m === 'GET') return adminUsers(req, env);
  let mm = p.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (mm && m === 'PATCH') return adminUpdateUser(req, env, mm[1]);
  if (mm && m === 'DELETE') return adminDeleteUser(req, env, mm[1]);

  // CONVERSATIONS
  if (p === '/api/conversations' && m === 'GET') return listConvs(req, env);
  if (p === '/api/conversations' && m === 'POST') return newConv(req, env);
  mm = p.match(/^\/api\/conversations\/([^/]+)$/);
  if (mm && m === 'GET') return getConv(req, env, mm[1]);
  if (mm && m === 'PATCH') return patchConv(req, env, mm[1]);
  if (mm && m === 'DELETE') return deleteConv(req, env, mm[1]);
  mm = p.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (mm && m === 'POST') return postMsg(req, env, mm[1]);

  // MESSAGES
  mm = p.match(/^\/api\/messages\/([^/]+)$/);
  if (mm && m === 'DELETE') return deleteMsg(req, env, mm[1]);

  // MEMORY
  if (p === '/api/memory' && m === 'GET') return listMem(req, env);
  if (p === '/api/memory' && m === 'POST') return addMem(req, env);
  mm = p.match(/^\/api\/memory\/([^/]+)$/);
  if (mm && m === 'PATCH') return patchMem(req, env, mm[1]);
  if (mm && m === 'DELETE') return delMem(req, env, mm[1]);

  // PROVIDERS
  if (p === '/api/providers' && m === 'GET') return listProv(req, env);
  mm = p.match(/^\/api\/providers\/([^/]+)\/key$/);
  if (mm && m === 'POST') return saveKey(req, env, mm[1]);
  if (mm && m === 'DELETE') return delKey(req, env, mm[1]);
  mm = p.match(/^\/api\/providers\/([^/]+)\/test$/);
  if (mm && m === 'POST') return testProv(req, env, mm[1]);

  // PROJECTS
  if (p === '/api/projects' && m === 'GET') return listProjects(req, env);
  if (p === '/api/projects' && m === 'POST') return newProject(req, env);
  mm = p.match(/^\/api\/projects\/([^/]+)$/);
  if (mm && m === 'DELETE') return delProject(req, env, mm[1]);

  // MUSIC
  if (p === '/api/music/generate' && m === 'POST') return genMusic(req, env);
  if (p === '/api/music/tracks' && m === 'GET') return listTracks(req, env);
  mm = p.match(/^\/api\/music\/tracks\/([^/]+)\/audio$/);
  if (mm && m === 'GET') return trackAudio(req, env, mm[1]);
  mm = p.match(/^\/api\/music\/tracks\/([^/]+)$/);
  if (mm && m === 'DELETE') return delTrack(req, env, mm[1]);
  if (p === '/api/music/write-lyrics' && m === 'POST') return writeLyrics(req, env);

  // MEDIA
  if (p === '/api/media/image' && m === 'POST') return genImage(req, env);
  mm = p.match(/^\/api\/media\/file\/([^/]+)$/);
  if (mm && m === 'GET') return mediaFile(req, env, mm[1]);

  // GITHUB
  if (p === '/api/github/token' && m === 'POST') return saveGh(req, env);
  if (p === '/api/github/test' && m === 'POST') return testGh(req, env);

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
// CRYPTO — extractable=true (klucz do exportKey), PBKDF2=100k
// ============================================================
async function pbkdf2(text, saltB64, iters, mode) {
  const salt = unb64(saltB64);
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(text), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' }, base, 256);
  if (mode === 'aes') return crypto.subtle.importKey('raw', bits, 'AES-GCM', true, ['encrypt', 'decrypt']);
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
  const row = await env.AL_DB.prepare('SELECT s.id, s.user_id, s.csrf_token, s.expires_at, s.master_key_wrapped, u.email, u.login, u.name, u.avatar_url, u.personality, u.personality_custom, u.role, u.settings FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?').bind(sid).first();
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
  if (s.role !== 'admin') throw Object.assign(new Error('Wymagane uprawnienia administratora'), { status: 403 });
  return s;
}
async function reqCsrf(req, env, s) {
  if (!['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method)) return;
  const t = req.headers.get('X-CSRF-Token');
  if (!t || t !== s.csrf_token) throw Object.assign(new Error('Nieprawidłowy token CSRF'), { status: 403 });
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
  if (password.length < 8) return J({ error: 'Hasło musi mieć min. 8 znaków' }, 400);
  if (!/^\d{4}$/.test(pin)) return J({ error: 'PIN musi być 4 cyframi' }, 400);
  if (!PERSONALITIES[personality] && personality !== 'custom') return J({ error: 'Nieprawidłowa osobowość' }, 400);

  const exists = await env.AL_DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) return J({ error: 'Konto z tym e-mailem już istnieje' }, 409);

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
  if (!email || !password || !/^\d{4}$/.test(pin)) return J({ error: 'Wypełnij wszystkie pola (e-mail, hasło, PIN)' }, 400);

  const u = await env.AL_DB.prepare('SELECT id, email, password_hash, password_salt, master_salt, pin_hash, pin_salt, personality, role, banned FROM users WHERE email = ? AND auth_provider = ?').bind(email, 'local').first();
  if (!u) return J({ error: 'Nieprawidłowe dane logowania' }, 401);
  if (u.banned) return J({ error: 'Konto zostało zablokowane' }, 403);

  const ph = await hashPassword(password, u.password_salt);
  if (ph !== u.password_hash) return J({ error: 'Nieprawidłowe dane logowania' }, 401);
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
  const p = PERSONALITIES[s.personality] || (s.personality === 'custom' ? { id: 'custom', name: 'Własna', emoji: '🎨', accent: '#ff4d6d', description: 'Własny prompt', system: s.personality_custom } : PERSONALITIES.coder);
  return J({
    user: { id: s.user_id, email: s.email, login: s.login, name: s.name, avatar_url: s.avatar_url, personality: s.personality, personality_custom: s.personality_custom, role: s.role, settings: JSON.parse(s.settings || '{}') },
    personality: p,
    csrf: s.csrf_token
  });
}

async function updatePersonality(req, env) {
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
async function adminStats(req, env) {
  await reqAdmin(req, env);
  const [users, convs, msgs, tracks, media] = await Promise.all([
    env.AL_DB.prepare('SELECT COUNT(*) AS n FROM users').first('n'),
    env.AL_DB.prepare('SELECT COUNT(*) AS n FROM conversations').first('n'),
    env.AL_DB.prepare('SELECT COUNT(*) AS n FROM messages').first('n'),
    env.AL_DB.prepare('SELECT COUNT(*) AS n FROM tracks').first('n'),
    env.AL_DB.prepare('SELECT COUNT(*) AS n FROM media').first('n')
  ]);
  return J({ users, conversations: convs, messages: msgs, tracks, media });
}
async function adminUsers(req, env) {
  await reqAdmin(req, env);
  const rows = await env.AL_DB.prepare('SELECT id, email, login, name, personality, role, banned, last_login_at, created_at FROM users ORDER BY created_at DESC').all();
  return J({ users: rows.results });
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
  if (id === admin.user_id) return J({ error: 'Nie możesz usunąć własnego konta' }, 400);
  await env.AL_DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return J({ ok: true });
}

// ============================================================
// CONVERSATIONS
// ============================================================
async function listConvs(req, env) {
  const s = await reqSess(req, env);
  const r = await env.AL_DB.prepare('SELECT id, title, pinned, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC LIMIT 100').bind(s.user_id).all();
  return J({ conversations: r.results });
}
async function newConv(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const id = uid('c_'), title = (b.title || 'Nowa rozmowa').slice(0, 120);
  await env.AL_DB.prepare('INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)').bind(id, s.user_id, title).run();
  return J({ conversation: { id, title, pinned: 0, created_at: Math.floor(Date.now() / 1000) } });
}
async function getConv(req, env, id) {
  const s = await reqSess(req, env);
  const c = await env.AL_DB.prepare('SELECT id, title, pinned, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?').bind(id, s.user_id).first();
  if (!c) return J({ error: 'Nie znaleziono rozmowy' }, 404);
  const msgs = await env.AL_DB.prepare('SELECT id, role, content, model, provider, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').bind(id).all();
  return J({ conversation: c, messages: msgs.results });
}
async function patchConv(req, env, id) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const f = [], v = [];
  if (typeof b.title === 'string') { f.push('title = ?'); v.push(b.title.trim().slice(0, 120) || 'Nowa rozmowa'); }
  if ('pinned' in b) { f.push('pinned = ?'); v.push(b.pinned ? 1 : 0); }
  if (!f.length) return J({ error: 'Brak pól' }, 400);
  v.push(id, s.user_id);
  await env.AL_DB.prepare(`UPDATE conversations SET ${f.join(', ')} WHERE id = ? AND user_id = ?`).bind(...v).run();
  return J({ ok: true });
}
async function deleteConv(req, env, id) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  await env.AL_DB.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').bind(id, s.user_id).run();
  return J({ ok: true });
}

// ============================================================
// MESSAGES
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
  if (!conv) return J({ error: 'Nie znaleziono rozmowy' }, 404);

  if (retry) await env.AL_DB.prepare('DELETE FROM messages WHERE id = ? AND conversation_id = ? AND role = ?').bind(retry, cid, 'assistant').run();
  else await env.AL_DB.prepare('INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)').bind(uid('msg_'), cid, 'user', content).run();

  const cnt = await env.AL_DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').bind(cid).first('n');
  if (cnt === 1 && content) await env.AL_DB.prepare('UPDATE conversations SET title = ?, updated_at = unixepoch() WHERE id = ?').bind(content.slice(0, 60).replace(/\s+/g, ' ').trim() || 'Nowa rozmowa', cid).run();
  else await env.AL_DB.prepare('UPDATE conversations SET updated_at = unixepoch() WHERE id = ?').bind(cid).run();

  const hist = (await env.AL_DB.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 60').bind(cid).all()).results;
  const mem = (await env.AL_DB.prepare('SELECT type, content FROM memory WHERE user_id = ? AND enabled = 1 ORDER BY pinned DESC, created_at DESC LIMIT 40').bind(s.user_id).all()).results;
  const memBlock = mem.map(x => `[${x.type}] ${x.content}`).join('\n');
  const pers = s.personality === 'custom' ? (s.personality_custom || 'Jesteś pomocnym asystentem.') : (PERSONALITIES[s.personality]?.system || PERSONALITIES.coder.system);
  const systemPrompt = pers + (memBlock ? '\n\nPAMIĘĆ GLOBALNA:\n' + memBlock : '') + '\n\nJesteś klonem AI użytkownika. Analizuj historię. Nie kłam. Język: polski.';
  const messages = [{ role: 'system', content: systemPrompt }, ...hist.map(h => ({ role: h.role, content: h.content }))];

  const plan = await resolveProvider(modelSel, env, s);
  if (plan.provider === 'puter') return J({ error: 'Puter obsługiwany po stronie klienta. Wybierz innego providera.' }, 400);

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
        else throw new Error('Nieobsługiwany provider: ' + prov);
        await env.AL_DB.prepare('INSERT INTO messages (id, conversation_id, role, content, model, provider) VALUES (?, ?, ?, ?, ?, ?)').bind(uid('msg_'), cid, 'assistant', acc, mdl, prov).run();
        send({ meta: { model: mdl, provider: prov } });
        end();
      } catch (e) { console.error(e); send({ error: e.message }); end(); }
    }
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } });
}

async function deleteMsg(req, env, id) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const row = await env.AL_DB.prepare('SELECT m.id, c.user_id FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ?').bind(id).first();
  if (!row || row.user_id !== s.user_id) return J({ error: 'Nie znaleziono' }, 404);
  await env.AL_DB.prepare('DELETE FROM messages WHERE id = ?').bind(id).run();
  return J({ ok: true });
}

// ============================================================
// MEMORY / PROVIDERS / PROJECTS
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
  if (typeof b.content === 'string') { f.push('content = ?'); v.push(b.content.slice(0, 2000)); }
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
async function listProv(req, env) {
  const s = await reqSess(req, env);
  const r = await env.AL_DB.prepare('SELECT provider, model FROM provider_keys WHERE user_id = ?').bind(s.user_id).all();
  const cfg = new Map(r.results.map(x => [x.provider, x]));
  const providers = Object.entries(PROVIDER_META).map(([id, m]) => ({ id, name: m.name, kind: m.kind, models: [m.defaultModel], configured: cfg.has(id), model: cfg.get(id)?.model || null }));
  return J({ providers });
}
async function saveKey(req, env, prov) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  if (!PROVIDER_META[prov]) return J({ error: 'Nieznany provider' }, 400);
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
    if (!k) return J({ error: 'Brak zapisanego klucza' }, 400);
    const tests = {
      groq: ['https://api.groq.com/openai/v1/models', true],
      openrouter: ['https://openrouter.ai/api/v1/models', true],
      gemini: [`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}`, false],
      grok: ['https://api.x.ai/v1/models', true],
      huggingface: ['https://huggingface.co/api/whoami-v2', true],
      'ace-step': ['https://acestep.io/api/v2/models', true]
    };
    const c = tests[prov];
    if (!c) return J({ ok: true, message: 'Klucz zapisany (brak testu)' });
    const headers = c[1] ? { Authorization: 'Bearer ' + k } : {};
    const r = await fetch(c[0], { headers });
    if (!r.ok) return J({ error: `${prov} HTTP ${r.status}` }, 400);
    return J({ ok: true, message: prov + ' — połączenie OK' });
  } catch (e) { return J({ error: e.message }, 400); }
}
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
async function delProject(req, env, id) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  await env.AL_DB.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').bind(id, s.user_id).run();
  return J({ ok: true });
}

// ============================================================
// MUSIC / MEDIA / GITHUB
// ============================================================
async function genMusic(req, env) {
  const s = await reqSess(req, env); await reqCsrf(req, env, s);
  const b = await safeJson(req);
  const style = (b.style || '').trim(), lyrics = (b.lyrics || '').trim();
  const engine = b.engine === 'minimax' ? 'minimax' : 'ace-step';
  const dur = Math.min(Math.max(parseInt(b.duration, 10) || 120, 15), 240);
  if (!style) return J({ error: 'Podaj styl / gatunek' }, 400);
  let buf = null;

  if (engine === 'ace-step') {
    const k = await getKey(env, s, 'ace-step');
    if (!k) return J({ error: 'Brak klucza ACE-Step. Skonfiguruj w Ustawieniach.' }, 400);
    const r = await fetch('https://acestep.io/api/v2/generate-audio', { method: 'POST', headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' }, body: JSON.stringify({ style, lyrics: lyrics || undefined, duration: dur, format: 'mp3' }) });
    if (!r.ok) return J({ error: 'ACE-Step HTTP ' + r.status }, 502);
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('audio')) buf = await r.arrayBuffer();
    else {
      const j = await r.json();
      if (j.audio_base64) { const bin = atob(j.audio_base64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); buf = u8.buffer; }
      else if (j.audio_url) { const ar = await fetch(j.audio_url); buf = await ar.arrayBuffer(); }
      else return J({ error: 'Brak audio w odpowiedzi' }, 502);
    }
  } else {
    if (!env.AI) return J({ error: 'Brak bindingu AI' }, 500);
    try {
      const res = await env.AI.run('@cf/minimax/music-2.6', { prompt: style, lyrics: lyrics || undefined, output_format: 'mp3' });
      if (res instanceof ArrayBuffer) buf = res;
      else if (res?.audio instanceof ArrayBuffer) buf = res.audio;
      else return J({ error: 'MiniMax: nieoczekiwany format' }, 502);
    } catch (e) { return J({ error: 'MiniMax: ' + e.message }, 502); }
  }
  if (!buf) return J({ error: 'Nie udało się wygenerować' }, 502);

  const tid = uid('t_'), r2k = `${s.user_id}/tracks/${tid}.mp3`;
  await env.AL_BUCKET.put(r2k, buf, { httpMetadata: { contentType: 'audio/mpeg' } });
  await env.AL_DB.prepare('INSERT INTO tracks (id, user_id, title, style, lyrics, engine, r2_key, duration_s) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(tid, s.user_id, style.slice(0, 60), style.slice(0, 500), lyrics || null, engine, r2k, dur).run();
  return J({ id: tid, ok: true });
}
async function listTracks(req, env) {
  const s = await reqSess(req, env);
  const r = await env.AL_DB.prepare('SELECT id, title, style, engine, duration_s, created_at FROM tracks WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').bind(s.user_id).all();
  return J({ tracks: r.results });
}
async function trackAudio(req, env, id) {
  const s = await reqSess(req, env);
  const row = await env.AL_DB.prepare('SELECT r2_key FROM tracks WHERE id = ? AND user_id = ?').bind(id, s.user_id).first();
  if (!row) return J({ error: 'Nie znaleziono' }, 404);
  const o = await env.AL_BUCKET.get(row.r2_key);
  if (!o) return J({ error: 'Plik nie istnieje' }, 410);
  return new Response(o.body, { headers: { 'Content-Type': 'audio/mpeg' } });
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
  const prompt = `Napisz tekst piosenki w stylu: ${style}. Struktura [Verse],[Chorus],[Bridge],[Outro]. Język polski. Zwróć TYLKO tekst.`;
  let out = '';
  try {
    const gk = await getKey(env, s, 'groq');
    if (gk) {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + gk, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.85, max_tokens: 1200 }) });
      out = (await r.json()).choices?.[0]?.message?.content || '';
    } else if (env.AI) {
      const r = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', { messages: [{ role: 'user', content: prompt }] });
      out = r.response || '';
    } else return J({ error: 'Brak Groq / Workers AI' }, 400);
  } catch (e) { return J({ error: e.message }, 502); }
  return J({ lyrics: out.trim() });
}
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
    if (!r.ok) return J({ error: 'Pollinations HTTP ' + r.status }, 502);
    buf = await r.arrayBuffer();
  } else if (provider === 'cloudflare') {
    if (!env.AI) return J({ error: 'Brak AI' }, 500);
    const res = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt: styled, width: w, height: h });
    buf = res instanceof ArrayBuffer ? res : res?.image instanceof ArrayBuffer ? res.image : null;
  }
  if (!buf) return J({ error: 'Nie udało się wygenerować' }, 502);
  const id = uid('img_'), r2k = `${s.user_id}/media/${id}.png`;
  await env.AL_BUCKET.put(r2k, buf, { httpMetadata: { contentType: 'image/png' } });
  await env.AL_DB.prepare('INSERT INTO media (id, user_id, kind, provider, prompt, r2_key) VALUES (?, ?, ?, ?, ?, ?)').bind(id, s.user_id, 'image', provider, prompt.slice(0, 1000), r2k).run();
  return J({ id, url: '/api/media/file/' + id });
}
async function mediaFile(req, env, id) {
  const s = await reqSess(req, env);
  const row = await env.AL_DB.prepare('SELECT r2_key, kind FROM media WHERE id = ? AND user_id = ?').bind(id, s.user_id).first();
  if (!row) return J({ error: 'Nie znaleziono' }, 404);
  const o = await env.AL_BUCKET.get(row.r2_key);
  if (!o) return J({ error: 'Plik nie istnieje' }, 410);
  return new Response(o.body, { headers: { 'Content-Type': row.kind === 'video' ? 'video/mp4' : 'image/png' } });
}
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
  if (!r) return J({ error: 'Brak tokenu GitHub' }, 400);
  const t = await decryptWith(s.masterKey, r.encrypted_token);
  const resp = await fetch('https://api.github.com/user', { headers: { 'Authorization': 'Bearer ' + t, 'User-Agent': 'AL2100' } });
  if (!resp.ok) return J({ error: 'GitHub HTTP ' + resp.status }, 502);
  return J({ ok: true, login: (await resp.json()).login });
}

// ============================================================
// PROVIDER LOGIC
// ============================================================
async function resolveProvider(sel, env, s) {
  if (sel === 'auto' || !sel) {
    if (await getKey(env, s, 'groq')) return { provider: 'groq', model: 'llama-3.3-70b-versatile' };
    if (await getKey(env, s, 'openrouter')) return { provider: 'openrouter', model: 'deepseek/deepseek-chat-v3.1:free' };
    if (await getKey(env, s, 'gemini')) return { provider: 'gemini', model: 'gemini-2.5-flash' };
    if (await getKey(env, s, 'grok')) return { provider: 'grok', model: 'grok-4' };
    return { provider: 'workers-ai', model: '@cf/meta/llama-3.1-8b-instruct' };
  }
  if (sel.startsWith('puter:')) return { provider: 'puter', model: sel.replace('puter:', '') };
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
  if (!k) throw new Error(`Brak klucza ${prov}. Skonfiguruj w Ustawieniach.`);
  const r = await fetch(url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, stream: true, temperature: 0.7 }) });
  if (!r.ok) throw new Error(`${prov} HTTP ${r.status}: ` + (await r.text()).slice(0, 200));
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
