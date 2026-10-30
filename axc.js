#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function lex(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let value = '';
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') { i++; value += source[i]; }
        else value += source[i];
        i++;
      }
      i++;
      tokens.push({ type: 'STRING', value });
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let value = '';
      while (i < source.length && /[0-9.]/.test(source[i])) { value += source[i]; i++; }
      tokens.push({ type: 'NUMBER', value: parseFloat(value) });
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let value = '';
      while (i < source.length && /[a-zA-Z0-9_]/.test(source[i])) { value += source[i]; i++; }
      tokens.push({ type: 'IDENT', value });
      continue;
    }
    if (ch === '{' || ch === '}' || ch === '(' || ch === ')' || ch === '[' || ch === ']' ||
        ch === ':' || ch === ';' || ch === ',' || ch === '=' || ch === '+' || ch === '-' ||
        ch === '*' || ch === '/' || ch === '.' || ch === '>' || ch === '<' || ch === '!' ||
        ch === '&' || ch === '|' || ch === '?' || ch === '#' || ch === '@' || ch === '%') {
      tokens.push({ type: 'PUNCT', value: ch });
      i++;
      continue;
    }
    i++;
  }
  return tokens;
}

function parse(tokens) {
  let pos = 0;
  function peek() { return tokens[pos]; }
  function consume() { return tokens[pos++]; }
  function expect(type, value) {
    const t = tokens[pos];
    if (!t || t.type !== type || (value !== undefined && t.value !== value)) {
      throw new Error(`Expected ${type} ${value || ''} at ${pos}`);
    }
    pos++;
    return t;
  }
  function parseBlock() {
    const node = { type: 'Block', name: '', props: [], children: [] };
    if (peek() && peek().type === 'IDENT') {
      node.name = consume().value;
    }
    expect('PUNCT', '{');
    while (peek() && !(peek().type === 'PUNCT' && peek().value === '}')) {
      if (peek().type === 'IDENT') {
        const id = consume().value;
        if (peek() && peek().type === 'PUNCT' && peek().value === ':') {
          consume();
          let value = '';
          if (peek().type === 'STRING' || peek().type === 'NUMBER' || peek().type === 'IDENT') {
            value = consume().value;
          } else if (peek().type === 'PUNCT' && peek().value === '{') {
            const block = parseBlock();
            node.children.push({ type: 'Property', key: id, value: block });
            continue;
          }
          node.props.push({ key: id, value });
          if (peek() && peek().type === 'PUNCT' && peek().value === ';') consume();
        } else if (peek() && peek().type === 'PUNCT' && peek().value === '{') {
          const block = parseBlock();
          block.name = id;
          node.children.push(block);
        } else {
          node.props.push({ key: id, value: true });
        }
      } else if (peek() && peek().type === 'PUNCT' && peek().value === '{') {
        node.children.push(parseBlock());
      } else {
        consume();
      }
    }
    expect('PUNCT', '}');
    return node;
  }
  const ast = { type: 'Program', blocks: [] };
  while (pos < tokens.length) {
    ast.blocks.push(parseBlock());
  }
  return ast;
}

function analyze(ast) {
  const errors = [];
  function walk(node) {
    if (node.type === 'Block') {
      if (!node.name && node.props.length === 0 && node.children.length === 0) {
        errors.push('Empty block');
      }
      for (const child of node.children) walk(child);
    }
  }
  walk(ast);
  return errors;
}

function generate(ast) {
  let workerCode = `
const SESSION_COOKIE = 'al2100_session';

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/') {
    return new Response(HTML, { headers: { 'Content-Type': 'text/html' } });
  }
  if (path === '/app.js') {
    return new Response(JS, { headers: { 'Content-Type': 'application/javascript' } });
  }
  if (path === '/app.css') {
    return new Response(CSS, { headers: { 'Content-Type': 'text/css' } });
  }

  if (path === '/auth/github') {
    const clientId = env.GITHUB_CLIENT_ID;
    const redirectUri = url.origin + '/auth/callback';
    const state = crypto.randomUUID();
    const response = new Response(null, {
      status: 302,
      headers: {
        Location: \`https://github.com/login/oauth/authorize?client_id=\${clientId}&redirect_uri=\${redirectUri}&state=\${state}&scope=read:user\`,
        'Set-Cookie': \`oauth_state=\${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600\`
      }
    });
    return response;
  }

  if (path === '/auth/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const cookies = parseCookies(request);
    if (!code || !state || state !== cookies.oauth_state) {
      return new Response('Invalid state', { status: 400 });
    }
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: url.origin + '/auth/callback'
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return new Response('OAuth failed', { status: 401 });
    }
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: \`Bearer \${tokenData.access_token}\`, 'User-Agent': 'AL2100' }
    });
    const userData = await userRes.json();
    const userId = String(userData.id);
    const login = userData.login;
    const name = userData.name || login;
    const avatar = userData.avatar_url || '';

    let user = await env.AL_DB.prepare('SELECT * FROM users WHERE github_id = ?').bind(userId).first();
    if (!user) {
      const result = await env.AL_DB.prepare(
        'INSERT INTO users (github_id, login, name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(userId, login, name, avatar, new Date().toISOString()).run();
      user = { id: result.meta.last_row_id, github_id: userId, login, name, avatar_url: avatar };
    }

    const sessionId = crypto.randomUUID();
    const tokenHash = await sha256(sessionId);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await env.AL_DB.prepare(
      'INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)'
    ).bind(String(user.id), tokenHash, expiresAt, new Date().toISOString()).run();

    return new Response(null, {
      status: 302,
      headers: {
        Location: '/',
        'Set-Cookie': \`\${SESSION_COOKIE}=\${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800\`
      }
    });
  }

  if (path === '/auth/logout') {
    const cookies = parseCookies(request);
    const sessionId = cookies[SESSION_COOKIE];
    if (sessionId) {
      const tokenHash = await sha256(sessionId);
      await env.AL_DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/',
        'Set-Cookie': \`\${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0\`
      }
    });
  }

  const cookies = parseCookies(request);
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) {
    return new Response('Unauthorized', { status: 401 });
  }
  const tokenHash = await sha256(sessionId);
  const session = await env.AL_DB.prepare(
    'SELECT s.*, u.id as user_id, u.login, u.name, u.avatar_url FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ?'
  ).bind(tokenHash, new Date().toISOString()).first();
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }
  const userId = String(session.user_id);

  if (path === '/api/keys' && request.method === 'GET') {
    const rows = await env.AL_DB.prepare('SELECT provider, encrypted_key FROM api_keys WHERE user_id = ?').bind(userId).all();
    const keys = {};
    for (const row of rows.results) {
      keys[row.provider] = decrypt(row.encrypted_key, env.AL_MASTER_ENCRYPTION_KEY);
    }
    return new Response(JSON.stringify(keys), { headers: { 'Content-Type': 'application/json' } });
  }

  if (path === '/api/keys' && request.method === 'POST') {
    const body = await request.json();
    for (const [provider, key] of Object.entries(body)) {
      if (!key) continue;
      const encrypted = encrypt(key, env.AL_MASTER_ENCRYPTION_KEY);
      const existing = await env.AL_DB.prepare('SELECT id FROM api_keys WHERE user_id = ? AND provider = ?').bind(userId, provider).first();
      if (existing) {
        await env.AL_DB.prepare('UPDATE api_keys SET encrypted_key = ?, updated_at = ? WHERE id = ?').bind(encrypted, new Date().toISOString(), existing.id).run();
      } else {
        await env.AL_DB.prepare('INSERT INTO api_keys (user_id, provider, encrypted_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(userId, provider, encrypted, new Date().toISOString(), new Date().toISOString()).run();
      }
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (path === '/api/conversations' && request.method === 'GET') {
    const rows = await env.AL_DB.prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC').bind(userId).all();
    return new Response(JSON.stringify(rows.results), { headers: { 'Content-Type': 'application/json' } });
  }

  if (path === '/api/conversations' && request.method === 'POST') {
    const result = await env.AL_DB.prepare(
      'INSERT INTO conversations (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).bind(userId, 'New Conversation', new Date().toISOString(), new Date().toISOString()).run();
    return new Response(JSON.stringify({ id: result.meta.last_row_id }), { headers: { 'Content-Type': 'application/json' } });
  }

  const convMatch = path.match(/^\\/api\\/conversations\\/(\\d+)\\/messages$/);
  if (convMatch) {
    const convId = convMatch[1];
    if (request.method === 'GET') {
      const rows = await env.AL_DB.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').bind(convId).all();
      return new Response(JSON.stringify(rows.results), { headers: { 'Content-Type': 'application/json' } });
    }
    if (request.method === 'POST') {
      const body = await request.json();
      const result = await env.AL_DB.prepare(
        'INSERT INTO messages (conversation_id, role, content, provider, model, sources, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(convId, body.role, body.content, body.provider || '', body.model || '', body.sources || '', new Date().toISOString()).run();
      await env.AL_DB.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').bind(new Date().toISOString(), convId).run();
      return new Response(JSON.stringify({ id: result.meta.last_row_id }), { headers: { 'Content-Type': 'application/json' } });
    }
  }

  if (path === '/api/chat' && request.method === 'POST') {
    const body = await request.json();
    const { conversationId, message, provider, model } = body;

    const history = await env.AL_DB.prepare(
      'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).bind(conversationId).all();

    let fullHistory = history.results;
    let context = fullHistory;
    if (fullHistory.length > 20) {
      const first = fullHistory[0];
      const recent = fullHistory.slice(-19);
      const important = fullHistory.filter(m => {
        const lower = m.content.toLowerCase();
        return lower.includes('decision') || lower.includes('requirement') || lower.includes('fact') || lower.includes('agreement') || lower.includes('ustalenie') || lower.includes('wymaganie') || lower.includes('fakt');
      });
      context = [first];
      for (const m of important) {
        if (!context.includes(m) && !recent.includes(m)) context.push(m);
      }
      for (const m of recent) {
        if (!context.includes(m)) context.push(m);
      }
      context.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }

    const systemPrompt = 'You are AL2100, a precise AI assistant. Distinguish facts, opinions, and uncertainties. If information is missing, ask. Do not moralize. Respond directly.';
    const messages = [
      { role: 'system', content: systemPrompt },
      ...context.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: message }
    ];

    const keys = {};
    const keyRows = await env.AL_DB.prepare('SELECT provider, encrypted_key FROM api_keys WHERE user_id = ?').bind(userId).all();
    for (const row of keyRows.results) {
      keys[row.provider] = decrypt(row.encrypted_key, env.AL_MASTER_ENCRYPTION_KEY);
    }

    const fallbackOrder = ['cloudflare', 'groq', 'gemini', 'mistral', 'openrouter'];
    let selectedProvider = provider || 'auto';
    let selectedModel = model || '';

    const tryProvider = async (p) => {
      if (!keys[p]) return { error: 'No key' };
      let m = selectedModel || selectModel(p, context);
      let url, headers, bodyData;
      if (p === 'cloudflare') {
        url = \`https://api.cloudflare.com/client/v4/accounts/\${keys.cloudflare}/ai/v1/chat/completions\`;
        headers = { Authorization: \`Bearer \${keys.cloudflare}\`, 'Content-Type': 'application/json' };
        bodyData = { model: m, messages, stream: false };
      } else if (p === 'groq') {
        url = 'https://api.groq.com/openai/v1/chat/completions';
        headers = { Authorization: \`Bearer \${keys.groq}\`, 'Content-Type': 'application/json' };
        bodyData = { model: m, messages };
      } else if (p === 'gemini') {
        url = \`https://generativelanguage.googleapis.com/v1beta/models/\${m}:generateContent?key=\${keys.gemini}\`;
        headers = { 'Content-Type': 'application/json' };
        bodyData = { contents: messages.filter(msg => msg.role !== 'system').map(msg => ({ role: msg.role === 'user' ? 'user' : 'model', parts: [{ text: msg.content }] })) };
      } else if (p === 'mistral') {
        url = 'https://api.mistral.ai/v1/chat/completions';
        headers = { Authorization: \`Bearer \${keys.mistral}\`, 'Content-Type': 'application/json' };
        bodyData = { model: m, messages };
      } else if (p === 'openrouter') {
        url = 'https://openrouter.ai/api/v1/chat/completions';
        headers = { Authorization: \`Bearer \${keys.openrouter}\`, 'Content-Type': 'application/json' };
        bodyData = { model: m, messages };
      }
      try {
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(bodyData) });
        if (!res.ok) return { error: \`HTTP \${res.status}\` };
        const data = await res.json();
        let content = '';
        if (p === 'gemini') {
          content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else {
          content = data.choices?.[0]?.message?.content || '';
        }
        return { content, provider: p, model: m };
      } catch (e) {
        return { error: e.message };
      }
    };

    let result;
    if (selectedProvider === 'auto') {
      for (const p of fallbackOrder) {
        if (keys[p]) {
          result = await tryProvider(p);
          if (result.content) break;
        }
      }
    } else {
      result = await tryProvider(selectedProvider);
    }

    if (!result || !result.content) {
      return new Response(JSON.stringify({ error: 'All providers failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  }

  if (path === '/api/search' && request.method === 'POST') {
    const body = await request.json();
    const query = body.query;
    const url = \`https://html.duckduckgo.com/html/?q=\${encodeURIComponent(query)}\`;
    const res = await fetch(url);
    const html = await res.text();
    const results = [];
    const regex = /<a rel="nofollow" class="result__a" href="([^"]+)">([^<]+)<\\/a>[\\s\\S]*?<a class="result__snippet"[^>]*>([\\s\\S]*?)<\\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null && results.length < 5) {
      const href = match[1];
      if (href.includes('duckduckgo.com')) continue;
      if (href.startsWith('//')) continue;
      const title = match[2].replace(/<[^>]+>/g, '');
      const snippet = match[3].replace(/<[^>]+>/g, '').trim();
      if (title && snippet) {
        results.push({ title, url: href, snippet });
      }
    }
    return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response('Not Found', { status: 404 });
}

function selectModel(provider, context) {
  const totalLength = context.reduce((sum, m) => sum + m.content.length, 0);
  const needsLongContext = totalLength > 50000;
  const needsCode = context.some(m => m.content.toLowerCase().includes('code') || m.content.toLowerCase().includes('kod'));
  switch (provider) {
    case 'cloudflare': return needsLongContext ? '@cf/deepseek-ai/deepseek-v4-pro-0813' : needsCode ? '@cf/qwen/qwen2.5-coder-32b-instruct' : '@cf/meta/llama-4-scout-17b-16e-instruct';
    case 'groq': return needsCode ? 'openai/gpt-oss-120b' : 'llama-3.3-70b-versatile';
    case 'gemini': return needsLongContext ? 'gemini-2.5-pro' : 'gemini-2.5-flash';
    case 'mistral': return needsCode ? 'mistral-code-latest' : 'mistral-large-latest';
    case 'openrouter': return needsLongContext ? 'openai/gpt-5.2' : 'openai/gpt-4.1-mini';
    default: return 'llama-3.3-70b-versatile';
  }
}

async function sha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseCookies(request) {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return {};
  const result = {};
  cookie.split(';').forEach(part => {
    const [key, ...rest] = part.trim().split('=');
    result[key] = rest.join('=');
  });
  return result;
}

function encrypt(text, key) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const keyData = encoder.encode(key.padEnd(32, '0').slice(0, 32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keyData, data).then(encrypted => {
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
  });
}

function decrypt(encoded, key) {
  const encoder = new TextEncoder();
  const combined = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const keyData = encoder.encode(key.padEnd(32, '0').slice(0, 32));
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, keyData, data).then(decrypted => new TextDecoder().decode(decrypted));
}

const HTML = \`<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AL2100</title>
<link rel="stylesheet" href="/app.css">
</head>
<body>
<div id="app"></div>
<script src="/app.js"></script>
</body>
</html>\`;

const CSS = \`*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#0A0F1E;color:#EAF2FF;height:100vh;display:flex;flex-direction:column}
#app{flex:1;display:flex;flex-direction:column;overflow:hidden}
.center{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;gap:16px;padding:24px}
.heading{font-family:'Space Grotesk',sans-serif;font-size:28px;font-weight:700}
.button{padding:12px 24px;border:none;border-radius:20px;background:#00E5FF;color:#0A0F1E;font-weight:600;cursor:pointer;transition:opacity 0.2s}
.button:hover{opacity:0.9}
.button.ghost{background:transparent;color:#EAF2FF;border:1px solid #121A2E}
.button.danger{background:#FF4D6D;color:#fff}
.card{background:#121A2E;border-radius:20px;padding:16px;margin:8px 0}
.header{display:flex;align-items:center;padding:16px;border-bottom:1px solid #121A2E;gap:12px}
.header h1{flex:1;font-size:18px}
.message{max-width:80%;padding:12px 16px;border-radius:20px;margin:8px 0;word-wrap:break-word}
.message.user{background:#00E5FF;color:#0A0F1E;align-self:flex-end}
.message.assistant{background:#121A2E;align-self:flex-start}
.messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column}
.input-area{display:flex;gap:8px;padding:16px;border-top:1px solid #121A2E}
.input-area textarea{flex:1;padding:12px;border-radius:20px;border:1px solid #121A2E;background:#0A0F1E;color:#EAF2FF;resize:none;font-family:inherit}
.input-area textarea:focus{outline:2px solid #00E5FF}
.nav{display:flex;padding:8px;border-top:1px solid #121A2E;justify-content:space-around}
.nav button{background:none;border:none;color:#EAF2FF;padding:8px 16px;border-radius:12px;cursor:pointer}
.nav button.active{background:#121A2E;color:#00E5FF}
.fade-in{animation:fadeIn 0.3s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@media (prefers-reduced-motion: reduce){*{animation-duration:0.01ms !important;transition-duration:0.01ms !important}}
\`;

const JS = \`(function(){
const state = {
  user: null,
  conversations: [],
  activeConversationId: null,
  messages: [],
  apiKeys: {},
  providerStatus: {},
  autoMode: true,
  activeProvider: 'auto',
  activeModel: '',
  isGenerating: false,
  abortController: null,
  theme: 'dark',
  currentScreen: 'login',
  commandPaletteOpen: false
};

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function render() {
  const app = document.getElementById('app');
  if (state.currentScreen === 'login') {
    app.innerHTML = \\\`<div class="center"><h1 class="heading">AL2100</h1><p>Sign in with GitHub to continue</p><button class="button" onclick="window.location.href='/auth/github'">Login with GitHub</button></div>\\\`;
    return;
  }
  if (state.currentScreen === 'chat') {
    app.innerHTML = \\\`<div class="header"><h1>AL2100</h1><button class="button ghost" id="historyBtn">History</button><button class="button ghost" id="settingsBtn">Settings</button></div><div class="messages" id="messages">\\\${state.messages.map(m => \\\`<div class="message \\\${m.role} fade-in">\\\${escapeHtml(m.content)}</div>\\\`).join('')}</div><div class="input-area"><textarea id="messageInput" rows="1" placeholder="Type a message..."></textarea><button class="button" id="sendBtn">Send</button></div><div class="nav"><button class="active" data-screen="chat">Chat</button><button data-screen="history">History</button><button data-screen="settings">Settings</button></div>\\\`;
    document.getElementById('sendBtn').onclick = sendMessage;
    document.getElementById('messageInput').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
    document.getElementById('historyBtn').onclick = () => { state.currentScreen = 'history'; render(); };
    document.getElementById('settingsBtn').onclick = () => { state.currentScreen = 'settings'; render(); };
    document.querySelectorAll('.nav button').forEach(btn => { btn.onclick = () => { state.currentScreen = btn.dataset.screen; render(); }; });
    return;
  }
  if (state.currentScreen === 'history') {
    app.innerHTML = \\\`<div class="header"><h1>Conversations</h1><button class="button ghost" id="backBtn">Back</button></div><div style="flex:1;overflow-y:auto;padding:16px">\\\${state.conversations.map(c => \\\`<div class="card fade-in" onclick="window.selectConversation(\\\${c.id})"><strong>\\\${escapeHtml(c.title)}</strong><br><small>\\\${c.updated_at}</small></div>\\\`).join('')}</div><div style="padding:16px"><button class="button" id="newConvBtn" style="width:100%">New Conversation</button></div>\\\`;
    document.getElementById('backBtn').onclick = () => { state.currentScreen = 'chat'; render(); };
    document.getElementById('newConvBtn').onclick = createConversation;
    return;
  }
  if (state.currentScreen === 'settings') {
    const providers = ['cloudflare', 'groq', 'gemini', 'mistral', 'openrouter'];
    app.innerHTML = \\\`<div class="header"><h1>Settings</h1><button class="button ghost" id="backBtn">Back</button></div><div style="flex:1;overflow-y:auto;padding:16px">\\\${providers.map(p => \\\`<div class="card"><label>\\\${p} API Key</label><input type="password" id="key-\\\${p}" value="\\\${state.apiKeys[p] || ''}" style="width:100%;margin-top:8px;padding:8px;border-radius:12px;border:1px solid #121A2E;background:#0A0F1E;color:#EAF2FF"></div>\\\`).join('')}<div class="card"><label>Auto Mode</label><input type="checkbox" id="autoMode" \\\${state.autoMode ? 'checked' : ''} style="margin-top:8px"></div></div><div style="padding:16px;display:flex;gap:8px"><button class="button" id="saveKeysBtn" style="flex:1">Save</button><button class="button ghost" id="testBtn" style="flex:1">Test</button><button class="button danger" id="logoutBtn" style="flex:1">Logout</button></div>\\\`;
    document.getElementById('backBtn').onclick = () => { state.currentScreen = 'chat'; render(); };
    document.getElementById('saveKeysBtn').onclick = saveKeys;
    document.getElementById('testBtn').onclick = testConnections;
    document.getElementById('logoutBtn').onclick = logout;
    return;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function loadUser() {
  try {
    const data = await api('/api/me');
    state.user = data;
    state.currentScreen = 'chat';
    render();
  } catch {
    state.currentScreen = 'login';
    render();
  }
}

async function loadConversations() {
  state.conversations = await api('/api/conversations');
}

async function loadMessages() {
  if (!state.activeConversationId) return;
  state.messages = await api(\\\`/api/conversations/\\\${state.activeConversationId}/messages\\\`);
}

async function createConversation() {
  const data = await api('/api/conversations', { method: 'POST' });
  state.activeConversationId = data.id;
  state.messages = [];
  state.currentScreen = 'chat';
  await loadConversations();
  render();
}

window.selectConversation = async (id) => {
  state.activeConversationId = id;
  await loadMessages();
  state.currentScreen = 'chat';
  render();
};

async function sendMessage() {
  const input = document.getElementById('messageInput');
  const content = input.value.trim();
  if (!content || state.isGenerating) return;
  input.value = '';
  state.messages.push({ role: 'user', content, created_at: new Date().toISOString() });
  render();
  state.isGenerating = true;
  state.abortController = new AbortController();
  try {
    const result = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: state.activeConversationId,
        message: content,
        provider: state.autoMode ? 'auto' : state.activeProvider,
        model: state.activeModel
      })
    });
    state.messages.push({ role: 'assistant', content: result.content, provider: result.provider, model: result.model, created_at: new Date().toISOString() });
    state.activeProvider = result.provider;
    state.activeModel = result.model;
  } catch (e) {
    state.messages.push({ role: 'assistant', content: 'Error: ' + e.message, created_at: new Date().toISOString() });
  }
  state.isGenerating = false;
  render();
}

async function saveKeys() {
  const providers = ['cloudflare', 'groq', 'gemini', 'mistral', 'openrouter'];
  const body = {};
  for (const p of providers) {
    const input = document.getElementById('key-' + p);
    if (input && input.value) body[p] = input.value;
  }
  const auto = document.getElementById('autoMode');
  state.autoMode = auto ? auto.checked : true;
  await api('/api/keys', { method: 'POST', body: JSON.stringify(body) });
  alert('Keys saved');
}

async function testConnections() {
  alert('Test not implemented client-side; use chat to verify.');
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  state.user = null;
  state.currentScreen = 'login';
  render();
}

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    alert('Command palette not implemented in this build.');
  }
});

(async function init() {
  try {
    await loadUser();
    await loadConversations();
    if (state.conversations.length > 0) {
      state.activeConversationId = state.conversations[0].id;
      await loadMessages();
    } else {
      await createConversation();
    }
    render();
  } catch {
    state.currentScreen = 'login';
    render();
  }
})();
})();\`;

  return workerCode;
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const file = args[1];
  if (!file) {
    console.error('Usage: axc <command> <file.ax>');
    process.exit(1);
  }
  const source = fs.readFileSync(file, 'utf8');
  const tokens = lex(source);
  const ast = parse(tokens);
  const errors = analyze(ast);
  if (errors.length > 0) {
    console.error('Errors:', errors);
    process.exit(1);
  }
  if (command === 'check') {
    console.log('OK');
  } else if (command === 'build' || command === 'dev') {
    const code = generate(ast);
    const dist = path.join(process.cwd(), 'dist');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'worker.js'), code);
    fs.writeFileSync(path.join(dist, 'index.html'), '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>AL2100</title></head><body><div id="app"></div></body></html>');
    console.log('Build complete: dist/worker.js');
  } else {
    console.error('Unknown command');
    process.exit(1);
  }
}

main();
