#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const VERSION = '4.0.0';
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
    else if (this.peek().type === T.IDENT && this.tokens[this.pos + 1] && !['{', ':'].includes(this.tokens[this.pos + 1].type)) block.label = this.next().value;
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
    ai.safety = { confirmBeforeDelete: true, confirmBeforeDeploy: true, confirmBeforePush: true, confirmBeforeExternalCall: true, hideSecrets: true, redactLogs: true, blockUnknownProviders: true, ...ai.safety };
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

class Generator {
  constructor(ast) {
    this.ast = ast;
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
    this.genPackageJson();
    const written = [];
    for (const [rel, content] of Object.entries(this.files)) {
      const full = path.join(outDir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
      written.push(rel);
    }
    return written;
  }
  genWorker() {
    const models = this.ast.storage.models || {};
    const appName = (this.ast.app && this.ast.app.name) || 'AL2100';
    const appId = (this.ast.app && this.ast.app.id) || 'pl.axel.al2100';

    const worker = `'use strict';
const VERSION = '${VERSION}';
const APP_NAME = ${JSON.stringify(appName)};
const APP_ID = ${JSON.stringify(appId)};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token' }
  });
}

function addDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function dbQueryAll(env, sql, params = []) {
  const stmt = env.AL_DB.prepare(sql);
  const res = params.length ? await stmt.bind(...params).all() : await stmt.all();
  return res.results || [];
}

async function dbQueryOne(env, sql, params = []) {
  const stmt = env.AL_DB.prepare(sql);
  return params.length ? await stmt.bind(...params).first() : await stmt.first();
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
  const keyMaterial = env.AL_MASTER_ENCRYPTION_KEY || 'fallback-dev-key-change-me-32chars!!';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(keyMaterial.slice(0, 32)), { name: 'AES-GCM' }, false, ['encrypt']);
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
  const keyMaterial = env.AL_MASTER_ENCRYPTION_KEY || 'fallback-dev-key-change-me-32chars!!';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(keyMaterial.slice(0, 32)), { name: 'AES-GCM' }, false, ['decrypt']);
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

async function requestApproval(env, kind, resource, resourceId, payload, user) {
  const id = 'appr-' + crypto.randomUUID();
  await dbInsert(env, 'Approval', {
    id,
    user_id: user.id,
    kind,
    resource,
    resource_id: resourceId,
    payload: JSON.stringify(payload || {}),
    status: 'pending',
    created_at: new Date().toISOString()
  });
  return id;
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

async function handleApi(request, env, ctx, url) {
  const method = request.method;
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-CSRF-Token' } });

  const path = url.pathname;
  const sessionData = await getSession(env, request);
  const user = sessionData ? sessionData.user : null;
  const session = sessionData ? sessionData.session : null;

  if (path === '/api/health') return json({ ok: true, status: 'ok', version: VERSION, time: new Date().toISOString() });

  if (path === '/api/session' && method === 'GET') {
    if (!user) return json({ ok: false }, 401);
    return json({ ok: true, body: { sessionId: session.id, csrfToken: session.csrf_token, expiresAt: session.expires_at, user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatar_url } } });
  }

  if (path === '/api/logout' && method === 'POST') {
    if (session) await dbUpdate(env, 'Session', session.id, { revoked_at: new Date().toISOString() });
    return json({ ok: true });
  }

  if (path.startsWith('/api/') && !user && !path.startsWith('/api/auth')) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  if (path === '/api/conversations' && method === 'GET') {
    const items = await dbQueryAll(env, 'SELECT * FROM Conversation WHERE user_id = ? ORDER BY last_message_at DESC LIMIT 100', [user.id]);
    return json({ ok: true, body: { items } });
  }

  if (path === '/api/conversations' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const id = 'conv-' + crypto.randomUUID();
    const now = new Date().toISOString();
    await dbInsert(env, 'Conversation', {
      id, user_id: user.id, title: body.title || 'Nowa rozmowa', archived: 0, private_mode: body.private_mode ? 1 : 0,
      web_search: body.web_search !== false ? 1 : 0, created_at: now, updated_at: now, last_message_at: now, tokens_used: 0
    });
    await audit(env, user.id, 'conversation.create', 'Conversation', id, 'success', {});
    return json({ ok: true, body: { id, title: body.title || 'Nowa rozmowa' } });
  }

  if (path.match(/^\/api\/conversations\/[^/]+$/) && method === 'GET') {
    const id = path.split('/').pop();
    const conv = await dbQueryOne(env, 'SELECT * FROM Conversation WHERE id = ? AND user_id = ?', [id, user.id]);
    if (!conv) return json({ ok: false }, 404);
    return json({ ok: true, body: conv });
  }

  if (path.match(/^\/api\/conversations\/[^/]+\/messages$/) && method === 'GET') {
    const id = path.split('/')[3];
    const items = await dbQueryAll(env, 'SELECT * FROM Message WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 500', [id]);
    return json({ ok: true, body: { items } });
  }

  if (path === '/api/projects' && method === 'GET') {
    const items = await dbQueryAll(env, 'SELECT * FROM Project WHERE user_id = ? ORDER BY updated_at DESC', [user.id]);
    return json({ ok: true, body: { items } });
  }

  if (path === '/api/tasks' && method === 'GET') {
    const items = await dbQueryAll(env, 'SELECT * FROM Task WHERE user_id = ? ORDER BY created_at DESC', [user.id]);
    return json({ ok: true, body: { items } });
  }

  if (path === '/api/memory' && method === 'GET') {
    const items = await dbQueryAll(env, 'SELECT * FROM MemoryEntry WHERE user_id = ? ORDER BY importance DESC, updated_at DESC LIMIT 200', [user.id]);
    return json({ ok: true, body: { items } });
  }

  if (path === '/api/credentials' && method === 'GET') {
    const rows = await dbQueryAll(env, "SELECT * FROM ProviderKey WHERE user_id = ? AND status != 'deleted'", [user.id]);
    const aiKeys = {};
    const searchKeys = {};
    for (const p of ['gemini', 'groq', 'mistral', 'openrouter', 'cloudflare', 'anthropic', 'openai']) {
      aiKeys[p] = { configured: false, masked: '', status: 'unset', lastTested: '' };
    }
    for (const p of ['brave', 'serper', 'tavily', 'cloudflare']) {
      searchKeys[p] = { configured: false, masked: '', status: 'unset', lastTested: '' };
    }
    for (const r of rows) {
      try {
        const plain = await decryptSecret(env, { cipher: r.encrypted_key, nonce: r.nonce });
        const target = r.kind === 'search' ? searchKeys : aiKeys;
        if (target[r.provider]) {
          target[r.provider] = { configured: true, masked: maskSecret(plain), status: r.status, lastTested: r.last_tested_at || '' };
        }
      } catch (e) {}
    }
    return json({ ok: true, body: { aiKeys, searchKeys, oauth: {}, cloudflare: {} } });
  }

  return json({ ok: false, error: 'not_found' }, 404);
}

async function handleQueue(env, message) {
  const kind = message.kind;
  return;
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
    if (url.pathname === '/') {
      return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
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
    await env.AL_DB.prepare("DELETE FROM Approval WHERE status = 'pending' AND created_at < ?").bind(addDays(now, -14)).run().catch(() => {});
    await env.AL_DB.prepare('DELETE FROM AuditLog WHERE created_at < ?').bind(addDays(now, -180)).run().catch(() => {});
  }
};
`;
    this.files['worker.js'] = worker;
  }
  genMigrationSQL() {
    const lines = ['CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);'];
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
    return lines.join('\n');
  }
  genMigrations() {
    this.files['migrations/0001_init.sql'] = this.genMigrationSQL();
  }
  genFrontend() {
    const screens = Object.entries(this.ast.screens).map(([name, s]) => ({
      name,
      title: s.title || name,
      body: this.renderScreenBody(s.body)
    }));
    const stateDefaults = {};
    for (const [k, v] of Object.entries(this.ast.state.fields || {})) {
      stateDefaults[k] = this.parseStateValue(v);
    }
    const firstScreen = Object.keys(this.ast.screens)[0] || 'Login';
    const code = `'use strict';
const APP = ${JSON.stringify({ id: this.ast.app?.id, name: this.ast.app?.name, version: this.ast.app?.version })};
const SCREENS = ${JSON.stringify(screens)};
const STATE_DEFAULTS = ${JSON.stringify(stateDefaults)};
const COMMANDS = ${JSON.stringify(Object.entries(this.ast.screens).map(([k, s]) => ({ id: k, label: s.title || k, screen: k })))};

const state = new Proxy(Object.assign({}, STATE_DEFAULTS, { _ui: { toasts: [], modal: null, screen: '${firstScreen}', ready: false } }), {
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
    else if (k === 'value' && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA')) node.value = v;
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
  const id = Date.now();
  state._ui.toasts = [...state._ui.toasts, { id, message, type: type || 'info' }];
  setTimeout(() => { state._ui.toasts = state._ui.toasts.filter(t => t.id !== id); }, 4000);
}

function navigate(screen) {
  state._ui.screen = screen;
}

async function api(path, method, body) {
  const opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'include' };
  if (body) opts.body = JSON.stringify(body);
  const csrf = document.cookie.match(/al_csrf=([^;]+)/);
  if (csrf) opts.headers['X-CSRF-Token'] = csrf[1];
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'api_error_' + res.status);
  return data;
}

function render() {
  const root = document.getElementById('app');
  if (!root) return;
  if (!state._ui.ready) {
    root.innerHTML = '<div class="loading">Ładowanie AL2100…</div>';
    return;
  }
  const nav = el('aside', { class: 'sidebar' });
  COMMANDS.forEach(c => {
    nav.appendChild(el('button', {
      class: 'nav-item' + (state._ui.screen === c.screen ? ' active' : ''),
      onclick: () => navigate(c.screen)
    }, c.label));
  });
  const main = el('main', { class: 'main' });
  const screen = SCREENS.find(s => s.name === state._ui.screen) || SCREENS[0];
  if (screen) {
    main.appendChild(el('h1', { class: 'screen-title' }, screen.title));
    const body = document.createElement('div');
    body.className = 'screen-body';
    body.innerHTML = screen.body;
    main.appendChild(body);
  }
  const toasts = el('div', { class: 'toasts' });
  state._ui.toasts.forEach(t => toasts.appendChild(el('div', { class: 'toast toast-' + t.type }, t.message)));
  root.innerHTML = '';
  root.appendChild(nav);
  root.appendChild(main);
  root.appendChild(toasts);
}

function openCommandPalette() {
  const existing = document.getElementById('cmd-palette');
  if (existing) return existing.remove();
  const input = el('input', { class: 'cmd-input', placeholder: 'Szukaj ekranów…' });
  const list = el('div', { class: 'cmd-list' });
  const filter = () => {
    list.innerHTML = '';
    const q = input.value.toLowerCase();
    COMMANDS.filter(c => c.label.toLowerCase().includes(q) || c.screen.toLowerCase().includes(q)).forEach(c => {
      list.appendChild(el('button', { class: 'cmd-item', onclick: () => { navigate(c.screen); document.getElementById('cmd-palette')?.remove(); } }, c.label));
    });
  };
  input.addEventListener('input', filter);
  filter();
  document.body.appendChild(el('div', { id: 'cmd-palette', class: 'cmd-palette' }, [input, list]));
  input.focus();
}

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openCommandPalette(); }
});

async function boot() {
  try {
    const s = await api('/api/session');
    if (s && s.ok) {
      Object.assign(state, s.body.user || {});
      state.sessionId = s.body.sessionId;
    }
  } catch (e) {}
  state._ui.ready = true;
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
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const openBlock = line.match(/^(\w+)(?:\s+"([^"]*)")?\s*\{$/);
      if (openBlock) {
        const tag = this.htmlTag(openBlock[1]);
        html += `<${tag} class="el-${openBlock[1]}">`;
        if (openBlock[2]) html += `<span class="el-label">${this.escape(openBlock[2])}</span>`;
        stack.push(tag);
        continue;
      }
      if (line === '}') { if (stack.length) html += `</${stack.pop()}>`; continue; }
      const kv = line.match(/^(\w+)\s+(.+)$/);
      if (kv) {
        html += `<div class="prop prop-${kv[1]}"><span class="prop-key">${this.escape(kv[1])}</span><span class="prop-val">${this.escape(kv[2].replace(/^"|"$/g, ''))}</span></div>`;
        continue;
      }
      html += `<div class="line">${this.escape(line)}</div>`;
    }
    while (stack.length) html += `</${stack.pop()}>`;
    return html;
  }
  htmlTag(name) {
    const map = { button: 'button', input: 'input', textarea: 'textarea', select: 'select', card: 'div', row: 'div', column: 'div', list: 'ul', surface: 'div', dialog: 'div', overlay: 'div', badge: 'span', header: 'header', footer: 'footer', sidebar: 'aside', main: 'main', panel: 'div' };
    return map[name] || 'div';
  }
  parseStateValue(v) {
    v = String(v).trim();
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(v)) return parseFloat(v);
    if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
    if (v.startsWith('list<')) return [];
    if (v.startsWith('map')) return {};
    return v;
  }
  escape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  genCSS() {
    const colors = this.ast.theme.colors || {};
    const cssVars = Object.entries(colors).map(([k, v]) => `  --color-${k}: ${v};`).join('\n');
    const css = `*{box-sizing:border-box;margin:0;padding:0}
:root{
${cssVars}
  --color-background: ${colors.background || '#0A0F1E'};
  --color-surface: ${colors.surface || '#121A2E'};
  --color-text: ${colors.text || '#EAF2FF'};
  --color-primary: ${colors.primary || '#00E5FF'};
  --color-border: ${colors.border || '#1F2A44'};
}
html,body{height:100%;font-family:Inter,system-ui,sans-serif;background:var(--color-background);color:var(--color-text);line-height:1.5}
#app{display:flex;height:100vh;overflow:hidden}
.sidebar{width:280px;background:var(--color-surface);border-right:1px solid var(--color-border);padding:16px;overflow-y:auto}
.nav-item{display:block;width:100%;padding:10px 14px;margin-bottom:4px;background:transparent;border:none;color:#93A1C4;text-align:left;cursor:pointer;border-radius:14px;font-size:14px}
.nav-item:hover{background:#17213A;color:var(--color-text)}
.nav-item.active{background:var(--color-primary);color:#04121B}
.main{flex:1;padding:24px;overflow-y:auto}
.screen-title{font-family:"Space Grotesk",sans-serif;font-size:28px;margin-bottom:24px}
.screen-body{display:flex;flex-direction:column;gap:16px}
.el-card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:14px;padding:20px}
.el-button{background:var(--color-primary);color:#04121B;border:none;padding:10px 18px;border-radius:10px;cursor:pointer;font-weight:600}
.loading,.empty{display:flex;align-items:center;justify-content:center;padding:48px;color:#93A1C4}
.cmd-palette{position:fixed;top:20%;left:50%;transform:translateX(-50%);background:var(--color-surface);border:1px solid var(--color-border);border-radius:20px;width:640px;max-width:90%;z-index:300;overflow:hidden}
.cmd-input{padding:16px 20px;background:#0E1526;border:none;color:var(--color-text);font-size:16px;outline:none;width:100%}
.cmd-list{overflow-y:auto;max-height:50vh;padding:8px}
.cmd-item{display:block;width:100%;padding:12px 16px;background:transparent;border:none;color:var(--color-text);text-align:left;cursor:pointer;border-radius:10px}
.cmd-item:hover{background:#17213A}
.toasts{position:fixed;bottom:24px;right:24px;display:flex;flex-direction:column;gap:8px;z-index:300}
.toast{padding:12px 20px;background:#17213A;border-radius:14px;font-size:14px;border-left:3px solid var(--color-primary)}
.toast-success{border-left-color:#22E39A}
.toast-danger{border-left-color:#FF4D6D}
@media (max-width:768px){#app{flex-direction:column}.sidebar{width:100%;height:auto;border-right:none;border-bottom:1px solid var(--color-border);display:flex;overflow-x:auto}}
`;
    this.files['assets/app.css'] = css;
  }
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
const CACHE = 'al2100-v4';
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
    const title = this.ast.app?.name || 'AL2100';
    this.files['index.html'] = `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="${this.ast.theme?.colors?.primary || '#00E5FF'}">
<title>${this.escape(title)}</title>
<link rel="manifest" href="/assets/manifest.webmanifest">
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div id="app"></div>
<script src="/assets/app.js" type="module"></script>
</body>
</html>`;
  }
  genWrangler() {
    const name = (this.ast.app?.id || 'al2100').replace(/\./g, '-');
    this.files['wrangler.toml'] = `name = "${name}"
main = "worker.js"
compatibility_date = "2026-10-30"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./"
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
        deploy: 'npx wrangler deploy'
      },
      devDependencies: {
        wrangler: '^3.0.0'
      }
    }, null, 2);
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
    console.log(`AXCode Compiler v${VERSION} — Ultra Ultimate

Użycie:
  node axc.js <command> [file.ax] [options]

Komendy:
  check      Analiza składni i semantyki
  lint       Analiza + ostrzeżenia + podsumowanie
  build      Kompilacja do /dist
  dev        Build + lokalny wrangler
  deploy     Build + deploy (wymaga potwierdzenia)
  format     Formatowanie pliku .ax
  watch      Rekompilacja przy zmianie

Opcje:
  --strict       Ostrzeżenia = błędy
  --no-minify    Bez minifikacji
  --out=<dir>    Katalog wyjściowy (domyślnie dist)
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
    console.log(`\nPodsumowanie: ${Object.keys(ast.screens).length} ekranów, ${Object.keys(ast.components).length} komponentów, ${ast.logic.functions.length} funkcji, ${ast.apis.length} API, ${ast.queues.length} kolejek, ${ast.crons.length} cronów`);
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
    console.log('\nDeploy wymaga potwierdzenia. Uruchom ręcznie:');
    console.log('  cd dist && npx wrangler deploy');
    return 0;
  }
  static format(file, flags) {
    const src = fs.readFileSync(file, 'utf8');
    let out = src.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
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

module.exports = { Lexer, Parser, Merger, Analyzer, Generator, CLI, AxcError, VERSION };
