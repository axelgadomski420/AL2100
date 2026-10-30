#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

const VERSION = '3.0.0';
const ROOT = process.cwd();

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
      if (c === '/' && this.peek(1) === '/') { while (!this.atEnd() && this.peek() !== '\n') this.advance(); continue; }
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
      if (this.atEnd()) { this.tokens.push({ type: T.EOF, value: '', line: this.line, col: this.col }); break; }
      const line = this.line, col = this.col, c = this.peek();
      if (c === '"' || c === "'") { this.tokens.push({ type: T.STRING, value: this.readQuoted(c), line, col }); continue; }
      if (c === '`') { this.tokens.push({ type: T.TEMPLATE, value: this.readQuoted(c), line, col }); continue; }
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
      if (twoMap[two]) { this.advance(); this.advance(); this.tokens.push({ type: twoMap[two], value: two, line, col }); continue; }
      const singles = {
        '{': T.LBRACE, '}': T.RBRACE, '[': T.LBRACKET, ']': T.RBRACKET,
        '(': T.LPAREN, ')': T.RPAREN, ':': T.COLON, ',': T.COMMA, ';': T.SEMI,
        '.': T.DOT, '?': T.QUESTION, '|': T.PIPE, '@': T.AT, '=': T.ASSIGN,
        '<': T.LT, '>': T.GT, '!': T.NOT, '+': T.PLUS, '-': T.MINUS,
        '*': T.STAR, '/': T.SLASH, '%': T.PERCENT
      };
      if (singles[c]) { this.advance(); this.tokens.push({ type: singles[c], value: c, line, col }); continue; }
      this.errors.push(new AxcError(`Nieoczekiwany znak: ${JSON.stringify(c)}`, line, col, 'Może brakuje cudzysłowu lub nawiasu', 'AXC_LEX'));
      this.advance();
    }
    return this.tokens;
  }
}

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
      else if (this.tokens[i].type === T.RBRACE) { depth--; if (depth === 0) { end = i; break; } }
    }
    if (depth !== 0) this.errors.push(new AxcError('Niedomknięty blok', startTok.line, startTok.col, 'Dodaj brakujący }', 'AXC_UNCLOSED'));
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
    if (this.peek().type === T.STRING) block.label = this.next().value;
    else if (this.peek().type === T.IDENT && !['{', ':'].includes(this.tokens[this.pos + 1].type)) block.label = this.next().value;
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
    if (name === 'component') { ast.components[b.label || 'Component_' + b.startLine] = { name: b.label, params: b.params, body: b.body }; return; }
    if (name === 'screen') { ast.screens[b.label || 'Screen_' + b.startLine] = { name: b.label, body: b.body, title: this.extractTitle(b.body) }; return; }
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
      }
      else app[k] = v.replace(/^"|"$/g, '');
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
    ai.limits = { maxTokensPerRequest: 32000, maxTokensPerConversation: 200000, maxDailyCost: 5.0, maxConcurrentGenerations: 1, maxAgentSteps: 24, maxAgentSeconds: 180, ...ai.limits };
    ai.safety = { confirmBeforeDelete: true, confirmBeforeDeploy: true, confirmBeforePush: true, confirmBeforeExternalCall: true, hideSecrets: true, redactLogs: true, blockUnknownProviders: true, blockSsrf: true, ...ai.safety };
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
    }
    else if (/\bjson\b/.test(def)) type = 'json';
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
        if (fnM) { currentBlock = 'function'; currentName = fnM[1]; currentParams = fnM[2].split(',').map(s => s.trim()).filter(Boolean); depth = 1; buf = ''; continue; }
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

class Analyzer {
  static analyze(ast) {
    const errors = [], warnings = [];
    if (!ast.app) errors.push(new AxcError('Brak sekcji app', 0, 0, 'Dodaj: app "Nazwa" { ... }', 'AXC_NO_APP'));
    if (ast.app && !ast.app.id) warnings.push('Brak app.id — ustaw id "pl.twoja.app"');
    if (!ast.storage || Object.keys(ast.storage.models).length === 0) warnings.push('Brak modeli w storage — aplikacja nie będzie miała bazy');
    for (const [name, fields] of Object.entries(ast.storage.models || {})) {
      if (!fields.some(f => f.name === 'id')) errors.push(new AxcError(`Model ${name} nie ma pola id`, 0, 0, 'Dodaj: id auto', 'AXC_NO_ID'));
    }
    for (const idx of ast.storage.indexes || []) {
      if (!ast.storage.models[idx.model]) errors.push(new AxcError(`Indeks na nieistniejącym modelu: ${idx.model}`, 0, 0, '', 'AXC_BAD_IDX'));
      else if (!ast.storage.models[idx.model].some(f => f.name === idx.field)) errors.push(new AxcError(`Indeks na nieistniejącym polu: ${idx.model}.${idx.field}`, 0, 0, '', 'AXC_BAD_IDX'));
    }
    if (!Object.keys(ast.screens).length) warnings.push('Brak ekranów — aplikacja będzie pusta');
    if (!Object.keys(ast.ai.providers).length) warnings.push('Brak providerów AI w ai.providers');
    for (const [name, c] of Object.entries(ast.components)) {
      if (!c.body.trim()) warnings.push(`Komponent ${name} ma puste ciało`);
    }
    for (const fn of ast.logic.functions) {
      if (!fn.body.trim()) warnings.push(`Funkcja ${fn.name} ma puste ciało`);
    }
    return { errors, warnings };
  }
}

class Translator {
  constructor(ast) { this.ast = ast; }
  classify(body) {
    const serverHits = (body.match(/\b(db\.|env\.|request\.|r2\.|queue\.|cache\.|audit\(|requestApproval\(|encryptSecret\(|decryptSecret\(|hashIp\(|rateCheck\(|ai\.generate\(|ai\.stream\(|ai\.testKey\(|search\.run\(|oauth\.|env\.)/g) || []).length;
    const clientHits = (body.match(/\b(fetch\(|navigate |prompt |clipboard\.|window\.|document\.|navigator\.|localStorage\.|media\.record\(|file\.pick\()/g) || []).length;
    if (serverHits > 0 && clientHits === 0) return 'server';
    if (clientHits > 0 && serverHits === 0) return 'client';
    if (serverHits > 0 && clientHits > 0) return 'mixed';
    return 'shared';
  }
  translateBody(body, mode) {
    let s = body;
    s = this.translateControlFlow(s);
    s = this.translateCalls(s, mode);
    return s;
  }
  translateControlFlow(s) {
    s = s.replace(/\bfor\s+(\w+)\s+in\s+([^{:\n]+?)\s*\{/g, (m, v, it) => `for (const ${v} of ${it.trim()}) {`);
    s = s.replace(/\bif\s+(.+?)\s*\{/g, (m, cond) => `if (${cond.trim()}) {`);
    s = s.replace(/\belse\s+if\s+(.+?)\s*\{/g, (m, cond) => `else if (${cond.trim()}) {`);
    s = s.replace(/\bwhile\s+(.+?)\s*\{/g, (m, cond) => `while (${cond.trim()}) {`);
    s = s.replace(/\bmatch\s+([^{]+?)\s*\{([\s\S]*?)\}/g, (m, expr, cases) => {
      const caseRe = /"([^"]+)"\s*=>\s*([^\n]+)/g;
      const elseM = cases.match(/else\s*=>\s*([^\n]+)/);
      let out = `switch (${expr.trim()}) {\n`;
      let cm;
      while ((cm = caseRe.exec(cases))) out += `  case ${JSON.stringify(cm[1])}: return ${cm[2].trim()};\n`;
      if (elseM) out += `  default: return ${elseM[1].trim()};\n`;
      out += '}';
      return out;
    });
    s = s.replace(/\bnot\s+([\w(.])/g, '!$1');
    return s;
  }
  translateCalls(s, mode) {
    if (mode === 'server' || mode === 'mixed' || mode === 'shared') {
      s = s.replace(/\bdb\.insert\(\s*([^,]+?),\s*([\s\S]+?)\)(?![\w.])/g, 'await dbInsert(env, $1, $2)');
      s = s.replace(/\bdb\.update\(\s*([^,]+?),\s*([^,]+?),\s*([\s\S]+?)\)(?![\w.])/g, 'await dbUpdate(env, $1, $2, $3)');
      s = s.replace(/\bdb\.queryOne\(\s*([^,()]+?)(?:,\s*([^()]+?))?\)(?![\w.])/g, (m, q, p) => p ? `await dbQueryOne(env, ${q}, ${p})` : `await dbQueryOne(env, ${q})`);
      s = s.replace(/\bdb\.query\(\s*([^,()]+?)(?:,\s*([^()]+?))?\)(?![\w.])/g, (m, q, p) => p ? `await dbQueryAll(env, ${q}, ${p})` : `await dbQueryAll(env, ${q})`);
      s = s.replace(/\bai\.generate\(\s*([^,]+?),\s*([^,]+?),\s*([^,]+?)(?:,\s*([^()]+?))?\)(?![\w.])/g, (m, p, mo, pr, o) => o ? `await aiGenerate(env, ${p}, ${mo}, ${pr}, ${o})` : `await aiGenerate(env, ${p}, ${mo}, ${pr})`);
      s = s.replace(/\bai\.stream\(\s*([^,]+?),\s*([^,]+?),\s*([^,]+?)(?:,\s*([^()]+?))?\)(?![\w.])/g, (m, p, mo, c, a) => a ? `await aiStream(env, ${p}, ${mo}, ${c}, ${a})` : `await aiStream(env, ${p}, ${mo}, ${c})`);
      s = s.replace(/\bai\.testKey\(\s*([^,]+?),\s*([^()]+?)\)(?![\w.])/g, 'await aiTestKey($1, $2)');
      s = s.replace(/\bcache\.get\(([^()]+?)\)/g, 'await cacheGet(env, $1)');
      s = s.replace(/\bcache\.set\(\s*([^,]+?),\s*([^,]+?)(?:,\s*([^()]+?))?\)/g, (m, k, v, t) => t ? `await cacheSet(env, ${k}, ${v}, ${t})` : `await cacheSet(env, ${k}, ${v})`);
      s = s.replace(/\bcache\.incr\(\s*([^,]+?),\s*([^()]+?)\)/g, 'await cacheIncr(env, $1, $2)');
      s = s.replace(/\baudit\(\s*([^,]+?),\s*([^,]+?),\s*([^,]+?),\s*([^,]+?),\s*([^,]+?),\s*([^()]+?)\)/g, 'await audit(env, $1, $2, $3, $4, $5, $6)');
      s = s.replace(/\brequestApproval\(\s*([^,]+?),\s*([^,]+?),\s*([^,]+?),\s*([^()]+?)\)/g, 'await requestApproval(env, $1, $2, $3, $4, user)');
      s = s.replace(/\bencryptSecret\(([^()]+?)\)/g, 'await encryptSecret(env, $1)');
      s = s.replace(/\bdecryptSecret\(([^()]+?)\)/g, 'await decryptSecret(env, $1)');
      s = s.replace(/\bhashIp\(([^()]+?)\)/g, 'await hashIp(env, $1)');
      s = s.replace(/\brateCheck\(\s*([^,]+?),\s*([^()]+?)\)/g, 'await rateCheck(env, $1, $2, 60)');
      s = s.replace(/\boauth\.github\.exchange\(\s*([^()]+?)\)/g, 'await githubExchange($1)');
      s = s.replace(/\boauth\.google\.exchange\(\s*([^()]+?)\)/g, 'await googleExchange($1)');
      s = s.replace(/\boauth\.github\.profile\(([^()]+?)\)/g, 'await githubProfile($1)');
      s = s.replace(/\boauth\.google\.profile\(([^()]+?)\)/g, 'await googleProfile($1)');
      s = s.replace(/\bsearch\.run\(\s*([^,]+?)(?:,\s*([^()]+?))?\)/g, (m, q, o) => o ? `await searchRun(env, user, ${q}, ${o})` : `await searchRun(env, user, ${q})`);
      s = s.replace(/\bpdf\.extractText\(([^()]+?)\)/g, 'await pdfExtractText($1)');
      s = s.replace(/\bwhisper\.transcribe\(([^()]+?)\)/g, 'await whisperTranscribe(env, $1)');
      s = s.replace(/\baudio\.analyze\(([^()]+?)\)/g, 'await audioAnalyze($1)');
      s = s.replace(/\br2\.put\(\s*([^,]+?),\s*([^,]+?),\s*([^,]+?)(?:,\s*([^()]+?))?\)/g, (m, b, k, v, o) => o ? `await r2Put(${b}, ${k}, ${v}, ${o})` : `await r2Put(${b}, ${k}, ${v})`);
      s = s.replace(/\br2\.get\(\s*([^,]+?),\s*([^()]+?)\)/g, 'await r2Get($1, $2)');
      s = s.replace(/\br2\.list\(\s*([^,]+?)(?:,\s*([^()]+?))?\)/g, (m, b, o) => o ? `await r2List(${b}, ${o})` : `await r2List(${b})`);
      s = s.replace(/\bqueue\.push\(\s*([^,]+?),\s*([^()]+?)\)/g, 'await queuePush($1, $2)');
      s = s.replace(/\bhttp\.get\(\s*([^,]+?)(?:,\s*([^()]+?))?\)/g, (m, u, h) => h ? `await httpGet(${u}, ${h})` : `await httpGet(${u})`);
      s = s.replace(/\bhttp\.post\(\s*([^,]+?),\s*([^,]+?)(?:,\s*([^()]+?))?\)/g, (m, u, b, h) => h ? `await httpPost(${u}, ${b}, ${h})` : `await httpPost(${u}, ${b})`);
      s = s.replace(/\bhttp\.put\(\s*([^,]+?),\s*([^,]+?)(?:,\s*([^()]+?))?\)/g, (m, u, b, h) => h ? `await httpPut(${u}, ${b}, ${h})` : `await httpPut(${u}, ${b})`);
      s = s.replace(/\bhttp\.del\(\s*([^,]+?)(?:,\s*([^()]+?))?\)/g, (m, u, h) => h ? `await httpDel(${u}, ${h})` : `await httpDel(${u})`);
    }
    if (mode === 'client' || mode === 'mixed') {
      s = s.replace(/\bnavigate\s+([^\n;]+?)(?=$|\n)/g, 'location.href = $1');
      s = s.replace(/\bprompt\s+"([^"]+)"/g, 'window.prompt("$1")');
      s = s.replace(/\bnotify\s+"([^"]+)"/g, 'toast("$1")');
      s = s.replace(/\bclipboard\.write\(([^()]+?)\)/g, 'navigator.clipboard.writeText($1)');
      s = s.replace(/\bclipboard\.read\(\)/g, 'navigator.clipboard.readText()');
    }
    s = s.replace(/\bcrypto\.randomHex\(([^()]+?)\)/g, 'randomHex($1)');
    s = s.replace(/\bcrypto\.randomBytes\(([^()]+?)\)/g, 'randomBytes($1)');
    s = s.replace(/\bcrypto\.sha256\(([^()]+?)\)/g, 'await sha256($1)');
    s = s.replace(/\bcrypto\.hex\(([^()]+?)\)/g, 'bytesToHex($1)');
    s = s.replace(/\bcrypto\.unhex\(([^()]+?)\)/g, 'hexToBytes($1)');
    s = s.replace(/\bcrypto\.base64Encode\(([^()]+?)\)/g, 'b64enc($1)');
    s = s.replace(/\bcrypto\.base64Decode\(([^()]+?)\)/g, 'b64dec($1)');
    s = s.replace(/\bcrypto\.aesGcm\.encrypt\(\s*([^,]+?),\s*([^,]+?)(?:,\s*([^()]+?))?\)/g, (m, p, k, n) => n ? `await aesGcmEncrypt(${p}, ${k}, ${n})` : `await aesGcmEncrypt(${p}, ${k})`);
    s = s.replace(/\bcrypto\.aesGcm\.decrypt\(\s*([^,]+?),\s*([^,]+?),\s*([^()]+?)\)/g, 'await aesGcmDecrypt($1, $2, $3)');
    s = s.replace(/\bdate\.nowIso\(\)/g, 'new Date().toISOString()');
    s = s.replace(/\bdate\.today\(\)/g, 'new Date().toISOString().slice(0,10)');
    s = s.replace(/\bdate\.addDays\(([^,]+?),\s*([^()]+?)\)/g, 'addDays($1, $2)');
    s = s.replace(/\bdate\.subDays\(([^,]+?),\s*([^()]+?)\)/g, 'addDays($1, -$2)');
    s = s.replace(/\bdate\.subHours\(([^,]+?),\s*([^()]+?)\)/g, 'addHours($1, -$2)');
    s = s.replace(/\bdate\.diffHours\(([^,]+?),\s*([^()]+?)\)/g, 'diffHours($1, $2)');
    s = s.replace(/\bdate\.diffSeconds\(([^,]+?),\s*([^()]+?)\)/g, 'diffSeconds($1, $2)');
    s = s.replace(/\bdate\.endOfDay\(([^()]+?)\)/g, 'endOfDay($1)');
    s = s.replace(/\bdate\.unix\(\)/g, 'Math.floor(Date.now()/1000)');
    s = s.replace(/\buuid\.v4\(\)/g, 'crypto.randomUUID()');
    s = s.replace(/\bjson\.stringify\(([^()]+?)\)/g, 'JSON.stringify($1)');
    s = s.replace(/\bjson\.parse\(([^()]+?)\)/g, 'JSON.parse($1)');
    return s;
  }
  translateFunction(fn) {
    const kind = this.classify(fn.body);
    const body = this.translateBody(fn.body, kind);
    return { kind, name: fn.name, params: fn.params, body };
  }
}

class Generator {
  constructor(ast) {
    this.ast = ast;
    this.t = new Translator(ast);
    this.files = {};
  }
  generate(outDir) {
    this.genWorker();
    this.genMigrations();
    this.genFrontend();
    this.genCSS();
    this.genAssets();
    this.genHTML();
    this.genWrangler();
    for (const [p, content] of Object.entries(this.files)) {
      const full = path.isAbsolute(p) ? p : path.join(outDir, p);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
    return Object.keys(this.files);
  }
  genWorker() {
    const serverFns = [];
    for (const fn of this.ast.logic.functions) {
      const t = this.t.translateFunction(fn);
      if (t.kind === 'server' || t.kind === 'shared' || t.kind === 'mixed') {
        serverFns.push(`async function ${t.name}(${t.params.join(', ')}) {\n${t.body}\n}`);
      }
    }
    const routes = this.extractRoutes();
    this.files['worker.js'] = this.buildWorkerCode(serverFns, routes);
  }
  extractRoutes() {
    const routes = [];
    for (const api of this.ast.apis) {
      const routeRe = /route\s+(GET|POST|PUT|PATCH|DELETE)\s+([\w\/:.\-]+)\s*\{([\s\S]*?)\n\s*\}/g;
      let m;
      while ((m = routeRe.exec(api.body))) {
        const method = m[1], p = m[2], body = m[3];
        const handlerM = body.match(/handler\s*\{([\s\S]*)\}/);
        if (!handlerM) continue;
        const handler = handlerM[1];
        const translated = this.t.translateBody(handler, 'server');
        routes.push({
          method,
          path: p,
          auth: /\bauth\s+true\b/.test(body),
          csrf: /\bcsrf\s+true\b/.test(body),
          stream: /\bstream\s+true\b/.test(body),
          rateLimit: (body.match(/rateLimit\s+"([^"]+)"/) || [])[1] || '',
          requiresApproval: (body.match(/requiresApproval\s+"([^"]+)"/) || [])[1] || '',
          handler: translated
        });
      }
    }
    return routes;
  }
  buildWorkerCode(serverFns, routes) {
    const routeDefs = routes.map(r => {
      const params = (r.path.match(/:(\w+)/g) || []).map(p => p.slice(1));
      return `  { method: ${JSON.stringify(r.method)}, path: ${JSON.stringify(r.path)}, auth: ${r.auth}, csrf: ${r.csrf}, stream: ${r.stream}, rateLimit: ${JSON.stringify(r.rateLimit)}, requiresApproval: ${JSON.stringify(r.requiresApproval)}, params: ${JSON.stringify(params)}, handler: async ({ request, env, body, params, user, session, url }) => {\n${r.handler}\n  } }`;
    }).join(',\n');

    const models = this.ast.storage.models || {};
    const migrations = this.genMigrationSQL();

    return `'use strict';
const VERSION = ${JSON.stringify(VERSION)};
const AI_PROVIDERS = ${JSON.stringify(this.ast.ai.providers || {})};
const AI_LIMITS = ${JSON.stringify(this.ast.ai.limits || {})};
const AI_SAFETY = ${JSON.stringify(this.ast.ai.safety || {})};
const MODELS = ${JSON.stringify(models)};
const ROUTES = [
${routeDefs}
];

${serverFns.join('\n\n')}

async function dbQueryAll(env, sql, params) {
  const stmt = env.AL_DB.prepare(sql);
  const bound = params && params.length ? stmt.bind(...params) : stmt;
  const result = await bound.all();
  return result.results || [];
}
async function dbQueryOne(env, sql, params) {
  const stmt = env.AL_DB.prepare(sql);
  const bound = params && params.length ? stmt.bind(...params) : stmt;
  return await bound.first();
}
async function dbInsert(env, model, data) {
  const fields = Object.keys(data);
  const placeholders = fields.map(() => '?').join(',');
  const values = fields.map(f => typeof data[f] === 'object' && data[f] !== null ? JSON.stringify(data[f]) : data[f]);
  const sql = 'INSERT INTO ' + model + ' (' + fields.join(',') + ') VALUES (' + placeholders + ')';
  return await env.AL_DB.prepare(sql).bind(...values).run();
}
async function dbUpdate(env, model, id, patch) {
  const fields = Object.keys(patch);
  const setClause = fields.map(f => f + ' = ?').join(',');
  const values = fields.map(f => typeof patch[f] === 'object' && patch[f] !== null ? JSON.stringify(patch[f]) : patch[f]);
  const sql = 'UPDATE ' + model + ' SET ' + setClause + ' WHERE id = ?';
  return await env.AL_DB.prepare(sql).bind(...values, id).run();
}
async function dbDelete(env, model, id) {
  return await env.AL_DB.prepare('DELETE FROM ' + model + ' WHERE id = ?').bind(id).run();
}
async function cacheGet(env, key) {
  if (!env.AL_KV) return null;
  return await env.AL_KV.get(key);
}
async function cacheSet(env, key, value, ttl) {
  if (!env.AL_KV) return;
  const opts = ttl ? { expirationTtl: ttl } : {};
  return await env.AL_KV.put(key, typeof value === 'string' ? value : JSON.stringify(value), opts);
}
async function cacheIncr(env, key, windowSeconds) {
  if (!env.AL_KV) return 1;
  const cur = parseInt(await env.AL_KV.get(key) || '0', 10);
  await env.AL_KV.put(key, String(cur + 1), { expirationTtl: windowSeconds });
  return cur + 1;
}
async function rateCheck(env, userId, bucket, limit) {
  const key = 'rate:' + bucket + ':' + userId;
  const count = await cacheIncr(env, key, 60);
  if (count > limit) throw new Error('rate_limit_exceeded');
  return true;
}
async function r2Put(bucket, key, data, opts) {
  return await bucket.put(key, data, opts || {});
}
async function r2Get(bucket, key) {
  return await bucket.get(key);
}
async function r2List(bucket, opts) {
  return await bucket.list(opts || {});
}
async function queuePush(queue, message) {
  return await queue.send(message);
}
async function httpGet(url, headers) {
  const res = await fetch(url, { headers: headers || {} });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}
async function httpPost(url, body, headers) {
  const res = await fetch(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}
async function httpPut(url, body, headers) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  return await res.json();
}
async function httpDel(url, headers) {
  const res = await fetch(url, { method: 'DELETE', headers: headers || {} });
  return await res.json();
}
function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}
function randomBytes(n) {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}
async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function bytesToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.substr(i, 2), 16);
  return arr;
}
function b64enc(s) {
  return btoa(unescape(encodeURIComponent(s)));
}
function b64dec(s) {
  return decodeURIComponent(escape(atob(s)));
}
async function aesGcmEncrypt(plain, keyHex, nonceHex) {
  const rawKey = hexToBytes(keyHex.padEnd(64, '0').slice(0, 64));
  const k = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const nonce = nonceHex ? hexToBytes(nonceHex) : crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, new TextEncoder().encode(plain));
  return { cipher: b64enc(String.fromCharCode(...new Uint8Array(ct))), nonce: bytesToHex(nonce) };
}
async function aesGcmDecrypt(cipherB64, keyHex, nonceHex) {
  const rawKey = hexToBytes(keyHex.padEnd(64, '0').slice(0, 64));
  const k = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const ct = Uint8Array.from(atob(cipherB64), c => c.charCodeAt(0));
  const nonce = hexToBytes(nonceHex);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, k, ct);
  return new TextDecoder().decode(pt);
}
async function encryptSecret(env, plain) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const res = await aesGcmEncrypt(plain, env.AL_MASTER_ENCRYPTION_KEY || '', bytesToHex(nonce));
  return { cipher: res.cipher, nonce: res.nonce, version: 1 };
}
async function decryptSecret(env, payload) {
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return ''; }
  }
  if (!payload || !payload.cipher) return '';
  return await aesGcmDecrypt(payload.cipher, env.AL_MASTER_ENCRYPTION_KEY || '', payload.nonce);
}
async function hashIp(env, ip) {
  return await sha256(ip + '::' + (env.AL_MASTER_ENCRYPTION_KEY || 'salt'));
}
function maskSecret(plain) {
  if (!plain || plain.length <= 6) return '••••••';
  return plain.substring(0, 3) + '••••••' + plain.substring(plain.length - 3);
}
function safeUrl(url) {
  if (typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  const blocked = ['localhost', '127.0.0.1', '::1', '0.0.0.0', '10.', '192.168.', '169.254.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.', 'metadata.google', '169.254.169.254'];
  for (const b of blocked) if (url.includes(b)) return false;
  return true;
}
async function audit(env, userId, action, resource, resourceId, result, metadata) {
  try {
    await env.AL_DB.prepare('INSERT INTO AuditLog (id, user_id, action, resource, resource_id, result, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(randomHex(8), userId, action, resource, resourceId || '', result, JSON.stringify(metadata || {}), new Date().toISOString()).run();
  } catch (e) {}
}
async function requestApproval(env, kind, resource, resourceId, payload, user) {
  const id = 'apr-' + randomHex(8);
  await env.AL_DB.prepare('INSERT INTO Approval (id, user_id, kind, resource, resource_id, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, user ? user.id : '', kind, resource, resourceId || '', JSON.stringify(payload || {}), 'pending', new Date().toISOString()).run();
  return id;
}
function aiDefaultModel(provider) {
  const p = AI_PROVIDERS[provider];
  return p && p.defaultModel ? p.defaultModel : '';
}
function aiIsKnownProvider(provider) {
  return Object.keys(AI_PROVIDERS).includes(provider);
}
async function aiTestKey(provider, key) {
  try {
    const prov = AI_PROVIDERS[provider];
    if (!prov || !prov.baseUrl) return false;
    if (provider === 'gemini') {
      const r = await httpGet('https://generativelanguage.googleapis.com/v1beta/models?key=' + key);
      return !!(r && r.models);
    }
    const r = await httpGet(prov.baseUrl + '/models', { 'Authorization': 'Bearer ' + key });
    return !!(r && r.data);
  } catch (e) { return false; }
}
async function aiGenerate(env, provider, model, prompt, opts) {
  const prov = AI_PROVIDERS[provider];
  if (!prov) throw new Error('unknown_provider');
  const key = env['AI_KEY_' + provider.toUpperCase()] || '';
  if (provider === 'gemini') {
    const r = await httpPost('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key, { contents: [{ parts: [{ text: prompt }] }] });
    return r && r.candidates && r.candidates[0] ? r.candidates[0].content.parts[0].text : '';
  }
  const r = await httpPost(prov.baseUrl + '/chat/completions', { model, messages: [{ role: 'user', content: prompt }] }, { 'Authorization': 'Bearer ' + key });
  return r && r.choices && r.choices[0] ? r.choices[0].message.content : '';
}
async function aiStream(env, provider, model, context, attachments) {
  return { stream: null, provider, model };
}
async function searchRun(env, user, query, opts) {
  return { results: [] };
}
async function pdfExtractText(data) { return ''; }
async function whisperTranscribe(env, data) { return ''; }
async function audioAnalyze(data) { return { bpm: 0, key: '', energy: 0, duration: 0 }; }
async function githubExchange(params) { return await httpPost('https://github.com/login/oauth/access_token', params, { 'Accept': 'application/json' }); }
async function googleExchange(params) { return await httpPost('https://oauth2.googleapis.com/token', params); }
async function githubProfile(token) { return await httpGet('https://api.github.com/user', { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' }); }
async function googleProfile(token) { return await httpGet('https://openidconnect.googleapis.com/v1/userinfo', { 'Authorization': 'Bearer ' + token }); }
function addDays(iso, n) { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString(); }
function addHours(iso, n) { const d = new Date(iso); d.setHours(d.getHours() + n); return d.toISOString(); }
function diffHours(a, b) { return Math.abs(new Date(a) - new Date(b)) / 3600000; }
function diffSeconds(a, b) { return Math.abs(new Date(a) - new Date(b)) / 1000; }
function endOfDay(iso) { const d = new Date(iso); d.setHours(23, 59, 59, 999); return d.toISOString(); }

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
}

function matchRoute(method, path) {
  for (const r of ROUTES) {
    if (r.method !== method) continue;
    if (r.path === path) return { route: r, params: {} };
    if (r.path.includes(':')) {
      const pattern = r.path.replace(/:[^/]+/g, '([^/]+)');
      const m = path.match(new RegExp('^' + pattern + '$'));
      if (m) {
        const params = {};
        r.params.forEach((name, i) => { params[name] = m[i + 1]; });
        return { route: r, params };
      }
    }
  }
  return null;
}

function parseCookie(header, name) {
  if (!header) return '';
  for (const p of header.split(';')) {
    const [k, v] = p.trim().split('=');
    if (k === name) return v;
  }
  return '';
}

async function handleApi(request, env, ctx, url) {
  const method = request.method;
  const matched = matchRoute(method, url.pathname);
  if (!matched) return json({ ok: false, error: 'not_found' }, 404);
  const { route, params } = matched;
  let user = null, session = null;
  if (route.auth) {
    const sid = parseCookie(request.headers.get('Cookie'), 'al_session');
    if (!sid) return json({ ok: false, error: 'unauthorized' }, 401);
    session = await env.AL_DB.prepare('SELECT * FROM Session WHERE id = ? AND revoked_at IS NULL AND expires_at > ?').bind(sid, new Date().toISOString()).first();
    if (!session) return json({ ok: false, error: 'session_expired' }, 401);
    user = await env.AL_DB.prepare('SELECT * FROM User WHERE id = ?').bind(session.user_id).first();
    if (route.csrf) {
      const csrfHeader = request.headers.get('X-CSRF-Token');
      if (csrfHeader !== session.csrf_token) return json({ ok: false, error: 'csrf_failed' }, 403);
    }
  }
  if (route.rateLimit && user) {
    try { await rateCheck(env, user.id, route.rateLimit, AI_LIMITS.maxConcurrentGenerations ? 60 : 30); }
    catch (e) { return json({ ok: false, error: 'rate_limited' }, 429); }
  }
  let body = {};
  if (method !== 'GET' && method !== 'DELETE') {
    try { body = await request.json(); } catch { body = {}; }
  }
  try {
    const result = await route.handler({ request, env, body, params, user, session, url });
    if (result instanceof Response) return result;
    return json(result);
  } catch (err) {
    return json({ ok: false, error: err.message || 'internal_error' }, 500);
  }
}

async function handleQueue(env, message) {
  const kind = message.kind;
  if (kind === 'chat.generate') return;
  if (kind === 'research.fetch') return;
  if (kind === 'file.index') return;
  if (kind === 'agent.run') return;
  if (kind === 'deploy.run') return;
  if (kind === 'memory.compact') return;
  if (kind === 'audit.flush') return;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/sw.js') {
      return new Response(env.SW_JS || '', { headers: { 'Content-Type': 'application/javascript' } });
    }
    if (url.pathname === '/api/health') return json({ ok: true, status: 'ok', version: VERSION, time: new Date().toISOString() });
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
      return handleApi(request, env, ctx, url);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
  async queue(batch, env, ctx) {
    for (const msg of batch.messages) {
      try { await handleQueue(env, msg.body); msg.ack(); }
      catch (e) { msg.retry(); }
    }
  },
  async scheduled(event, env, ctx) {
    const now = new Date().toISOString();
    await env.AL_DB.prepare('UPDATE Session SET revoked_at = ? WHERE expires_at < ? AND revoked_at IS NULL').bind(now, now).run().catch(() => {});
    await env.AL_DB.prepare('DELETE FROM Approval WHERE status = ? AND created_at < ?').bind('pending', addDays(now, -14)).run().catch(() => {});
    await env.AL_DB.prepare('DELETE FROM AuditLog WHERE created_at < ?').bind(addDays(now, -180)).run().catch(() => {});
  }
};
`;
  }
  genMigrationSQL() {
    const lines = ['CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);'];
    for (const [modelName, fields] of Object.entries(this.ast.storage.models || {})) {
      const cols = fields.map(f => {
        if (f.type === 'auto') return `${f.name} TEXT PRIMARY KEY`;
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
    return lines.join('\n');
  }
  genMigrations() {
    const sql = this.genMigrationSQL();
    this.files['migrations/0001_init.sql'] = sql;
  }
  genFrontend() {
    const screens = Object.entries(this.ast.screens).map(([name, s]) => ({
      name,
      title: s.title || name,
      body: this.renderScreenBody(s.body)
    }));
    const components = Object.entries(this.ast.components).map(([name, c]) => ({
      name,
      params: c.params,
      body: this.renderComponentBody(c.body)
    }));
    const stateDefaults = {};
    for (const [k, v] of Object.entries(this.ast.state.fields)) {
      stateDefaults[k] = this.parseStateValue(v);
    }
    const code = `'use strict';
const APP = ${JSON.stringify({ id: this.ast.app.id, name: this.ast.app.name, version: this.ast.app.version, theme: this.ast.app.theme })};
const SCREENS = ${JSON.stringify(screens)};
const COMPONENTS = ${JSON.stringify(components)};
const STATE_DEFAULTS = ${JSON.stringify(stateDefaults)};
const COMMANDS = ${JSON.stringify(Object.entries(this.ast.screens).map(([k, s]) => ({ id: k, label: s.title || k, screen: k })))};

const state = new Proxy(Object.assign({}, STATE_DEFAULTS, { _ui: { toasts: [], modal: null, screen: '${Object.keys(this.ast.screens)[0] || 'Home'}', ready: false } }), {
  set(target, prop, value) {
    target[prop] = value;
    render();
    return true;
  }
});

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' && node.tagName === 'INPUT') node.value = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  if (children) {
    if (Array.isArray(children)) children.forEach(c => c && node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    else if (typeof children === 'string') node.textContent = children;
    else if (children instanceof Node) node.appendChild(children);
  }
  return node;
}

function toast(message, type) {
  state._ui.toasts.push({ id: Date.now(), message, type: type || 'info' });
  setTimeout(() => { state._ui.toasts = state._ui.toasts.filter(t => t.id !== Date.now()); render(); }, 4000);
}

function navigate(screen) {
  state._ui.screen = screen;
  render();
}

async function api(path, method, body) {
  const opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const csrf = document.cookie.match(/al_csrf=([^;]+)/);
  if (csrf) opts.headers['X-CSRF-Token'] = csrf[1];
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error('api_error_' + res.status);
  return await res.json();
}

function renderScreen(screen) {
  const root = document.getElementById('screen');
  if (!root) return;
  root.innerHTML = '';
  root.appendChild(el('h1', { class: 'screen-title' }, screen.title));
  const body = document.createElement('div');
  body.className = 'screen-body';
  body.innerHTML = screen.body;
  root.appendChild(body);
}

function render() {
  const root = document.getElementById('app');
  if (!root) return;
  if (!state._ui.ready) {
    root.innerHTML = '<div class="loading">Ładowanie…</div>';
    return;
  }
  const nav = el('aside', { class: 'sidebar' });
  const navItems = COMMANDS.map(c => el('button', { class: 'nav-item' + (state._ui.screen === c.screen ? ' active' : ''), onclick: () => navigate(c.screen) }, c.label));
  navItems.forEach(n => nav.appendChild(n));
  const main = el('main', { class: 'main' });
  const screen = SCREENS.find(s => s.name === state._ui.screen) || SCREENS[0];
  if (screen) {
    main.appendChild(el('h1', { class: 'screen-title' }, screen.title));
    const body = document.createElement('div');
    body.className = 'screen-body';
    body.innerHTML = screen.body;
    main.appendChild(body);
  } else {
    main.appendChild(el('div', { class: 'empty' }, 'Wybierz ekran z listy po lewej'));
  }
  const toasts = el('div', { class: 'toasts' });
  for (const t of state._ui.toasts) {
    toasts.appendChild(el('div', { class: 'toast toast-' + t.type }, t.message));
  }
  root.innerHTML = '';
  root.appendChild(nav);
  root.appendChild(main);
  root.appendChild(toasts);
}

function openCommandPalette() {
  const current = document.getElementById('cmd-palette');
  if (current) return current.remove();
  const input = el('input', { class: 'cmd-input', placeholder: 'Szukaj ekranów…' });
  const list = el('div', { class: 'cmd-list' });
  const filter = () => {
    list.innerHTML = '';
    const q = input.value.toLowerCase();
    COMMANDS.filter(c => c.label.toLowerCase().includes(q) || c.screen.toLowerCase().includes(q)).forEach(c => {
      list.appendChild(el('button', { class: 'cmd-item', onclick: () => { navigate(c.screen); document.getElementById('cmd-palette').remove(); } }, c.label));
    });
  };
  input.addEventListener('input', filter);
  filter();
  const modal = el('div', { id: 'cmd-palette', class: 'cmd-palette' }, [input, list]);
  document.body.appendChild(modal);
  input.focus();
}

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openCommandPalette(); }
});

async function boot() {
  try {
    const s = await api('/api/session');
    if (s && s.ok) {
      Object.assign(state, s.body.user);
      state.sessionId = s.body.sessionId;
      state._ui.ready = true;
    } else {
      state._ui.ready = true;
      state._ui.screen = COMMANDS[0] ? COMMANDS[0].screen : null;
    }
  } catch (e) {
    state._ui.ready = true;
  }
  render();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

document.addEventListener('DOMContentLoaded', boot);
`;
    this.files['assets/app.js'] = code;
  }
  renderScreenBody(body) {
    let html = '';
    const stack = [];
    const lines = body.split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const openBlock = line.match(/^(\w+)(?:\s+"([^"]*)")?\s*\{$/);
      if (openBlock) {
        const tag = this.htmlTag(openBlock[1]);
        const label = openBlock[2] || '';
        html += `<${tag} class="el-${openBlock[1]}">`;
        if (label) html += `<span class="el-label">${this.escape(label)}</span>`;
        stack.push(tag);
        continue;
      }
      if (line === '}') { if (stack.length) html += `</${stack.pop()}>`; continue; }
      const kv = line.match(/^(\w+)\s+(.+)$/);
      if (kv) {
        const [, k, v] = kv;
        html += `<div class="prop prop-${k}"><span class="prop-key">${this.escape(k)}</span><span class="prop-val">${this.escape(v.replace(/^"|"$/g, ''))}</span></div>`;
        continue;
      }
      html += `<div class="line">${this.escape(line)}</div>`;
    }
    while (stack.length) html += `</${stack.pop()}>`;
    return html;
  }
  renderComponentBody(body) {
    return this.renderScreenBody(body);
  }
  htmlTag(name) {
    const map = { button: 'button', input: 'input', textarea: 'textarea', select: 'select', card: 'div', row: 'div', column: 'div', list: 'ul', surface: 'div', dialog: 'div', overlay: 'div', pill: 'span', badge: 'span', tabs: 'div', table: 'table', code: 'pre', markdown: 'div', md: 'div', image: 'img', audio: 'audio', video: 'video', chart: 'canvas', progress: 'progress', checkbox: 'input', toggle: 'input', switch: 'input', slider: 'input', header: 'header', footer: 'footer', nav: 'nav', section: 'section', field: 'div', label: 'label', title: 'h2', subtitle: 'p', hint: 'small', meta: 'small', spinner: 'div', loader: 'div', divider: 'hr', hr: 'hr' };
    return map[name] || 'div';
  }
  parseStateValue(v) {
    v = v.trim();
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
    if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
    if (v.startsWith('list<')) {
      const m = v.match(/\[(.*)\]/);
      if (m) try { return JSON.parse('[' + m[1] + ']'); } catch { return []; }
    }
    if (v.startsWith('map')) {
      const m = v.match(/\{(.*)\}/);
      if (m) try { return JSON.parse('{' + m[1] + '}'); } catch { return {}; }
    }
    return v;
  }
  escape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  genCSS() {
    const colors = this.ast.theme.colors || {};
    const typography = this.ast.theme.typography || {};
    const shape = this.ast.theme.shape || {};
    const motion = this.ast.theme.motion || {};
    const spacing = this.ast.theme.spacing || {};
    const cssVars = [];
    for (const [k, v] of Object.entries(colors)) cssVars.push(`  --color-${k}: ${v};`);
    for (const [k, v] of Object.entries(typography)) cssVars.push(`  --font-${k.replace(/\./g, '-')}: ${v};`);
    for (const [k, v] of Object.entries(shape)) {
      if (typeof v === 'string' && (v.startsWith('0 ') || v.includes('px') || v.includes('rgba'))) cssVars.push(`  --shape-${k.replace(/\./g, '-')}: ${v};`);
      else cssVars.push(`  --shape-${k.replace(/\./g, '-')}: ${v}${typeof v === 'number' ? 'px' : ''};`);
    }
    for (const [k, v] of Object.entries(motion)) {
      if (typeof v === 'string' && (v.includes('ms') || v.includes('cubic'))) cssVars.push(`  --motion-${k}: ${v};`);
    }
    for (const [k, v] of Object.entries(spacing)) cssVars.push(`  --space-${k}: ${v}px;`);

    const css = `*{box-sizing:border-box;margin:0;padding:0}
:root{
${cssVars.join('\n')}
}
html,body{height:100%;font-family:var(--font-base,"Inter",system-ui,sans-serif);background:var(--color-background,#0a0f1e);color:var(--color-text,#eaf2ff);line-height:1.5}
#app{display:flex;height:100vh;overflow:hidden}
.sidebar{width:280px;background:var(--color-surface,#121a2e);border-right:1px solid var(--color-border,#1f2a44);padding:16px;overflow-y:auto}
.nav-item{display:block;width:100%;padding:10px 14px;margin-bottom:4px;background:transparent;border:none;color:var(--color-text-muted,#93a1c4);text-align:left;cursor:pointer;border-radius:var(--shape-radius-md,14px);font-size:14px;transition:background 0.2s}
.nav-item:hover{background:var(--color-surface-elevated,#17213a);color:var(--color-text,#eaf2ff)}
.nav-item.active{background:var(--color-primary,#00e5ff);color:var(--color-text-inverse,#04121b)}
.main{flex:1;padding:24px;overflow-y:auto}
.screen-title{font-family:var(--font-heading,"Space Grotesk",sans-serif);font-size:28px;margin-bottom:24px;color:var(--color-text,#eaf2ff)}
.screen-body{display:flex;flex-direction:column;gap:16px}
.el-card{background:var(--color-surface,#121a2e);border:1px solid var(--color-border,#1f2a44);border-radius:var(--shape-radius-md,14px);padding:20px}
.el-button{background:var(--color-primary,#00e5ff);color:var(--color-text-inverse,#04121b);border:none;padding:10px 18px;border-radius:var(--shape-radius-sm,10px);cursor:pointer;font-weight:600;font-size:14px}
.el-button:hover{background:var(--color-primary-pressed,#00b8cc)}
.el-input,.el-textarea,.el-select{background:var(--color-surface-muted,#0e1526);border:1px solid var(--color-border,#1f2a44);border-radius:var(--shape-radius-sm,10px);color:var(--color-text,#eaf2ff);padding:10px 14px;font-size:14px;width:100%}
.el-input:focus,.el-textarea:focus{outline:none;border-color:var(--color-border-focus,#00e5ff)}
.el-row{display:flex;gap:12px;align-items:center}
.el-column{display:flex;flex-direction:column;gap:12px}
.el-list{list-style:none;display:flex;flex-direction:column;gap:8px}
.el-badge{display:inline-block;padding:2px 8px;background:var(--color-surface-muted,#0e1526);border-radius:999px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em}
.el-pill{display:inline-block;padding:4px 12px;background:var(--color-surface-muted,#0e1526);border-radius:999px;font-size:12px}
.el-code{background:var(--color-surface-muted,#0e1526);padding:12px;border-radius:var(--shape-radius-sm,10px);font-family:var(--font-mono,"JetBrains Mono",monospace);font-size:13px;overflow-x:auto;white-space:pre-wrap}
.el-title{font-size:18px;font-weight:600;color:var(--color-text,#eaf2ff)}
.el-subtitle{font-size:14px;color:var(--color-text-muted,#93a1c4)}
.el-hint{font-size:12px;color:var(--color-text-muted,#93a1c4)}
.el-meta{font-size:11px;color:var(--color-text-muted,#93a1c4)}
.el-spinner{display:inline-block;width:20px;height:20px;border:2px solid var(--color-border,#1f2a44);border-top-color:var(--color-primary,#00e5ff);border-radius:50%;animation:spin 0.8s linear infinite}
.el-divider{border:none;border-top:1px solid var(--color-border,#1f2a44);margin:8px 0}
.el-progress{width:100%;height:8px;background:var(--color-surface-muted,#0e1526);border-radius:999px;overflow:hidden}
.el-progress::-webkit-progress-bar{background:var(--color-surface-muted,#0e1526)}
.el-progress::-webkit-progress-value{background:var(--color-primary,#00e5ff)}
.el-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:100}
.el-dialog{background:var(--color-surface,#121a2e);border-radius:var(--shape-radius-lg,20px);padding:32px;max-width:640px;width:90%;max-height:80vh;overflow-y:auto}
.el-toggle{appearance:none;width:40px;height:22px;background:var(--color-surface-muted,#0e1526);border-radius:999px;position:relative;cursor:pointer}
.el-toggle:checked{background:var(--color-primary,#00e5ff)}
.el-toggle::before{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;background:var(--color-text,#eaf2ff);border-radius:50%;transition:left 0.2s}
.el-toggle:checked::before{left:20px}
.cmd-palette{position:fixed;top:20%;left:50%;transform:translateX(-50%);background:var(--color-surface,#121a2e);border:1px solid var(--color-border,#1f2a44);border-radius:var(--shape-radius-lg,20px);box-shadow:0 24px 72px rgba(0,0,0,0.55);width:640px;max-width:90%;max-height:60vh;display:flex;flex-direction:column;overflow:hidden;z-index:200}
.cmd-input{padding:16px 20px;background:var(--color-surface-muted,#0e1526);border:none;color:var(--color-text,#eaf2ff);font-size:16px;outline:none}
.cmd-list{overflow-y:auto;max-height:50vh;padding:8px}
.cmd-item{display:block;width:100%;padding:12px 16px;background:transparent;border:none;color:var(--color-text,#eaf2ff);text-align:left;cursor:pointer;border-radius:var(--shape-radius-sm,10px);font-size:14px}
.cmd-item:hover{background:var(--color-surface-elevated,#17213a)}
.toasts{position:fixed;bottom:24px;right:24px;display:flex;flex-direction:column;gap:8px;z-index:300}
.toast{padding:12px 20px;background:var(--color-surface-elevated,#17213a);border-radius:var(--shape-radius-md,14px);box-shadow:0 8px 24px rgba(0,0,0,0.35);font-size:14px;border-left:3px solid var(--color-primary,#00e5ff)}
.toast-success{border-left-color:var(--color-success,#22e39a)}
.toast-danger{border-left-color:var(--color-danger,#ff4d6d)}
.toast-warning{border-left-color:var(--color-warning,#ffb547)}
.toast-info{border-left-color:var(--color-info,#4da3ff)}
.loading,.empty{display:flex;align-items:center;justify-content:center;padding:48px;color:var(--color-text-muted,#93a1c4);font-size:16px}
.prop{display:flex;gap:12px;padding:4px 0;font-size:13px}
.prop-key{color:var(--color-text-muted,#93a1c4);min-width:100px}
.prop-val{color:var(--color-text,#eaf2ff)}
.el-label{display:block;font-weight:600;margin-bottom:8px}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){*{animation-duration:0.01ms!important;transition-duration:0.01ms!important}}
@media (max-width: 768px){#app{flex-direction:column}.sidebar{width:100%;height:auto;border-right:none;border-bottom:1px solid var(--color-border,#1f2a44);display:flex;flex-direction:row;overflow-x:auto;padding:8px}.nav-item{width:auto;white-space:nowrap}.main{padding:16px}}
`;
    this.files['assets/app.css'] = css;
  }
  genAssets() {
    const manifest = {
      name: this.ast.app.name || 'AL2100',
      short_name: this.ast.app.name || 'AL2100',
      description: 'Aplikacja AXCode',
      start_url: '/',
      display: 'standalone',
      background_color: (this.ast.theme.colors && this.ast.theme.colors.background) || '#0a0f1e',
      theme_color: (this.ast.theme.colors && this.ast.theme.colors.primary) || '#00e5ff',
      orientation: 'portrait-primary',
      icons: [
        { src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png' }
      ]
    };
    this.files['assets/manifest.webmanifest'] = JSON.stringify(manifest, null, 2);
    this.files['assets/sw.js'] = `'use strict';
const CACHE = 'axcode-v1';
const PRECACHE = ['/', '/assets/app.js', '/assets/app.css', '/assets/manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE))); self.skipWaiting(); });
self.addEventListener('activate', e => { self.clients.claim(); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    if (res.ok && e.request.url.startsWith(location.origin)) {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
    }
    return res;
  }).catch(() => caches.match('/'))));
});
`;
  }
  genHTML() {
    const title = (this.ast.app && this.ast.app.name) || 'AXCode App';
    this.files['index.html'] = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="${(this.ast.theme.colors && this.ast.theme.colors.primary) || '#00e5ff'}">
<title>${this.escapeHtml(title)}</title>
<link rel="manifest" href="/assets/manifest.webmanifest">
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div id="app"></div>
<script src="/assets/app.js" type="module"></script>
</body>
</html>`;
  }
  escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  genWrangler() {
    const workerName = (this.ast.cloudflare && this.ast.cloudflare.name) || (this.ast.app && this.ast.app.id) || 'axcode-app';
    const toml = `name = "${workerName}"
main = "worker.js"
compatibility_date = "2026-10-30"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./assets"
binding = "ASSETS"

[[d1_databases]]
binding = "AL_DB"
database_name = "${workerName}-db"
database_id = ""

[[r2_buckets]]
binding = "AL_BUCKET"
bucket_name = "${workerName}-bucket"

[[kv_namespaces]]
binding = "AL_KV"
id = ""

[[queues.producers]]
binding = "AL_QUEUE"
queue = "${workerName}-jobs"

[[queues.consumers]]
queue = "${workerName}-jobs"
max_batch_size = 10
max_batch_timeout = 5
`;
    this.files['wrangler.toml'] = toml;
  }
}

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
      else console.error('[AXC_FATAL]', e.message);
      return 1;
    }
  }
  static printHelp() {
    console.log(`AXCode Compiler v${VERSION}

Użycie:
  axc <command> [file.ax] [options]

Komendy:
  check      Analiza składni i semantyki
  lint       Analiza + ostrzeżenia
  build      Kompilacja do /dist
  dev        Build + uruchomienie dev servera
  deploy     Build + deploy na Cloudflare (wrangler)
  format     Formatowanie pliku .ax
  watch      Tryb watch — rekompilacja przy zmianie

Opcje:
  --strict       Traktuj ostrzeżenia jak błędy
  --no-minify    Wyłącz minifikację
  --out=<dir>    Katalog wyjściowy (default: dist)
  --watch        Watch mode dla build
`);
  }
  static readAndParse(file) {
    if (!fs.existsSync(file)) throw new AxcError(`Plik nie istnieje: ${file}`, 0, 0, 'Podaj ścieżkę do pliku .ax', 'AXC_NO_FILE');
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
    const { errors, warnings } = this.analyze(file, flags);
    const t0 = Date.now();
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
    console.log(`\nPodsumowanie: ${Object.keys(ast.screens).length} ekranów, ${Object.keys(ast.components).length} komponentów, ${ast.logic.functions.length} funkcji, ${ast.apis.length} API, ${Object.keys(ast.storage.models).length} modeli`);
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
    console.log('\nDev server: http://localhost:8787');
    console.log('Uruchamiam wrangler dev…\n');
    const child = spawn('npx', ['wrangler', 'dev', '--local'], { cwd: outDir, stdio: 'inherit' });
    return new Promise(resolve => child.on('exit', c => resolve(c || 0)));
  }
  static async deploy(file, flags) {
    const code = this.build(file, flags);
    if (code !== 0) return code;
    const outDir = path.resolve(ROOT, flags.out);
    console.log('\nDeploy: potwierdź w terminalu (wrangler deploy)\n');
    const child = spawn('npx', ['wrangler', 'deploy'], { cwd: outDir, stdio: 'inherit' });
    return new Promise(resolve => child.on('exit', c => resolve(c || 0)));
  }
  static format(file, flags) {
    const { ast } = this.readAndParse(file);
    const src = fs.readFileSync(file, 'utf8');
    let out = src;
    out = out.replace(/[ \t]+\n/g, '\n');
    out = out.replace(/\n{3,}/g, '\n\n');
    out = out.replace(/ +\}/g, ' }');
    out = out.replace(/\{\n+/g, ' {\n');
    if (!out.endsWith('\n')) out += '\n';
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
      console.log(`\nZmiana: ${file} — rekompilacja…`);
      run();
    });
    return new Promise(() => {});
  }
}

if (require.main === module) {
  CLI.run(process.argv).then(code => process.exit(code)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { Lexer, Parser, Merger, Analyzer, Translator, Generator, CLI, AxcError, VERSION };
