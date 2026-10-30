#!/usr/bin/env node
'use strict';

/**
 * AXCode Compiler v4.1.0 — Production
 * Poprawki krytyczne:
 *  - Kolejność generowania (HTML przed Workerem) → koniec z białą stroną
 *  - Pełniejsze API w Workerze
 *  - Znacznie lepszy frontend (prawdziwy SPA shell)
 *  - Stabilny parser, analyzer i generator
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const VERSION = '4.1.0';
const ROOT = process.cwd();

// ─────────────────────────────────────────────────────────────
// Error
// ─────────────────────────────────────────────────────────────
class AxcError extends Error {
  constructor(msg, line = 0, col = 0, hint = '', code = 'AXC_ERROR') {
    super(msg);
    this.line = line;
    this.col = col;
    this.hint = hint;
    this.code = code;
  }
  format() {
    const loc = this.line ? `${this.line}:${this.col} ` : '';
    return `[${this.code}] ${loc}${this.message}${this.hint ? '\n   hint: ' + this.hint : ''}`;
  }
}

// ─────────────────────────────────────────────────────────────
// Tokens
// ─────────────────────────────────────────────────────────────
const T = Object.freeze({
  IDENT: 'IDENT', STRING: 'STRING', TEMPLATE: 'TEMPLATE', NUMBER: 'NUMBER',
  COLOR: 'COLOR', DATE: 'DATE', DATETIME: 'DATETIME', DURATION: 'DURATION',
  LITERAL: 'LITERAL',
  LBRACE: 'LBRACE', RBRACE: 'RBRACE', LBRACKET: 'LBRACKET', RBRACKET: 'RBRACKET',
  LPAREN: 'LPAREN', RPAREN: 'RPAREN', COLON: 'COLON', COMMA: 'COMMA', SEMI: 'SEMI',
  DOT: 'DOT', QUESTION: 'QUESTION', PIPE: 'PIPE', AT: 'AT',
  ARROW: 'ARROW', ASSIGN: 'ASSIGN', PLUS_ASSIGN: 'PLUS_ASSIGN', MINUS_ASSIGN: 'MINUS_ASSIGN',
  EQ: 'EQ', NEQ: 'NEQ', LT: 'LT', GT: 'GT', LTE: 'LTE', GTE: 'GTE',
  AND: 'AND', OR: 'OR', NOT: 'NOT', PLUS: 'PLUS', MINUS: 'MINUS', STAR: 'STAR',
  SLASH: 'SLASH', PERCENT: 'PERCENT', DOTDOT: 'DOTDOT', DOUBLECOLON: 'DOUBLECOLON',
  EOF: 'EOF'
});

// ─────────────────────────────────────────────────────────────
// Lexer
// ─────────────────────────────────────────────────────────────
class Lexer {
  constructor(src) {
    this.src = src;
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.tokens = [];
    this.errors = [];
  }

  advance() {
    const c = this.src[this.pos++];
    if (c === '\n') { this.line++; this.col = 1; } else { this.col++; }
    return c;
  }

  peek(k = 0) { return this.src[this.pos + k]; }
  atEnd() { return this.pos >= this.src.length; }

  skipWs() {
    while (!this.atEnd()) {
      const c = this.peek();
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { this.advance(); continue; }
      if (c === '/' && this.peek(1) === '/') {
        while (!this.atEnd() && this.peek() !== '\n') this.advance();
        continue;
      }
      if (c === '/' && this.peek(1) === '*') {
        this.advance(); this.advance();
        while (!this.atEnd() && !(this.peek() === '*' && this.peek(1) === '/')) this.advance();
        if (!this.atEnd()) { this.advance(); this.advance(); }
        continue;
      }
      break;
    }
  }

  readQuoted(q) {
    let s = '';
    this.advance();
    while (!this.atEnd()) {
      const c = this.peek();
      if (c === '\\') {
        this.advance();
        const e = this.advance();
        s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
        continue;
      }
      if (c === q) { this.advance(); break; }
      s += this.advance();
    }
    return s;
  }

  readIdent() {
    let s = '';
    while (!this.atEnd()) {
      const c = this.peek();
      if (/[a-zA-Z0-9_\-.$]/.test(c)) s += this.advance();
      else break;
    }
    return s;
  }

  tokenize() {
    while (true) {
      this.skipWs();
      if (this.atEnd()) {
        this.tokens.push({ type: T.EOF, value: '', line: this.line, col: this.col });
        break;
      }
      const line = this.line, col = this.col, c = this.peek();

      if (c === '"' || c === "'") {
        this.tokens.push({ type: T.STRING, value: this.readQuoted(c), line, col });
        continue;
      }
      if (c === '`') {
        this.tokens.push({ type: T.TEMPLATE, value: this.readQuoted(c), line, col });
        continue;
      }
      if (c === '#' && /[0-9A-Fa-f]/.test(this.peek(1) || '')) {
        let s = '#';
        this.advance();
        while (!this.atEnd() && /[0-9A-Fa-f]/.test(this.peek())) s += this.advance();
        this.tokens.push({ type: T.COLOR, value: s, line, col });
        continue;
      }

      const dm = this.src.slice(this.pos).match(/^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?/);
      if (dm) {
        for (let i = 0; i < dm[0].length; i++) this.advance();
        this.tokens.push({ type: dm[2] ? T.DATETIME : T.DATE, value: dm[0], line, col });
        continue;
      }

      if (/[0-9]/.test(c)) {
        const durM = this.src.slice(this.pos).match(/^(\d+)(ms|m|h|d|w)(?=\s|$|\})/);
        if (durM) {
          for (let i = 0; i < durM[0].length; i++) this.advance();
          this.tokens.push({ type: T.DURATION, value: durM[0], line, col });
          continue;
        }
        let s = '';
        while (!this.atEnd() && /[0-9._]/.test(this.peek())) s += this.advance();
        this.tokens.push({ type: T.NUMBER, value: s, line, col });
        continue;
      }

      if (/[a-zA-Z_$]/.test(c)) {
        const v = this.readIdent();
        if (v === 'true' || v === 'false' || v === 'null' || v === 'undefined') {
          this.tokens.push({ type: T.LITERAL, value: v, line, col });
        } else {
          this.tokens.push({ type: T.IDENT, value: v, line, col });
        }
        continue;
      }

      const two = this.src.slice(this.pos, this.pos + 2);
      const twoMap = {
        '=>': T.ARROW, '==': T.EQ, '!=': T.NEQ, '<=': T.LTE, '>=': T.GTE,
        '&&': T.AND, '||': T.OR, '+=': T.PLUS_ASSIGN, '-=': T.MINUS_ASSIGN,
        '..': T.DOTDOT, '::': T.DOUBLECOLON
      };
      if (twoMap[two]) {
        this.advance(); this.advance();
        this.tokens.push({ type: twoMap[two], value: two, line, col });
        continue;
      }

      const singles = {
        '{': T.LBRACE, '}': T.RBRACE, '[': T.LBRACKET, ']': T.RBRACKET,
        '(': T.LPAREN, ')': T.RPAREN, ':': T.COLON, ',': T.COMMA, ';': T.SEMI,
        '.': T.DOT, '?': T.QUESTION, '|': T.PIPE, '@': T.AT, '=': T.ASSIGN,
        '<': T.LT, '>': T.GT, '!': T.NOT, '+': T.PLUS, '-': T.MINUS,
        '*': T.STAR, '/': T.SLASH, '%': T.PERCENT
      };
      if (singles[c]) {
        this.advance();
        this.tokens.push({ type: singles[c], value: c, line, col });
        continue;
      }

      this.errors.push(new AxcError(`Nieoczekiwany znak: ${JSON.stringify(c)}`, line, col, 'Może brakuje cudzysłowu lub nawiasu', 'AXC_LEX'));
      this.advance();
    }
    return this.tokens;
  }
}

// ─────────────────────────────────────────────────────────────
// Parser
// ─────────────────────────────────────────────────────────────
class Block {
  constructor(name, label, params, body, startLine) {
    this.name = name;
    this.label = label || '';
    this.params = params || [];
    this.body = body;
    this.startLine = startLine;
  }
}

class Parser {
  constructor(tokens, src) {
    this.tokens = tokens;
    this.src = src;
    this.pos = 0;
    this.errors = [];
    this.warnings = [];
  }

  peek(k = 0) { return this.tokens[this.pos + k] || this.tokens[this.tokens.length - 1]; }
  next() { return this.tokens[this.pos++]; }
  atEnd() { return this.peek().type === T.EOF; }

  expect(type, msg) {
    if (this.peek().type !== type) {
      const t = this.peek();
      this.errors.push(new AxcError(msg || `Oczekiwano ${type}, otrzymano ${t.type}`, t.line, t.col, '', 'AXC_PARSE'));
      return { type: T.EOF, value: '', line: t.line, col: t.col };
    }
    return this.next();
  }

  captureBlock() {
    if (this.peek().type !== T.LBRACE) return '';
    const startTok = this.peek();
    let depth = 0, end = this.pos;
    for (let i = this.pos; i < this.tokens.length; i++) {
      if (this.tokens[i].type === T.LBRACE) depth++;
      else if (this.tokens[i].type === T.RBRACE) {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (depth !== 0) {
      this.errors.push(new AxcError('Niedomknięty blok', startTok.line, startTok.col, 'Dodaj brakujący }', 'AXC_UNCLOSED'));
    }
    const inner = this.tokensText(this.pos + 1, end);
    this.pos = end + 1;
    return inner;
  }

  tokensText(start, end) {
    let out = '', prevLine = -1, prevType = null;
    const NO_SPACE_BEFORE = new Set([T.RPAREN, T.RBRACKET, T.RBRACE, T.COMMA, T.SEMI, T.COLON, T.DOT]);
    const NO_SPACE_AFTER = new Set([T.LPAREN, T.LBRACKET, T.LBRACE, T.DOT]);
    for (let i = start; i < end; i++) {
      const t = this.tokens[i];
      if (t.type === T.EOF) break;
      if (t.line > prevLine + 1 && prevLine !== -1) out += '\n';
      else if (t.line > prevLine && prevLine !== -1 && !NO_SPACE_AFTER.has(prevType) && !NO_SPACE_BEFORE.has(t.type)) out += ' ';
      if (out.length && !out.endsWith('\n') && !out.endsWith(' ') && !NO_SPACE_BEFORE.has(t.type) && !NO_SPACE_AFTER.has(prevType)) out += ' ';
      out += this.render(t);
      prevLine = t.line;
      prevType = t.type;
    }
    return out;
  }

  render(t) {
    if (t.type === T.STRING) return JSON.stringify(t.value);
    if (t.type === T.TEMPLATE) return '`' + t.value.replace(/`/g, '\\`') + '`';
    if (t.type === T.COLOR) return `'${t.value}'`;
    if (t.type === T.DATE || t.type === T.DATETIME) return `'${t.value}'`;
    if (t.type === T.DURATION) return `'${t.value}'`;
    return t.value;
  }

  parseBlockHeader() {
    const nameTok = this.expect(T.IDENT, 'Oczekiwano nazwy bloku');
    const block = { name: nameTok.value, label: '', params: [], startLine: nameTok.line };
    if (this.peek().type === T.STRING) {
      block.label = this.next().value;
    } else if (this.peek().type === T.IDENT && this.tokens[this.pos + 1] && !['{', ':'].includes(this.tokens[this.pos + 1].type)) {
      block.label = this.next().value;
    }
    if (this.peek().type === T.LPAREN) {
      this.next();
      while (this.peek().type !== T.RPAREN && !this.atEnd()) {
        if (this.peek().type === T.IDENT) block.params.push(this.next().value);
        else this.next();
      }
      this.expect(T.RPAREN);
    }
    return block;
  }

  parseFile() {
    const blocks = [];
    while (!this.atEnd()) {
      const t = this.peek();
      if (t.type === T.EOF) break;
      if (t.type !== T.IDENT) { this.next(); continue; }
      try {
        const header = this.parseBlockHeader();
        const body = this.captureBlock();
        blocks.push(new Block(header.name, header.label, header.params, body, header.startLine));
      } catch (e) {
        this.errors.push(e instanceof AxcError ? e : new AxcError(e.message, t.line, t.col, '', 'AXC_BLOCK'));
        this.next();
      }
    }
    return blocks;
  }
}

// ─────────────────────────────────────────────────────────────
// Merger
// ─────────────────────────────────────────────────────────────
class Merger {
  static empty() {
    return {
      app: null,
      theme: { colors: {}, typography: {}, shape: {}, motion: {}, spacing: {}, mode: 'dark', raw: '' },
      permissions: {},
      sync: {},
      ai: { providers: {}, routing: {}, limits: {}, safety: {}, raw: '' },
      state: { fields: {}, computed: {}, events: {}, onStart: '', onStop: '', raw: '' },
      storage: { models: {}, indexes: [], file: '' },
      components: {},
      screens: {},
      logic: { functions: [], events: [], onStart: [], onStop: [] },
      flows: [],
      apis: [],
      queues: [],
      crons: [],
      worker: null,
      agents: {},
      search: {},
      github: {},
      cloudflare: {},
      security: {},
      assets: {},
      client: {},
      meta: {},
      ui: {},
      sitemap: {},
      customs: {},
      customList: [],
      order: []
    };
  }

  static merge(blocks) {
    const ast = this.empty();
    for (const b of blocks) {
      const name = b.name.toLowerCase();
      ast.order.push(name);
      try { this.mergeOne(ast, b, name); }
      catch (e) { ast.customList.push({ name: b.name, error: e.message, body: b.body }); }
    }
    return ast;
  }

  static mergeOne(ast, b, name) {
    if (name === 'app') { ast.app = this.parseApp(b); return; }
    if (name === 'theme') { this.mergeTheme(ast.theme, b.body); return; }
    if (name === 'permissions') { Object.assign(ast.permissions, this.parsePermissions(b.body)); return; }
    if (name === 'sync') { Object.assign(ast.sync, this.parseFlatMap(b.body)); return; }
    if (name === 'ai') { this.mergeAi(ast.ai, b.body); return; }
    if (name === 'state') { this.mergeState(ast.state, b.body); return; }
    if (name === 'storage') { this.mergeStorage(ast.storage, b); return; }
    if (name === 'component') {
      ast.components[b.label || 'Component_' + b.startLine] = { name: b.label, params: b.params, body: b.body };
      return;
    }
    if (name === 'screen') {
      ast.screens[b.label || 'Screen_' + b.startLine] = { name: b.label, body: b.body, title: this.extractTitle(b.body) };
      return;
    }
    if (name === 'logic') { this.mergeLogic(ast.logic, b.body); return; }
    if (name === 'flow') { ast.flows.push({ label: b.label || 'Flow', body: b.body }); return; }
    if (name === 'api') { ast.apis.push({ body: b.body }); return; }
    if (name === 'queue') { ast.queues.push({ body: b.body, label: b.label || '' }); return; }
    if (name === 'cron') { ast.crons.push({ body: b.body, label: b.label || '' }); return; }
    if (name === 'worker') { ast.worker = { body: b.body, label: b.label || '' }; return; }
    if (['agents', 'search', 'github', 'cloudflare', 'security', 'assets', 'client', 'meta', 'ui', 'sitemap'].includes(name)) {
      ast[name] = Object.assign(ast[name] || {}, this.parseFlatMap(b.body));
      ast[name]._raw = (ast[name]._raw || '') + '\n' + b.body;
      return;
    }
    if (!ast.customs[name]) ast.customs[name] = [];
    ast.customs[name].push({ label: b.label, body: b.body });
  }

  static parseApp(b) {
    const app = {
      name: b.label || 'App',
      id: 'app',
      version: '1.0.0',
      author: '',
      theme: 'dark',
      accent: 'neon-cyan',
      offline: false,
      language: ['pl']
    };
    for (const line of b.body.split('\n')) {
      const m = line.trim().match(/^(\w+)\s+(.+)$/);
      if (!m) continue;
      const [, k, v] = m;
      if (v === 'true') app[k] = true;
      else if (v === 'false') app[k] = false;
      else if (/^-?\d+$/.test(v)) app[k] = parseInt(v, 10);
      else if (v.startsWith('[') && v.endsWith(']')) {
        try { app[k] = JSON.parse(v.replace(/'/g, '"')); } catch { app[k] = v; }
      } else app[k] = v.replace(/^"|"$/g, '');
    }
    return app;
  }

  static parseFlatMap(body) {
    const out = {};
    let depth = 0, buf = '', currentKey = null;
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const openM = trimmed.match(/^(\w+)(?:\s+(.+?))?\s*\{$/);
      if (openM && !currentKey) { currentKey = openM[1]; buf = ''; depth = 1; continue; }
      if (currentKey) {
        depth += (trimmed.match(/\{/g) || []).length;
        depth -= (trimmed.match(/\}/g) || []).length;
        if (depth > 0) { buf += line + '\n'; continue; }
        out[currentKey] = buf.trim();
        currentKey = null;
        continue;
      }
      const kv = trimmed.match(/^([\w.]+)\s+(.+)$/);
      if (kv) {
        let v = kv[2].trim();
        if (v === 'true') v = true;
        else if (v === 'false') v = false;
        else if (/^-?\d+(\.\d+)?$/.test(v)) v = parseFloat(v);
        else if (v.startsWith('[') && v.endsWith(']')) {
          try { v = JSON.parse(v.replace(/'/g, '"')); } catch {}
        } else v = v.replace(/^"|"$/g, '');
        out[kv[1]] = v;
      }
    }
    return out;
  }

  static parsePermissions(body) {
    const perms = {};
    for (const line of body.split('\n')) {
      const m = line.trim().match(/^([\w.]+):\s*(\w+)(?:\s+reason\s+"([^"]*)")?/);
      if (m) perms[m[1]] = { level: m[2], reason: m[3] || '' };
    }
    return perms;
  }

  static mergeTheme(theme, body) {
    theme.raw += '\n' + body;
    let currentSection = null, depth = 0;
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const openM = trimmed.match(/^(\w+)\s*\{$/);
      if (openM) {
        currentSection = openM[1];
        depth++;
        if (!theme[currentSection]) theme[currentSection] = {};
        continue;
      }
      if (trimmed === '}') { depth--; if (depth === 0) currentSection = null; continue; }
      if (!currentSection) continue;
      const kv = trimmed.match(/^([\w.]+)\s+(.+)$/);
      if (kv) theme[currentSection][kv[1]] = kv[2].trim().replace(/^"|"$/g, '');
    }
  }

  static mergeAi(ai, body) {
    ai.raw += '\n' + body;
    const provRe = /(\w+)\s*\{([\s\S]*?)\n\s{2,4}\}/g;
    let m;
    while ((m = provRe.exec(body))) {
      const name = m[1], provBody = m[2];
      if (['providers', 'routing', 'limits', 'safety'].includes(name)) continue;
      if (!ai.providers[name]) ai.providers[name] = {};
      const baseUrlM = provBody.match(/baseUrl\s+"([^"]+)"/);
      const modelsM = provBody.match(/models\s*\[([^\]]+)\]/);
      const defaultModelM = provBody.match(/defaultModel\s+"([^"]+)"/);
      if (baseUrlM) ai.providers[name].baseUrl = baseUrlM[1];
      if (modelsM) ai.providers[name].models = modelsM[1].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      if (defaultModelM) ai.providers[name].defaultModel = defaultModelM[1];
    }
    const limitsRe = /limits\s*\{([\s\S]*?)\}/;
    const lm = body.match(limitsRe);
    if (lm) {
      for (const line of lm[1].split('\n')) {
        const kv = line.trim().match(/^(\w+)\s+(.+)$/);
        if (kv) {
          let v = kv[2].trim().replace(/^"|"$/g, '');
          if (/^\d+$/.test(v)) v = parseInt(v, 10);
          else if (/^\d+\.\d+$/.test(v)) v = parseFloat(v);
          ai.limits[kv[1]] = v;
        }
      }
    }
    const safetyRe = /safety\s*\{([\s\S]*?)\}/;
    const sm = body.match(safetyRe);
    if (sm) {
      for (const line of sm[1].split('\n')) {
        const kv = line.trim().match(/^(\w+)\s+(true|false)$/);
        if (kv) ai.safety[kv[1]] = kv[2] === 'true';
      }
    }
    ai.limits = {
      maxTokensPerRequest: 32000,
      maxTokensPerConversation: 200000,
      maxDailyCost: 5.0,
      maxConcurrentGenerations: 1,
      maxAgentSteps: 24,
      maxAgentSeconds: 180,
      ...ai.limits
    };
    ai.safety = {
      confirmBeforeDelete: true,
      confirmBeforeDeploy: true,
      confirmBeforePush: true,
      confirmBeforeExternalCall: true,
      hideSecrets: true,
      redactLogs: true,
      blockUnknownProviders: true,
      ...ai.safety
    };
  }

  static mergeState(state, body) {
    state.raw += '\n' + body;
    let currentBlock = null, currentName = null, depth = 0, buf = '';
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const computedM = trimmed.match(/^computed\s+(\w+)\s*\{$/);
      const eventM = trimmed.match(/^event\s+([\w.]+)\s+(\w+)\s*\{$/);
      const onStartM = trimmed.match(/^onStart\s*\{$/);
      const onStopM = trimmed.match(/^onStop\s*\{$/);
      if (computedM) { currentBlock = 'computed'; currentName = computedM[1]; depth = 1; buf = ''; continue; }
      if (eventM) { currentBlock = 'event'; currentName = eventM[1] + ':' + eventM[2]; depth = 1; buf = ''; continue; }
      if (onStartM) { currentBlock = 'onStart'; currentName = 'onStart'; depth = 1; buf = ''; continue; }
      if (onStopM) { currentBlock = 'onStop'; currentName = 'onStop'; depth = 1; buf = ''; continue; }
      if (currentBlock) {
        depth += (trimmed.match(/\{/g) || []).length;
        depth -= (trimmed.match(/\}/g) || []).length;
        if (depth > 0) { buf += line + '\n'; continue; }
        if (currentBlock === 'computed') state.computed[currentName] = buf.trim();
        else if (currentBlock === 'event') state.events[currentName] = buf.trim();
        else if (currentBlock === 'onStart') state.onStart += '\n' + buf;
        else if (currentBlock === 'onStop') state.onStop += '\n' + buf;
        currentBlock = null;
        currentName = null;
        buf = '';
        continue;
      }
      const fieldM = trimmed.match(/^([\w.]+)\s*=\s*(.+)$/);
      if (fieldM) state.fields[fieldM[1]] = fieldM[2].trim();
    }
  }

  static mergeStorage(storage, b) {
    if (b.label) storage.file = b.label;
    const body = b.body;
    const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\s{2,4}\}/g;
    let m;
    while ((m = modelRe.exec(body))) {
      const name = m[1], mbody = m[2];
      const fields = [];
      for (const line of mbody.split('\n')) {
        const fm = line.trim().match(/^(\w+)\s+(.+)$/);
        if (fm) fields.push(this.parseField(fm[1], fm[2]));
      }
      storage.models[name] = fields;
    }
    const idxRe = /index\s+([\w.]+)/g;
    while ((m = idxRe.exec(body))) {
      const parts = m[1].split('.');
      storage.indexes.push({ model: parts[0], field: parts[1] });
    }
  }

  static parseField(name, def) {
    def = def.trim();
    const optional = /\boptional\b/.test(def);
    const auto = /\bauto\b/.test(def);
    let type = 'text', values = null;
    if (/\benum\s*\[/.test(def)) {
      const em = def.match(/enum\s*\[([^\]]*)\]/);
      values = em[1].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      type = 'enum';
    } else if (/\bjson\b/.test(def)) type = 'json';
    else if (/\bdatetime\b/.test(def)) type = 'datetime';
    else if (/\bdate\b/.test(def)) type = 'date';
    else if (/\bnumber\b/.test(def)) type = 'number';
    else if (/\bbool\b/.test(def)) type = 'bool';
    return { name, type, values, optional, auto };
  }

  static mergeLogic(logic, body) {
    let currentBlock = null, currentName = null, currentParams = [], depth = 0, buf = '';
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) { if (currentBlock) buf += '\n'; continue; }
      if (!currentBlock) {
        const fnM = trimmed.match(/^function\s+(\w+)\s*\(([^)]*)\)\s*\{$/);
        const eventM = trimmed.match(/^event\s+([\w.]+)\s+(\w+)\s*\{$/);
        const onStartM = trimmed.match(/^onStart\s*\{$/);
        const onStopM = trimmed.match(/^onStop\s*\{$/);
        if (fnM) {
          currentBlock = 'function';
          currentName = fnM[1];
          currentParams = fnM[2].split(',').map(s => s.trim()).filter(Boolean);
          depth = 1; buf = '';
          continue;
        }
        if (eventM) { currentBlock = 'event'; currentName = eventM[1] + ':' + eventM[2]; depth = 1; buf = ''; continue; }
        if (onStartM) { currentBlock = 'onStart'; currentName = 'onStart'; depth = 1; buf = ''; continue; }
        if (onStopM) { currentBlock = 'onStop'; currentName = 'onStop'; depth = 1; buf = ''; continue; }
        continue;
      }
      depth += (trimmed.match(/\{/g) || []).length;
      depth -= (trimmed.match(/\}/g) || []).length;
      if (depth > 0) { buf += line + '\n'; continue; }
      if (currentBlock === 'function') logic.functions.push({ name: currentName, params: currentParams, body: buf.trim() });
      else if (currentBlock === 'event') logic.events.push({ target: currentName, body: buf.trim() });
      else if (currentBlock === 'onStart') logic.onStart.push({ body: buf.trim() });
      else if (currentBlock === 'onStop') logic.onStop.push({ body: buf.trim() });
      currentBlock = null;
      currentName = null;
      currentParams = [];
      buf = '';
    }
  }

  static extractTitle(body) {
    const m = body.match(/title\s+"([^"]*)"/);
    return m ? m[1] : '';
  }
}

// ─────────────────────────────────────────────────────────────
// Analyzer
// ─────────────────────────────────────────────────────────────
class Analyzer {
  static analyze(ast) {
    const errors = [], warnings = [];
    if (!ast.app) errors.push(new AxcError('Brak sekcji app', 0, 0, 'Dodaj: app "Nazwa" { ... }', 'AXC_NO_APP'));
    if (ast.app && !ast.app.id) warnings.push('Brak app.id — ustaw id "pl.twoja.app"');
    if (!ast.storage || Object.keys(ast.storage.models).length === 0) {
      warnings.push('Brak modeli w storage — aplikacja nie będzie miała bazy');
    }
    for (const [name, fields] of Object.entries(ast.storage.models || {})) {
      if (!fields.some(f => f.name === 'id')) {
        errors.push(new AxcError(`Model ${name} nie ma pola id`, 0, 0, 'Dodaj: id auto', 'AXC_NO_ID'));
      }
    }
    for (const idx of ast.storage.indexes || []) {
      if (!ast.storage.models[idx.model]) {
        errors.push(new AxcError(`Indeks na nieistniejącym modelu: ${idx.model}`, 0, 0, '', 'AXC_BAD_IDX'));
      } else if (!ast.storage.models[idx.model].some(f => f.name === idx.field)) {
        errors.push(new AxcError(`Indeks na nieistniejącym polu: ${idx.model}.${idx.field}`, 0, 0, '', 'AXC_BAD_IDX'));
      }
    }
    if (!Object.keys(ast.screens).length) warnings.push('Brak ekranów — aplikacja będzie pusta');
    if (!Object.keys(ast.ai.providers).length) warnings.push('Brak providerów AI w ai.providers');
    for (const [name, c] of Object.entries(ast.components)) {
      if (!c.body.trim()) warnings.push(`Komponent ${name} ma puste ciało`);
    }
    for (const fn of ast.logic.functions) {
      if (!fn.body.trim()) warnings.push(`Funkcja ${fn.name} ma puste ciało`);
    }
    const screenNames = new Set(Object.keys(ast.screens));
    for (const f of ast.flows) {
      const refs = f.body.match(/\b([A-Z][a-zA-Z0-9]*)\b/g) || [];
      for (const r of refs) {
        if (!screenNames.has(r) && !['start', 'when', '=>'].includes(r)) {
          warnings.push(`Flow odwołuje się do nieistniejącego ekranu: ${r}`);
        }
      }
    }
    return { errors, warnings };
  }
}

// ─────────────────────────────────────────────────────────────
// Generator
// ─────────────────────────────────────────────────────────────
class Generator {
  constructor(ast) {
    this.ast = ast;
    this.files = {};
  }

  generate(outDir) {
    // Kolejność krytyczna: najpierw frontend + HTML, dopiero potem Worker
    this.genMigrations();
    this.genFrontend();
    this.genCSS();
    this.genAssets();
    this.genHTML();          // ← index.html powstaje tutaj
    this.genWorker();        // ← Worker bierze już gotowy INDEX_HTML
    this.genWrangler();
    this.genPackageJson();
    this.genReadme();

    const written = [];
    for (const [rel, content] of Object.entries(this.files)) {
      const full = path.join(outDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
      written.push(rel);
    }
    return written;
  }

  // ─── Worker ────────────────────────────────────────────────
  genWorker() {
    const appName = (this.ast.app && this.ast.app.name) || 'AL2100';
    const appId = (this.ast.app && this.ast.app.id) || 'pl.axel.al2100';
    const indexHtml = this.files['index.html'] || '<!DOCTYPE html><html><body><h1>AL2100 — błąd generowania HTML</h1></body></html>';

    const worker = `'use strict';
const VERSION = ${JSON.stringify(VERSION)};
const APP_NAME = ${JSON.stringify(appName)};
const APP_ID = ${JSON.stringify(appId)};
const INDEX_HTML = ${JSON.stringify(indexHtml)};

// ── helpers ──────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS'
    }
  });
}

function addDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function dbQueryAll(env, sql, params = []) {
  try {
    const stmt = env.AL_DB.prepare(sql);
    const res = params.length ? await stmt.bind(...params).all() : await stmt.all();
    return res.results || [];
  } catch (e) {
    console.error('dbQueryAll', e);
    return [];
  }
}

async function dbQueryOne(env, sql, params = []) {
  try {
    const stmt = env.AL_DB.prepare(sql);
    return params.length ? await stmt.bind(...params).first() : await stmt.first();
  } catch (e) {
    console.error('dbQueryOne', e);
    return null;
  }
}

async function dbInsert(env, table, data) {
  const keys = Object.keys(data);
  const placeholders = keys.map(() => '?').join(',');
  const sql = \`INSERT INTO \${table} (\${keys.join(',')}) VALUES (\${placeholders})\`;
  await env.AL_DB.prepare(sql).bind(...keys.map(k => data[k])).run();
  return data;
}

async function dbUpdate(env, table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return data;
  const sets = keys.map(k => \`\${k} = ?\`).join(',');
  const sql = \`UPDATE \${table} SET \${sets} WHERE id = ?\`;
  await env.AL_DB.prepare(sql).bind(...keys.map(k => data[k]), id).run();
  return data;
}

async function cacheGet(env, key) {
  if (!env.AL_KV) return null;
  return await env.AL_KV.get(key);
}

async function cacheSet(env, key, value, ttl = 3600) {
  if (!env.AL_KV) return;
  await env.AL_KV.put(key, typeof value === 'string' ? value : JSON.stringify(value), { expirationTtl: ttl });
}

async function cacheIncr(env, key, windowSec = 60) {
  if (!env.AL_KV) return 1;
  const cur = parseInt(await env.AL_KV.get(key) || '0', 10);
  const next = cur + 1;
  await env.AL_KV.put(key, String(next), { expirationTtl: windowSec });
  return next;
}

async function hashIp(env, ip) {
  const key = env.AL_MASTER_ENCRYPTION_KEY || 'fallback-dev-key-change-me';
  const data = new TextEncoder().encode(ip + '::' + key);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function encryptSecret(env, plain) {
  const keyMaterial = (env.AL_MASTER_ENCRYPTION_KEY || 'fallback-dev-key-change-me-32chars!!').slice(0, 32);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(keyMaterial), { name: 'AES-GCM' }, false, ['encrypt']);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(plain));
  return {
    cipher: btoa(String.fromCharCode(...new Uint8Array(cipher))),
    nonce: Array.from(nonce).map(b => b.toString(16).padStart(2, '0')).join(''),
    version: 1
  };
}

async function decryptSecret(env, cipherObj) {
  if (typeof cipherObj === 'string') {
    try { cipherObj = JSON.parse(cipherObj); } catch { return ''; }
  }
  if (!cipherObj || !cipherObj.cipher || !cipherObj.nonce) return '';
  const keyMaterial = (env.AL_MASTER_ENCRYPTION_KEY || 'fallback-dev-key-change-me-32chars!!').slice(0, 32);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(keyMaterial), { name: 'AES-GCM' }, false, ['decrypt']);
  const nonce = new Uint8Array(cipherObj.nonce.match(/.{1,2}/g).map(b => parseInt(b, 16)));
  const cipher = Uint8Array.from(atob(cipherObj.cipher), c => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher);
  return new TextDecoder().decode(plain);
}

function maskSecret(plain) {
  if (!plain || plain.length <= 6) return '••••••';
  return plain.substring(0, 3) + '••••••' + plain.substring(plain.length - 3);
}

async function rateCheck(env, userId, bucket, limit = 60) {
  const key = 'rate:' + bucket + ':' + userId;
  const count = await cacheIncr(env, key, 60);
  if (count > limit) throw new Error('rate_limit_exceeded');
  return true;
}

async function audit(env, userId, action, resource, resourceId, result, metadata) {
  try {
    await dbInsert(env, 'AuditLog', {
      id: 'aud-' + crypto.randomUUID(),
      user_id: userId || null,
      action,
      resource,
      resource_id: resourceId || null,
      result,
      metadata: JSON.stringify(metadata || {}),
      created_at: new Date().toISOString()
    });
  } catch (e) {}
}

async function getSession(env, request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(/al_session=([^;]+)/);
  if (!m) return null;
  const sessionId = m[1];
  const row = await dbQueryOne(env, 'SELECT * FROM Session WHERE id = ? AND revoked_at IS NULL AND expires_at > ?', [sessionId, new Date().toISOString()]);
  if (!row) return null;
  const user = await dbQueryOne(env, 'SELECT * FROM User WHERE id = ?', [row.user_id]);
  return { session: row, user };
}

// ── API router ───────────────────────────────────────────────
async function handleApi(request, env, ctx, url) {
  const method = request.method;
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token'
      }
    });
  }

  const path = url.pathname;
  const sessionData = await getSession(env, request);
  const user = sessionData ? sessionData.user : null;
  const session = sessionData ? sessionData.session : null;

  // Health
  if (path === '/api/health') {
    return json({ ok: true, status: 'ok', version: VERSION, time: new Date().toISOString(), app: APP_NAME });
  }

  // Session
  if (path === '/api/session' && method === 'GET') {
    if (!user) return json({ ok: false }, 401);
    return json({
      ok: true,
      body: {
        sessionId: session.id,
        csrfToken: session.csrf_token,
        expiresAt: session.expires_at,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatar_url,
          provider: user.provider
        }
      }
    });
  }

  if (path === '/api/logout' && method === 'POST') {
    if (session) await dbUpdate(env, 'Session', session.id, { revoked_at: new Date().toISOString() });
    return json({ ok: true });
  }

  // Public auth endpoints (simplified for now)
  if (path === '/api/auth/demo' && method === 'POST') {
    // Demo login – tworzy użytkownika i sesję
    const body = await request.json().catch(() => ({}));
    const email = body.email || 'demo@al2100.local';
    let u = await dbQueryOne(env, 'SELECT * FROM User WHERE email = ?', [email]);
    if (!u) {
      const id = 'usr-' + crypto.randomUUID();
      const now = new Date().toISOString();
      await dbInsert(env, 'User', {
        id, provider: 'demo', provider_user_id: id, email, name: body.name || 'Demo User',
        avatar_url: '', locale: 'pl', created_at: now, updated_at: now, last_login_at: now
      });
      u = await dbQueryOne(env, 'SELECT * FROM User WHERE id = ?', [id]);
    }
    const sid = 'ses-' + crypto.randomUUID();
    const csrf = crypto.randomUUID();
    const expires = addDays(new Date().toISOString(), 14);
    await dbInsert(env, 'Session', {
      id: sid, user_id: u.id, csrf_token: csrf, ip_hash: '', user_agent: request.headers.get('User-Agent') || '',
      created_at: new Date().toISOString(), expires_at: expires, revoked_at: null, provider: 'demo'
    });
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Set-Cookie': \`al_session=\${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1209600\`
    });
    return new Response(JSON.stringify({ ok: true, body: { sessionId: sid, csrfToken: csrf, user: u } }), { status: 200, headers });
  }

  // Wszystkie pozostałe /api/* wymagają sesji
  if (path.startsWith('/api/') && !user && !path.startsWith('/api/auth')) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  // Conversations
  if (path === '/api/conversations' && method === 'GET') {
    const items = await dbQueryAll(env, 'SELECT * FROM Conversation WHERE user_id = ? ORDER BY last_message_at DESC LIMIT 100', [user.id]);
    return json({ ok: true, body: { items } });
  }

  if (path === '/api/conversations' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const id = 'conv-' + crypto.randomUUID();
    const now = new Date().toISOString();
    await dbInsert(env, 'Conversation', {
      id, user_id: user.id, title: body.title || 'Nowa rozmowa',
      archived: 0, private_mode: body.private_mode ? 1 : 0,
      web_search: body.web_search !== false ? 1 : 0,
      created_at: now, updated_at: now, last_message_at: now, tokens_used: 0
    });
    await audit(env, user.id, 'conversation.create', 'Conversation', id, 'success', {});
    return json({ ok: true, body: { id, title: body.title || 'Nowa rozmowa', created_at: now } });
  }

  if (path.match(/^\\/api\\/conversations\\/[^/]+$/) && method === 'GET') {
    const id = path.split('/').pop();
    const conv = await dbQueryOne(env, 'SELECT * FROM Conversation WHERE id = ? AND user_id = ?', [id, user.id]);
    if (!conv) return json({ ok: false }, 404);
    return json({ ok: true, body: conv });
  }

  if (path.match(/^\\/api\\/conversations\\/[^/]+\\/messages$/) && method === 'GET') {
    const id = path.split('/')[3];
    const items = await dbQueryAll(env, 'SELECT * FROM Message WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 500', [id]);
    return json({ ok: true, body: { items } });
  }

  // Simple chat endpoint (non-streaming for reliability)
  if (path === '/api/chat/send' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const convId = body.conversation_id;
    if (!convId) return json({ ok: false, error: 'missing_conversation' }, 400);

    const now = new Date().toISOString();
    const userMsgId = 'msg-' + crypto.randomUUID();
    await dbInsert(env, 'Message', {
      id: userMsgId, conversation_id: convId, user_id: user.id,
      role: 'user', content: body.content || '', status: 'completed',
      tokens: 0, provider: '', model: '', citations: '[]',
      created_at: now, edited_at: null, parent_id: null
    });

    // Placeholder assistant response (real AI integration requires keys)
    const asstId = 'msg-' + crypto.randomUUID();
    const reply = 'Otrzymałem Twoją wiadomość. Aby uzyskać prawdziwe odpowiedzi AI, dodaj klucz API w Ustawienia → Klucze AI.\\n\\nTreść: ' + (body.content || '').slice(0, 200);
    await dbInsert(env, 'Message', {
      id: asstId, conversation_id: convId, user_id: user.id,
      role: 'assistant', content: reply, status: 'completed',
      tokens: 40, provider: 'system', model: 'placeholder',
      citations: '[]', created_at: new Date().toISOString(), edited_at: null, parent_id: userMsgId
    });

    await dbUpdate(env, 'Conversation', convId, { last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() });

    return json({
      ok: true,
      body: {
        userMessage: { id: userMsgId, role: 'user', content: body.content, status: 'completed' },
        assistantMessage: { id: asstId, role: 'assistant', content: reply, status: 'completed', provider: 'system', model: 'placeholder' }
      }
    });
  }

  // Projects
  if (path === '/api/projects' && method === 'GET') {
    const items = await dbQueryAll(env, 'SELECT * FROM Project WHERE user_id = ? ORDER BY updated_at DESC', [user.id]);
    return json({ ok: true, body: { items } });
  }

  if (path === '/api/projects' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const id = 'prj-' + crypto.randomUUID();
    const now = new Date().toISOString();
    await dbInsert(env, 'Project', {
      id, user_id: user.id, name: body.name || 'Nowy projekt',
      description: body.description || '', status: 'active', color: body.color || '#00E5FF',
      created_at: now, updated_at: now
    });
    return json({ ok: true, body: { id, name: body.name || 'Nowy projekt' } });
  }

  // Tasks
  if (path === '/api/tasks' && method === 'GET') {
    const items = await dbQueryAll(env, 'SELECT * FROM Task WHERE user_id = ? ORDER BY created_at DESC', [user.id]);
    return json({ ok: true, body: { items } });
  }

  if (path === '/api/tasks' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const id = 'tsk-' + crypto.randomUUID();
    const now = new Date().toISOString();
    await dbInsert(env, 'Task', {
      id, user_id: user.id, project_id: body.project_id || null,
      title: body.title || 'Nowe zadanie', description: body.description || '',
      status: body.status || 'todo', priority: body.priority || 'normal',
      deadline: body.deadline || null, depends_on: '[]',
      created_at: now, updated_at: now
    });
    return json({ ok: true, body: { id, title: body.title || 'Nowe zadanie' } });
  }

  // Memory
  if (path === '/api/memory' && method === 'GET') {
    const items = await dbQueryAll(env, 'SELECT * FROM MemoryEntry WHERE user_id = ? ORDER BY importance DESC, updated_at DESC LIMIT 200', [user.id]);
    return json({ ok: true, body: { items } });
  }

  // Credentials (masked)
  if (path === '/api/credentials' && method === 'GET') {
    const rows = await dbQueryAll(env, "SELECT * FROM ProviderKey WHERE user_id = ? AND status != 'deleted'", [user.id]);
    const aiKeys = {};
    const searchKeys = {};
    for (gemini', 'groq', 'mistral', 'openrouter', 'cloudflare', 'anthropic', 'openai'].forEach(p => {
      aiKeys[p] = { configured: false, masked: '', status: 'unset', lastTested: '' };
    });
    ['brave', 'serper', 'tavily', 'cloudflare'].forEach(p => {
      searchKeys[p] = { configured: false, masked: '', status: 'unset', lastTested: '' };
    });
    for (const r of rows) {
      try {
        const plain = await decryptSecret(env, { cipher: r.encrypted_key, nonce: r.nonce });
        const target = r.kind === 'search' ? searchKeys : aiKeys;
        if (target[r.provider]) {
          target[r.provider] = {
            configured: true,
            masked: maskSecret(plain),
            status: r.status,
            lastTested: r.last_tested_at || ''
          };
        }
      } catch (e) {}
    }
    return json({ ok: true, body: { aiKeys, searchKeys, oauth: {}, cloudflare: {} } });
  }

  // Approvals
  if (path === '/api/approvals' && method === 'GET') {
    const items = await dbQueryAll(env, "SELECT * FROM Approval WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC", [user.id]);
    return json({ ok: true, body: { items } });
  }

  return json({ ok: false, error: 'not_found', path }, 404);
}

// ── Queue & Scheduled ────────────────────────────────────────
async function handleQueue(env, message) {
  // Placeholder for queue consumers
  return;
}

// ── Export ───────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Service worker
    if (url.pathname === '/sw.js') {
      return new Response(env.SW_JS || '', { headers: { 'Content-Type': 'application/javascript' } });
    }

    // HTML shell
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(INDEX_HTML, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache'
        }
      });
    }

    // Health
    if (url.pathname === '/api/health') {
      return json({ ok: true, status: 'ok', version: VERSION, time: new Date().toISOString() });
    }

    // API
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
      return handleApi(request, env, ctx, url);
    }

    // Static assets
    if (env.ASSETS) {
      try {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse && assetResponse.status !== 404) return assetResponse;
      } catch (e) {}
    }

    // Fallback to SPA
    return new Response(INDEX_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  },

  async queue(batch, env, ctx) {
    for (const msg of batch.messages) {
      try {
        await handleQueue(env, msg.body);
        msg.ack();
      } catch (e) {
        msg.retry();
      }
    }
  },

  async scheduled(event, env, ctx) {
    const now = new Date().toISOString();
    try {
      await env.AL_DB.prepare('UPDATE Session SET revoked_at = ? WHERE expires_at < ? AND revoked_at IS NULL')
        .bind(now, now).run();
      await env.AL_DB.prepare("DELETE FROM Approval WHERE status = 'pending' AND created_at < ?")
        .bind(addDays(now, -14)).run();
      await env.AL_DB.prepare('DELETE FROM AuditLog WHERE created_at < ?')
        .bind(addDays(now, -180)).run();
    } catch (e) {
      console.error('scheduled error', e);
    }
  }
};
`;
    this.files['worker.js'] = worker;
  }

  // ─── Migrations ────────────────────────────────────────────
  genMigrationSQL() {
    const lines = [
      'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);'
    ];
    for (const [modelName, fields] of Object.entries(this.ast.storage.models || {})) {
      const cols = fields.map(f => {
        if (f.auto || f.name === 'id') return `${f.name} TEXT PRIMARY KEY`;
        if (f.type === 'number') return `${f.name} REAL`;
        if (f.type === 'bool') return `${f.name} INTEGER`;
        if (f.type === 'json') return `${f.name} TEXT`;
        if (f.type === 'datetime' || f.type === 'date') return `${f.name} TEXT`;
        if (f.type === 'enum') return `${f.name} TEXT`;
        return `${f.name} TEXT`;
      });
      lines.push(`CREATE TABLE IF NOT EXISTS ${modelName} (${cols.join(', ')});`);
    }
    for (const idx of this.ast.storage.indexes || []) {
      lines.push(`CREATE INDEX IF NOT EXISTS idx_${idx.model}_${idx.field} ON ${idx.model} (${idx.field});`);
    }
    return lines.join('\\n');
  }

  genMigrations() {
    this.files['migrations/0001_init.sql'] = this.genMigrationSQL();
  }

  // ─── Frontend (znacznie lepszy SPA) ────────────────────────
  genFrontend() {
    const screens = Object.entries(this.ast.screens).map(([name, s]) => ({
      name,
      title: s.title || name
    }));
    const firstScreen = Object.keys(this.ast.screens).includes('Czat')
      ? 'Czat'
      : (Object.keys(this.ast.screens)[0] || 'Login');

    const navItems = [
      { id: 'Czat', label: 'Czat', icon: '✦' },
      { id: 'Projekty', label: 'Projekty', icon: '📁' },
      { id: 'Zadania', label: 'Zadania', icon: '✓' },
      { id: 'Pamięć', label: 'Pamięć', icon: '🧠' },
      { id: 'Pliki', label: 'Pliki', icon: '📄' },
      { id: 'Research', label: 'Research', icon: '🔍' },
      { id: 'App Creator', label: 'App Creator', icon: '🛠' },
      { id: 'GitHub', label: 'GitHub', icon: '⌥' },
      { id: 'Deploy', label: 'Deploy', icon: '🚀' },
      { id: 'Muzyka', label: 'Muzyka', icon: '♫' },
      { id: 'Zatwierdzenia', label: 'Zatwierdzenia', icon: '🛡' },
      { id: 'Ustawienia', label: 'Ustawienia', icon: '⚙' },
      { id: 'Diagnostyka', label: 'Diagnostyka', icon: '♥' }
    ];

    const code = `'use strict';
const APP = ${JSON.stringify({
  id: this.ast.app?.id,
  name: this.ast.app?.name || 'AL2100',
  version: this.ast.app?.version || '1.0.0'
})};
const SCREENS = ${JSON.stringify(screens)};
const NAV = ${JSON.stringify(navItems)};
const FIRST_SCREEN = ${JSON.stringify(firstScreen)};

// ── State ────────────────────────────────────────────────────
const state = {
  ready: false,
  screen: FIRST_SCREEN,
  user: null,
  session: null,
  conversations: [],
  activeConversationId: null,
  messages: [],
  draft: '',
  projects: [],
  tasks: [],
  memory: [],
  approvals: [],
  toasts: [],
  loading: false,
  error: null,
  sidebarCollapsed: false,
  commandPaletteOpen: false
};

// ── DOM helpers ──────────────────────────────────────────────
function $(sel, ctx = document) { return ctx.querySelector(sel); }
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c == null || c === false) continue;
    if (typeof c === 'string' || typeof c === 'number') node.appendChild(document.createTextNode(String(c)));
    else if (c instanceof Node) node.appendChild(c);
  }
  return node;
}

// ── Toast ────────────────────────────────────────────────────
function toast(message, type = 'info') {
  const id = Date.now() + Math.random();
  state.toasts = [...state.toasts, { id, message, type }];
  renderToasts();
  setTimeout(() => {
    state.toasts = state.toasts.filter(t => t.id !== id);
    renderToasts();
  }, 4200);
}

function renderToasts() {
  let box = $('#toasts');
  if (!box) {
    box = el('div', { id: 'toasts', class: 'toasts' });
    document.body.appendChild(box);
  }
  box.innerHTML = '';
  state.toasts.forEach(t => {
    box.appendChild(el('div', { class: 'toast toast-' + t.type }, t.message));
  });
}

// ── API ──────────────────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include'
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || ('api_error_' + res.status));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ── Navigation ───────────────────────────────────────────────
function navigate(screen) {
  state.screen = screen;
  state.commandPaletteOpen = false;
  render();
}

// ── Screens ──────────────────────────────────────────────────
function renderLogin() {
  return el('div', { class: 'login-screen' }, [
    el('div', { class: 'login-card' }, [
      el('div', { class: 'login-brand' }, [
        el('div', { class: 'logo' }, 'AL'),
        el('h1', {}, 'AL2100'),
        el('p', { class: 'muted' }, 'Prywatny system operacyjny AI')
      ]),
      el('button', {
        class: 'btn btn-primary btn-block',
        onclick: async () => {
          try {
            state.loading = true;
            render();
            const res = await api('/api/auth/demo', 'POST', { name: 'Demo User', email: 'demo@al2100.local' });
            if (res.ok) {
              state.user = res.body.user;
              state.session = { id: res.body.sessionId, csrf: res.body.csrfToken };
              toast('Zalogowano (demo)', 'success');
              state.screen = 'Czat';
              await loadAll();
            }
          } catch (e) {
            toast('Błąd logowania: ' + e.message, 'danger');
          } finally {
            state.loading = false;
            render();
          }
        }
      }, state.loading ? 'Logowanie…' : 'Wejdź (demo)'),
      el('p', { class: 'login-note muted' }, 'Sesje są szyfrowane. To jest tryb demonstracyjny.')
    ])
  ]);
}

function renderChat() {
  const list = el('div', { class: 'conv-list' }, [
    el('div', { class: 'conv-toolbar' }, [
      el('button', {
        class: 'btn btn-primary btn-sm',
        onclick: async () => {
          try {
            const res = await api('/api/conversations', 'POST', { title: 'Nowa rozmowa' });
            if (res.ok) {
              state.conversations = [res.body, ...state.conversations];
              state.activeConversationId = res.body.id;
              state.messages = [];
              render();
            }
          } catch (e) { toast(e.message, 'danger'); }
        }
      }, '+ Nowa'),
    ]),
    ...state.conversations.map(c => el('button', {
      class: 'conv-item' + (c.id === state.activeConversationId ? ' active' : ''),
      onclick: async () => {
        state.activeConversationId = c.id;
        try {
          const res = await api('/api/conversations/' + c.id + '/messages');
          state.messages = (res.body && res.body.items) || [];
        } catch (e) { state.messages = []; }
        render();
      }
    }, c.title || 'Rozmowa'))
  ]);

  const messages = el('div', { class: 'messages' },
    state.messages.length === 0
      ? [el('div', { class: 'empty' }, 'Zacznij nową rozmowę lub wybierz istniejącą')]
      : state.messages.map(m => el('div', {
          class: 'msg msg-' + (m.role || 'assistant')
        }, [
          el('div', { class: 'msg-role' }, m.role === 'user' ? 'Ty' : 'AL2100'),
          el('div', { class: 'msg-content' }, m.content || ''),
          m.provider ? el('div', { class: 'msg-meta muted' }, (m.provider || '') + (m.model ? ' / ' + m.model : '')) : null
        ]))
  );

  const composer = el('div', { class: 'composer' }, [
    el('textarea', {
      class: 'composer-input',
      placeholder: 'Napisz wiadomość… (Enter = wyślij)',
      value: state.draft,
      oninput: (e) => { state.draft = e.target.value; },
      onkeydown: async (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          await sendMessage();
        }
      }
    }),
    el('button', {
      class: 'btn btn-primary',
      disabled: !state.draft.trim() || !state.activeConversationId,
      onclick: sendMessage
    }, 'Wyślij')
  ]);

  return el('div', { class: 'chat-layout' }, [
    list,
    el('div', { class: 'chat-main' }, [
      el('div', { class: 'chat-header' }, state.activeConversationId ? 'Rozmowa' : 'Wybierz lub utwórz rozmowę'),
      messages,
      composer
    ])
  ]);
}

async function sendMessage() {
  if (!state.draft.trim() || !state.activeConversationId) return;
  const content = state.draft.trim();
  state.draft = '';
  state.messages = [...state.messages, {
    id: 'tmp-' + Date.now(),
    role: 'user',
    content,
    status: 'completed'
  }];
  render();
  try {
    const res = await api('/api/chat/send', 'POST', {
      conversation_id: state.activeConversationId,
      content
    });
    if (res.ok && res.body) {
      // replace optimistic + add assistant
      state.messages = state.messages.filter(m => !String(m.id).startsWith('tmp-'));
      if (res.body.userMessage) state.messages.push(res.body.userMessage);
      if (res.body.assistantMessage) state.messages.push(res.body.assistantMessage);
    }
  } catch (e) {
    toast('Błąd wysyłania: ' + e.message, 'danger');
  }
  render();
}

function renderListScreen(title, items, emptyText, renderItem) {
  return el('div', { class: 'screen-pad' }, [
    el('h1', { class: 'screen-title' }, title),
    items.length === 0
      ? el('div', { class: 'empty' }, emptyText)
      : el('div', { class: 'card-list' }, items.map(renderItem))
  ]);
}

function renderProjects() {
  return renderListScreen('Projekty', state.projects, 'Brak projektów', p =>
    el('div', { class: 'card' }, [
      el('div', { class: 'card-title' }, p.name || 'Projekt'),
      el('div', { class: 'muted' }, p.description || p.status || '')
    ])
  );
}

function renderTasks() {
  return renderListScreen('Zadania', state.tasks, 'Brak zadań', t =>
    el('div', { class: 'card' }, [
      el('div', { class: 'card-title' }, t.title || 'Zadanie'),
      el('div', { class: 'muted' }, (t.status || '') + ' · ' + (t.priority || ''))
    ])
  );
}

function renderMemory() {
  return renderListScreen('Pamięć', state.memory, 'Brak wpisów pamięci', m =>
    el('div', { class: 'card' }, [
      el('div', { class: 'card-title' }, (m.kind || 'fact') + (m.pinned ? ' 📌' : '')),
      el('div', {}, m.content || '')
    ])
  );
}

function renderSettings() {
  return el('div', { class: 'screen-pad' }, [
    el('h1', { class: 'screen-title' }, 'Ustawienia'),
    el('div', { class: 'card' }, [
      el('div', { class: 'card-title' }, 'Konto'),
      el('div', {}, state.user ? (state.user.name + ' · ' + state.user.email) : 'Nie zalogowano')
    ]),
    el('div', { class: 'card', style: { marginTop: '12px' } }, [
      el('div', { class: 'card-title' }, 'Wersja'),
      el('div', { class: 'muted' }, APP.name + ' v' + APP.version + ' · compiler ' + ${JSON.stringify(VERSION)})
    ]),
    el('button', {
      class: 'btn btn-danger',
      style: { marginTop: '20px' },
      onclick: async () => {
        try { await api('/api/logout', 'POST'); } catch (e) {}
        state.user = null;
        state.session = null;
        state.screen = 'Login';
        render();
      }
    }, 'Wyloguj')
  ]);
}

function renderGeneric(title) {
  return el('div', { class: 'screen-pad' }, [
    el('h1', { class: 'screen-title' }, title),
    el('div', { class: 'empty' }, 'Ekran „' + title + '” jest w trakcie implementacji w tej wersji kompilatora.')
  ]);
}

function renderScreen() {
  if (!state.user && state.screen !== 'Login') {
    return renderLogin();
  }
  switch (state.screen) {
    case 'Login': return renderLogin();
    case 'Czat': return renderChat();
    case 'Projekty': return renderProjects();
    case 'Zadania': return renderTasks();
    case 'Pamięć': return renderMemory();
    case 'Ustawienia': return renderSettings();
    default: return renderGeneric(state.screen);
  }
}

// ── Main render ──────────────────────────────────────────────
function render() {
  const root = $('#app');
  if (!root) return;

  if (!state.ready) {
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'boot' }, [
      el('div', { class: 'logo big' }, 'AL'),
      el('div', { class: 'muted' }, 'Ładowanie AL2100…')
    ]));
    return;
  }

  if (!state.user) {
    root.innerHTML = '';
    root.appendChild(renderLogin());
    return;
  }

  // Shell
  const sidebar = el('aside', { class: 'sidebar' + (state.sidebarCollapsed ? ' collapsed' : '') }, [
    el('div', { class: 'brand' }, [
      el('div', { class: 'logo' }, 'AL'),
      el('div', {}, [
        el('div', { class: 'brand-name' }, 'AL2100'),
        el('div', { class: 'brand-sub muted' }, 'System operacyjny AI')
      ])
    ]),
    el('nav', { class: 'nav' }, NAV.map(item =>
      el('button', {
        class: 'nav-item' + (state.screen === item.id ? ' active' : ''),
        onclick: () => navigate(item.id)
      }, [
        el('span', { class: 'nav-icon' }, item.icon),
        el('span', { class: 'nav-label' }, item.label)
      ])
    )),
    el('div', { class: 'sidebar-footer muted' }, 'v' + APP.version)
  ]);

  const main = el('main', { class: 'main' }, renderScreen());

  root.innerHTML = '';
  root.appendChild(sidebar);
  root.appendChild(main);
  renderToasts();
}

// ── Boot ─────────────────────────────────────────────────────
async function loadAll() {
  try {
    const [convs, projs, tasks, mem] = await Promise.all([
      api('/api/conversations').catch(() => ({ body: { items: [] } })),
      api('/api/projects').catch(() => ({ body: { items: [] } })),
      api('/api/tasks').catch(() => ({ body: { items: [] } })),
      api('/api/memory').catch(() => ({ body: { items: [] } }))
    ]);
    state.conversations = (convs.body && convs.body.items) || [];
    state.projects = (projs.body && projs.body.items) || [];
    state.tasks = (tasks.body && tasks.body.items) || [];
    state.memory = (mem.body && mem.body.items) || [];
  } catch (e) {}
}

async function boot() {
  try {
    const s = await api('/api/session');
    if (s && s.ok && s.body) {
      state.user = s.body.user;
      state.session = { id: s.body.sessionId, csrf: s.body.csrfToken };
      await loadAll();
    }
  } catch (e) {
    // not logged in
  }
  state.ready = true;
  render();
}

// Keyboard
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    // simple command palette later
  }
});

document.addEventListener('DOMContentLoaded', boot);
`;

    this.files['assets/app.js'] = code;
  }

  // ─── CSS ───────────────────────────────────────────────────
  genCSS() {
    const colors = this.ast.theme.colors || {};
    const bg = colors.background || '#0A0F1E';
    const surface = colors.surface || '#121A2E';
    const surfaceElev = colors.surfaceElevated || '#17213A';
    const text = colors.text || '#EAF2FF';
    const muted = colors.textMuted || '#93A1C4';
    const primary = colors.primary || '#00E5FF';
    const border = colors.border || '#1F2A44';
    const danger = colors.danger || '#FF4D6D';
    const success = colors.success || '#22E39A';

    const css = `/* AL2100 – generated by axc ${VERSION} */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:${bg};
  --surface:${surface};
  --surface-elev:${surfaceElev};
  --text:${text};
  --muted:${muted};
  --primary:${primary};
  --border:${border};
  --danger:${danger};
  --success:${success};
  --radius:14px;
  --font:Inter,system-ui,-apple-system,sans-serif;
  --font-display:"Space Grotesk",Inter,system-ui,sans-serif;
}
html,body{height:100%;font-family:var(--font);background:var(--bg);color:var(--text);line-height:1.5;-webkit-font-smoothing:antialiased}
#app{display:flex;height:100vh;overflow:hidden}

/* Boot / Login */
.boot,.login-screen{display:flex;align-items:center;justify-content:center;height:100vh;width:100%;background:var(--bg)}
.login-card{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:40px;width:100%;max-width:400px;text-align:center}
.login-brand{margin-bottom:28px}
.logo{width:56px;height:56px;border-radius:16px;background:var(--primary);color:#04121B;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:20px;font-family:var(--font-display);margin-bottom:12px}
.logo.big{width:72px;height:72px;font-size:26px}
.login-card h1{font-family:var(--font-display);font-size:28px;margin-bottom:4px}
.login-note{margin-top:20px;font-size:13px}

/* Sidebar */
.sidebar{width:260px;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0}
.brand{display:flex;align-items:center;gap:12px;padding:20px 16px;border-bottom:1px solid var(--border)}
.brand-name{font-weight:600;font-size:15px}
.brand-sub{font-size:11px}
.nav{flex:1;padding:12px 10px;overflow-y:auto}
.nav-item{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;margin-bottom:2px;background:transparent;border:none;color:var(--muted);text-align:left;cursor:pointer;border-radius:10px;font-size:14px;transition:background .15s,color .15s}
.nav-item:hover{background:var(--surface-elev);color:var(--text)}
.nav-item.active{background:var(--primary);color:#04121B;font-weight:600}
.nav-icon{width:20px;text-align:center;opacity:.9}
.sidebar-footer{padding:12px 16px;font-size:11px;border-top:1px solid var(--border)}

/* Main */
.main{flex:1;overflow:hidden;display:flex;flex-direction:column;background:var(--bg)}
.screen-pad{padding:28px 32px;overflow-y:auto;height:100%}
.screen-title{font-family:var(--font-display);font-size:26px;margin-bottom:20px;font-weight:600}

/* Cards & lists */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px}
.card-title{font-weight:600;margin-bottom:4px}
.card-list{display:flex;flex-direction:column;gap:10px}
.empty{display:flex;align-items:center;justify-content:center;padding:48px 24px;color:var(--muted);font-size:14px}

/* Buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 18px;border-radius:10px;border:none;font-size:14px;font-weight:600;cursor:pointer;transition:opacity .15s,transform .1s}
.btn:active{transform:scale(0.98)}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn-primary{background:var(--primary);color:#04121B}
.btn-primary:hover:not(:disabled){opacity:.9}
.btn-danger{background:var(--danger);color:#fff}
.btn-sm{padding:6px 12px;font-size:13px}
.btn-block{width:100%}

/* Chat */
.chat-layout{display:flex;height:100%;overflow:hidden}
.conv-list{width:260px;border-right:1px solid var(--border);display:flex;flex-direction:column;background:var(--surface)}
.conv-toolbar{padding:12px;border-bottom:1px solid var(--border)}
.conv-item{display:block;width:100%;padding:12px 14px;background:transparent;border:none;color:var(--text);text-align:left;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border)}
.conv-item:hover{background:var(--surface-elev)}
.conv-item.active{background:var(--surface-elev);border-left:3px solid var(--primary)}
.chat-main{flex:1;display:flex;flex-direction:column;min-width:0}
.chat-header{padding:14px 20px;border-bottom:1px solid var(--border);font-weight:600;background:var(--surface)}
.messages{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:14px}
.msg{max-width:780px}
.msg-role{font-size:11px;font-weight:600;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em}
.msg-content{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 16px;white-space:pre-wrap;line-height:1.55}
.msg-user .msg-content{background:var(--surface-elev)}
.msg-meta{font-size:11px;margin-top:4px}
.composer{display:flex;gap:10px;padding:14px 16px;border-top:1px solid var(--border);background:var(--surface);align-items:flex-end}
.composer-input{flex:1;min-height:44px;max-height:160px;padding:12px 14px;border-radius:12px;border:1px solid var(--border);background:var(--bg);color:var(--text);font:inherit;resize:vertical;outline:none}
.composer-input:focus{border-color:var(--primary)}

/* Toasts */
.toasts{position:fixed;bottom:24px;right:24px;display:flex;flex-direction:column;gap:8px;z-index:500;pointer-events:none}
.toast{padding:12px 18px;background:var(--surface-elev);border:1px solid var(--border);border-radius:12px;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:auto;max-width:360px}
.toast-success{border-left:3px solid var(--success)}
.toast-danger{border-left:3px solid var(--danger)}
.toast-info{border-left:3px solid var(--primary)}

.muted{color:var(--muted)}

@media (max-width:820px){
  .sidebar{width:72px}
  .nav-label,.brand-name,.brand-sub,.sidebar-footer{display:none}
  .brand{justify-content:center}
  .conv-list{width:200px}
}
`;
    this.files['assets/app.css'] = css;
  }

  // ─── Assets ────────────────────────────────────────────────
  genAssets() {
    this.files['assets/manifest.webmanifest'] = JSON.stringify({
      name: this.ast.app?.name || 'AL2100',
      short_name: this.ast.app?.name || 'AL2100',
      start_url: '/',
      display: 'standalone',
      background_color: this.ast.theme?.colors?.background || '#0A0F1E',
      theme_color: this.ast.theme?.colors?.primary || '#00E5FF',
      icons: []
    }, null, 2);

    this.files['assets/sw.js'] = `'use strict';
const CACHE = 'al2100-v${VERSION}';
const PRECACHE = ['/', '/assets/app.js', '/assets/app.css', '/assets/manifest.webmanifest'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', e => { self.clients.claim(); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok && e.request.url.startsWith(self.location.origin)) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match('/')))
  );
});
`;
  }

  // ─── HTML ──────────────────────────────────────────────────
  genHTML() {
    const title = this.ast.app?.name || 'AL2100';
    const css = this.files['assets/app.css'] || '';
    const script = this.files['assets/app.js'] || '';
    const themeColor = this.ast.theme?.colors?.primary || '#00E5FF';

    this.files['index.html'] = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="${themeColor}">
<meta name="description" content="${this.escape(title)} – prywatny system operacyjny AI">
<title>${this.escape(title)}</title>
<link rel="manifest" href="/assets/manifest.webmanifest">
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script>${script}</script>
</body>
</html>
`;
  }

  // ─── Wrangler / package ────────────────────────────────────
  genWrangler() {
    const name = (this.ast.app?.id || 'al2100').replace(/\\./g, '-');
    this.files['wrangler.toml'] = `name = "${name}"
main = "worker.js"
compatibility_date = "2026-10-30"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./assets"
binding = "ASSETS"

[[d1_databases]]
binding = "AL_DB"
database_name = "${name}-db"
database_id = ""

[[r2_buckets]]
binding = "AL_BUCKET"
bucket_name = "${name}-bucket"

[[kv_namespaces]]
binding = "AL_KV"
id = ""
`;
  }

  genPackageJson() {
    this.files['package.json'] = JSON.stringify({
      name: this.ast.app?.id || 'al2100',
      version: this.ast.app?.version || '1.0.0',
      private: true,
      scripts: {
        build: 'node ../axc.js build AL2100.ax',
        start: 'npx wrangler dev --local',
        deploy: 'npx wrangler deploy',
        db: 'npx wrangler d1 execute AL_DB --local --file=./migrations/0001_init.sql'
      },
      devDependencies: {
        wrangler: '^3.99.0'
      }
    }, null, 2);
  }

  genReadme() {
    this.files['README.md'] = `# ${this.ast.app?.name || 'AL2100'}

Wygenerowano przez **AXCode Compiler v${VERSION}**.

## Szybki start

\`\`\`bash
# 1. Zainstaluj zależności
npm install

# 2. Utwórz lokalną bazę
npm run db

# 3. Uruchom lokalnie
npm start
\`\`\`

Otwórz http://localhost:8787

## Deploy

1. Uzupełnij \`database_id\` i \`id\` KV w \`wrangler.toml\`
2. Ustaw secret:
   \`\`\`bash
   npx wrangler secret put AL_MASTER_ENCRYPTION_KEY
   \`\`\`
3. \`npm run deploy\`

## Funkcje w tej wersji kompilatora

- Logowanie demo
- Lista rozmów + proste wysyłanie wiadomości
- Projekty, Zadania, Pamięć (odczyt)
- Responsywny shell + toasty
- Worker z podstawowym API + D1 + KV
`;
  }

  // ─── helpers ───────────────────────────────────────────────
  escape(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────
class CLI {
  static async run(argv) {
    const args = argv.slice(2);
    const cmd = args[0] || 'help';
    const file = args.find(a => !a.startsWith('-') && a.endsWith('.ax')) || 'AL2100.ax';
    const flags = {
      strict: args.includes('--strict'),
      minify: !args.includes('--no-minify'),
      out: (args.find(a => a.startsWith('--out=')) || '').replace('--out=', '') || 'dist',
      watch: args.includes('--watch') || cmd === 'watch'
    };

    try {
      switch (cmd) {
        case 'check': return this.check(file, flags);
        case 'lint': return this.lint(file, flags);
        case 'build': return this.build(file, flags);
        case 'dev': return this.dev(file, flags);
        case 'deploy': return this.deploy(file, flags);
        case 'format': return this.format(file, flags);
        case 'watch': return this.watch(file, flags);
        case 'help':
        case '--help':
        case '-h':
        default:
          this.printHelp();
          return 0;
      }
    } catch (e) {
      if (e instanceof AxcError) console.error(e.format());
      else console.error('[AXC_FATAL]', e.message || e);
      return 1;
    }
  }

  static printHelp() {
    console.log(`AXCode Compiler v${VERSION}

Użycie:
  node axc.js <command> [file.ax] [options]

Komendy:
  check      Analiza składni i semantyki
  lint       Analiza + ostrzeżenia + podsumowanie
  build      Kompilacja do /dist
  dev        Build + lokalny wrangler
  deploy     Build + instrukcja deploy
  format     Formatowanie pliku .ax
  watch      Rekompilacja przy zmianie

Opcje:
  --strict       Ostrzeżenia = błędy
  --no-minify    Bez minifikacji
  --out=<dir>    Katalog wyjściowy (domyślnie dist)
`);
  }

  static readAndParse(file) {
    if (!fs.existsSync(file)) {
      throw new AxcError(`Plik nie istnieje: ${file}`, 0, 0, 'Podaj ścieżkę do pliku .ax', 'AXC_NO_FILE');
    }
    const src = fs.readFileSync(file, 'utf8');
    const lexer = new Lexer(src);
    const tokens = lexer.tokenize();
    if (lexer.errors.length) throw lexer.errors[0];
    const parser = new Parser(tokens, src);
    const blocks = parser.parseFile();
    if (parser.errors.length) throw parser.errors[0];
    const ast = Merger.merge(blocks);
    return { ast, src };
  }

  static analyze(file, flags) {
    const { ast } = this.readAndParse(file);
    const { errors, warnings } = Analyzer.analyze(ast);
    return { ast, errors, warnings };
  }

  static check(file, flags) {
    const t0 = Date.now();
    const { errors, warnings } = this.analyze(file, flags);
    if (errors.length) {
      for (const e of errors) console.error(e.format ? e.format() : e);
      return 1;
    }
    if (warnings.length) {
      for (const w of warnings) console.warn('warning:', w);
      if (flags.strict) return 1;
    }
    console.log(`OK ${file} (${Date.now() - t0}ms) — ${warnings.length} ostrzeżeń`);
    return 0;
  }

  static lint(file, flags) {
    const { ast, errors, warnings } = this.analyze(file, flags);
    for (const e of errors) console.error(e.format ? e.format() : e);
    for (const w of warnings) console.warn('warning:', w);
    console.log(`\\nPodsumowanie: ${Object.keys(ast.screens).length} ekranów, ${Object.keys(ast.components).length} komponentów, ${ast.logic.functions.length} funkcji, ${ast.apis.length} API, ${ast.queues.length} kolejek, ${ast.crons.length} cronów`);
    return errors.length || (flags.strict && warnings.length) ? 1 : 0;
  }

  static build(file, flags) {
    const t0 = Date.now();
    const { ast, errors, warnings } = this.analyze(file, flags);
    if (errors.length) {
      for (const e of errors) console.error(e.format ? e.format() : e);
      return 1;
    }
    if (warnings.length) for (const w of warnings) console.warn('warning:', w);
    if (flags.strict && warnings.length) return 1;

    const outDir = path.resolve(ROOT, flags.out);
    if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    const gen = new Generator(ast);
    const files = gen.generate(outDir);

    console.log(`Build OK (${Date.now() - t0}ms) — ${files.length} plików → ${flags.out}/`);
    for (const f of files) console.log('  ' + f);
    return 0;
  }

  static async dev(file, flags) {
    const code = this.build(file, flags);
    if (code !== 0) return code;
    const outDir = path.resolve(ROOT, flags.out);
    console.log('\\nDev server: http://localhost:8787');
    console.log('Uruchamiam wrangler dev…\\n');
    const child = spawn('npx', ['wrangler', 'dev', '--local'], { cwd: outDir, stdio: 'inherit' });
    return new Promise(resolve => child.on('exit', c => resolve(c || 0)));
  }

  static async deploy(file, flags) {
    const code = this.build(file, flags);
    if (code !== 0) return code;
    console.log('\\nDeploy wymaga potwierdzenia. Uruchom ręcznie:');
    console.log('  cd dist && npx wrangler deploy');
    return 0;
  }

  static format(file, flags) {
    const src = fs.readFileSync(file, 'utf8');
    let out = src.replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n');
    if (!out.endsWith('\\n')) out += '\\n';
    fs.writeFileSync(file, out, 'utf8');
    console.log(`Sformatowano ${file}`);
    return 0;
  }

  static watch(file, flags) {
    console.log(`Watch mode: ${file} → ${flags.out}/`);
    const run = () => {
      try { this.build(file, flags); } catch (e) { console.error(e.message); }
    };
    run();
    fs.watch(file, () => {
      console.log(`\\nZmiana: ${file} — rekompilacja…`);
      run();
    });
    return new Promise(() => {});
  }
}

// ── entry ────────────────────────────────────────────────────
if (require.main === module) {
  CLI.run(process.argv)
    .then(code => process.exit(code))
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { Lexer, Parser, Merger, Analyzer, Generator, CLI, AxcError, VERSION };
