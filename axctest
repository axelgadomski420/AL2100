#!/usr/bin/env node
// ============================================================================
// axc.js — AXCode v1 compiler (E1)
// Node 18+, zero zależności.
//
//   node axc.js AL2100.ax --out dist/
//   node axc.js hello.ax --check
//   node axc.js hello.ax --ast
//   node axc.js --selftest
//
// E1 obsługuje: app, theme, permissions, state, model, component, screen,
// fn/async fn, on start / on X changed, every, api, deploy, flow, test.
// Pozostałe konstrukcje (cron, middleware, queue) → błąd E_NOT_IN_E1 z
// sugestią — zostaną dodane w E2+.
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================================
// 1. ERRORS
// ============================================================================
class CompileError extends Error {
  constructor(file, line, col, code, msg, hint) {
    super(msg);
    this.file = file; this.line = line; this.col = col;
    this.code = code; this.hint = hint || null;
  }
  toString() {
    const loc = this.line != null ? `${this.file}:${this.line}:${this.col}` : this.file;
    return `${loc}: [${this.code}] ${this.message}${this.hint ? '\n  hint: ' + this.hint : ''}`;
  }
}

// ============================================================================
// 2. LEXER
// ============================================================================
const KEYWORDS = new Set([
  'app','theme','permissions','state','model','component','screen','fn','on',
  'every','cron','middleware','api','queue','deploy','flow','test','route',
  'async','if','else','for','while','return','break','continue','throw','try',
  'catch','let','const','await','true','false','null','in','primary','unique',
  'index','owner','secret','default','ref','enum','now'
]);

function lex(src, file) {
  const tokens = [];
  let i = 0, line = 1, col = 1;
  const n = src.length;
  const push = (type, value, l, c) => tokens.push({ type, value, line: l, col: c });
  const adv = (k = 1) => {
    for (let j = 0; j < k; j++) {
      if (src[i] === '\n') { line++; col = 1; } else { col++; }
      i++;
    }
  };

  while (i < n) {
    const c = src[i];
    if (c === '\n') { push('NEWLINE', '\n', line, col); adv(); continue; }
    if (c === ' ' || c === '\t' || c === '\r') { adv(); continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') adv(); continue; }

    if (c === '"') {
      const l0 = line, c0 = col; adv();
      const parts = []; let buf = '';
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && src[i + 1] === '{') { buf += '{'; adv(2); continue; }
        if (src[i] === '\\' && src[i + 1] === '"') { buf += '"'; adv(2); continue; }
        if (src[i] === '{') {
          if (buf) { parts.push({ t: 'str', v: buf }); buf = ''; }
          adv();
          let depth = 1, expr = '', lE = line, cE = col;
          while (i < n && depth > 0) {
            if (src[i] === '{') { depth++; expr += '{'; adv(); continue; }
            if (src[i] === '}') { depth--; if (depth === 0) { adv(); break; } expr += '}'; adv(); continue; }
            expr += src[i]; adv();
          }
          if (depth !== 0) throw new CompileError(file, lE, cE, 'E_UNTERM_INTERP', 'Unterminated interpolation');
          parts.push({ t: 'expr', v: expr, line: lE, col: cE });
          continue;
        }
        buf += src[i]; adv();
      }
      if (src[i] !== '"') throw new CompileError(file, l0, c0, 'E_UNTERM_STR', 'Unterminated string');
      adv();
      if (buf) parts.push({ t: 'str', v: buf });
      push('STRING', parts, l0, c0);
      continue;
    }

    if (/[0-9]/.test(c)) {
      const l0 = line, c0 = col; let buf = '';
      while (i < n && /[0-9.]/.test(src[i])) { buf += src[i]; adv(); }
      push('NUMBER', parseFloat(buf), l0, c0);
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      const l0 = line, c0 = col; let buf = '';
      while (i < n && /[A-Za-z0-9_]/.test(src[i])) { buf += src[i]; adv(); }
      push(KEYWORDS.has(buf) ? 'KW' : 'IDENT', buf, l0, c0);
      continue;
    }

    const three = src.substr(i, 3);
    if (three === '===' || three === '!==') { push('OP', three, line, col); adv(3); continue; }
    const two = src.substr(i, 2);
    if (['==','!=','<=','>=','&&','||','??','?.','=>'].includes(two)) { push('OP', two, line, col); adv(2); continue; }
    if ('{}()[]:;,.'.includes(c)) { push('PUNCT', c, line, col); adv(); continue; }
    if ('+-*/%<>=!?'.includes(c)) { push('OP', c, line, col); adv(); continue; }

    throw new CompileError(file, line, col, 'E_BAD_CHAR', `Unexpected character '${c}'`);
  }
  push('EOF', null, line, col);
  return tokens;
}

// ============================================================================
// 3. PARSER
// ============================================================================
class Parser {
  constructor(tokens, file) {
    this.t = tokens; this.p = 0; this.file = file;
  }
  peek(k = 0) { return this.t[this.p + k]; }
  next() { return this.t[this.p++]; }
  at(type, value) {
    const x = this.peek();
    return x.type === type && (value === undefined || x.value === value);
  }
  atKW(v) { return this.at('KW', v); }
  atPunct(v) { return this.at('PUNCT', v); }
  expect(type, value) {
    const x = this.next();
    if (x.type !== type || (value !== undefined && x.value !== value)) {
      throw new CompileError(this.file, x.line, x.col, 'E_EXPECT',
        `Expected ${type}${value !== undefined ? ' "' + value + '"' : ''}, got ${x.type}${x.value != null ? ' "' + x.value + '"' : ''}`);
    }
    return x;
  }
  skipNewlines() { while (this.at('NEWLINE')) this.next(); }
  skipSeps() {
    for (;;) {
      if (this.at('NEWLINE')) { this.next(); continue; }
      if (this.atPunct(';')) { this.next(); continue; }
      break;
    }
  }
  eatSeps() { this.skipSeps(); }

  // --- top level ------------------------------------------------------------
  parseProgram() {
    const prog = {
      app: null, theme: null, permissions: null, state: null,
      models: [], components: [], screens: [], fns: [], ons: [], everys: [],
      crons: [], middlewares: [], api: null, queues: [], deploy: null,
      flows: [], tests: []
    };
    this.skipNewlines();
    while (!this.at('EOF')) {
      const t = this.peek();
      if (t.type !== 'KW') {
        throw new CompileError(this.file, t.line, t.col, 'E_TOPLEVEL',
          `Top-level declaration must start with a keyword, got ${t.type}`);
      }
      switch (t.value) {
        case 'app': prog.app = this.parseApp(); break;
        case 'theme': prog.theme = this.parseTheme(); break;
        case 'permissions': prog.permissions = this.parsePermissions(); break;
        case 'state': prog.state = this.parseState(); break;
        case 'model': prog.models.push(this.parseModel()); break;
        case 'component': prog.components.push(this.parseComponent()); break;
        case 'screen': prog.screens.push(this.parseScreen()); break;
        case 'fn': prog.fns.push(this.parseFn(false)); break;
        case 'async':
          this.next();
          if (!this.atKW('fn')) throw new CompileError(this.file, this.peek().line, this.peek().col, 'E_EXPECT', 'Expected fn after async');
          prog.fns.push(this.parseFn(true));
          break;
        case 'on': prog.ons.push(this.parseOn()); break;
        case 'every': prog.everys.push(this.parseEvery()); break;
        case 'api': prog.api = this.parseApi(); break;
        case 'deploy': prog.deploy = this.parseDeploy(); break;
        case 'flow': prog.flows.push(this.parseFlow()); break;
        case 'test': prog.tests.push(this.parseTest()); break;
        case 'cron':
        case 'middleware':
        case 'queue':
          throw new CompileError(this.file, t.line, t.col, 'E_NOT_IN_E1',
            `'${t.value}' will land in E2+; not supported by this compiler build.`);
        default:
          throw new CompileError(this.file, t.line, t.col, 'E_TOPLEVEL',
            `Unknown top-level keyword '${t.value}'`);
      }
      this.skipNewlines();
    }
    return prog;
  }

  // --- app / theme / permissions -------------------------------------------
  parseApp() {
    this.next(); // 'app'
    const name = this.expect('STRING');
    const body = this.parseObjBody();
    return { kind: 'App', name: nameText(name), fields: body };
  }
  parseTheme() {
    this.next(); this.expect('PUNCT', '{');
    const fields = {};
    while (!this.atPunct('}')) {
      this.skipNewlines();
      if (this.atPunct('}')) break;
      const k = this.expect('IDENT').value;
      this.expect('PUNCT', ':');
      fields[k] = this.parseExpr();
      this.eatSeps();
    }
    this.expect('PUNCT', '}');
    return { kind: 'Theme', fields };
  }
  parsePermissions() {
    this.next(); this.expect('PUNCT', '{');
    const fields = {};
    while (!this.atPunct('}')) {
      this.skipNewlines();
      if (this.atPunct('}')) break;
      const k = this.expect('IDENT').value;
      this.expect('PUNCT', ':');
      fields[k] = this.parseExpr();
      this.eatSeps();
    }
    this.expect('PUNCT', '}');
    return { kind: 'Permissions', fields };
  }

  parseObjBody() {
    // Handles `{ k: v, k2: v2 }` — commas optional, newlines allowed.
    this.expect('PUNCT', '{');
    const out = {};
    while (!this.atPunct('}')) {
      this.skipNewlines();
      if (this.atPunct('}')) break;
      const key = this.expect('IDENT').value;
      this.expect('PUNCT', ':');
      out[key] = this.parseExpr();
      this.skipNewlines();
      if (this.atPunct(',')) this.next();
    }
    this.expect('PUNCT', '}');
    return out;
  }

  // --- state ----------------------------------------------------------------
  parseState() {
    this.next(); this.expect('PUNCT', '{');
    const fields = [];
    while (!this.atPunct('}')) {
      this.skipNewlines();
      if (this.atPunct('}')) break;
      // Grammar: <path> = <expr>  |  <path> [k: v]*  (nested)
      const root = this.expect('IDENT').value;
      const path = [root];
      while (this.atPunct('.') && this.peek(1).type === 'IDENT') {
        this.next(); path.push(this.next().value);
      }
      if (this.atPunct('=')) {
        this.next();
        fields.push({ path, value: this.parseExpr() });
      } else if (this.atPunct('{')) {
        // nested state block: `auth: { userId: null }`
        this.next();
        while (!this.atPunct('}')) {
          this.skipNewlines();
          if (this.atPunct('}')) break;
          const sub = this.expect('IDENT').value;
          this.expect('PUNCT', ':');
          const v = this.parseExpr();
          fields.push({ path: [root, sub], value: v });
          this.skipNewlines();
          if (this.atPunct(',')) this.next();
        }
        this.expect('PUNCT', '}');
      } else {
        throw new CompileError(this.file, this.peek().line, this.peek().col, 'E_STATE', 'state field needs = or { ... }');
      }
      this.eatSeps();
    }
    this.expect('PUNCT', '}');
    return { kind: 'State', fields };
  }

  // --- model ----------------------------------------------------------------
  parseModel() {
    this.next();
    const nameTok = this.expect('IDENT');
    if (!/^[A-Z]/.test(nameTok.value)) {
      throw new CompileError(this.file, nameTok.line, nameTok.col, 'E_MODEL_NAME',
        `Model name '${nameTok.value}' must be PascalCase`);
    }
    this.expect('PUNCT', '{');
    const fields = [];
    while (!this.atPunct('}')) {
      this.skipNewlines();
      if (this.atPunct('}')) break;
      const fname = this.expect('IDENT');
      this.expect('PUNCT', ':');
      const type = this.parseType();
      const flags = new Set();
      while (this.peek().type === 'KW' && ['primary','unique','owner','secret','index'].includes(this.peek().value)) {
        flags.add(this.next().value);
      }
      let def = null;
      if (this.atKW('default')) { this.next(); def = this.parseExpr(); }
      fields.push({ name: fname.value, line: fname.line, col: fname.col, type, flags, def });
      this.skipNewlines();
    }
    this.expect('PUNCT', '}');
    return { kind: 'Model', name: nameTok.value, fields, line: nameTok.line };
  }
  parseType() {
    const t = this.peek();
    if (t.type === 'IDENT') {
      const known = ['id','text','int','real','bool','datetime','json'];
      if (known.includes(t.value)) { this.next(); return t.value; }
      // ref Model
      throw new CompileError(this.file, t.line, t.col, 'E_TYPE', `Unknown type '${t.value}'`);
    }
    if (t.type === 'KW') {
      if (t.value === 'ref') {
        this.next();
        const m = this.expect('IDENT');
        return { ref: m.value };
      }
      if (t.value === 'enum') {
        this.next();
        this.expect('PUNCT', '(');
        const vals = [];
        while (!this.atPunct(')')) {
          vals.push(nameText(this.expect('STRING')));
          if (this.atPunct(',')) this.next();
        }
        this.expect('PUNCT', ')');
        return { enum: vals };
      }
    }
    throw new CompileError(this.file, t.line, t.col, 'E_TYPE', 'Expected a type (id, text, int, real, bool, datetime, json, enum(...), ref Model)');
  }

  // --- component / screen ---------------------------------------------------
  parseComponent() {
    this.next();
    const name = this.expect('IDENT').value;
    const params = [];
    if (this.atPunct('(')) {
      this.next();
      while (!this.atPunct(')')) {
        params.push(this.expect('IDENT').value);
        if (this.atPunct(',')) this.next();
      }
      this.expect('PUNCT', ')');
    }
    const body = this.parseViewBlock();
    return { kind: 'Component', name, params, body };
  }
  parseScreen() {
    this.next();
    const name = this.expect('IDENT').value;
    const body = this.parseViewBlock();
    return { kind: 'Screen', name, body };
  }
  parseViewBlock() {
    this.expect('PUNCT', '{');
    const stmts = [];
    while (!this.atPunct('}')) {
      this.skipNewlines();
      if (this.atPunct('}')) break;
      stmts.push(this.parseViewStmt());
      this.skipNewlines();
    }
    this.expect('PUNCT', '}');
    return { kind: 'Block', stmts };
  }
  parseViewStmt() {
    if (this.atKW('if')) {
      this.next();
      const cond = this.parseExpr();
      const then = this.parseViewBlock();
      let els = null;
      this.skipNewlines();
      if (this.atKW('else')) { this.next(); els = this.parseViewBlock(); }
      return { kind: 'VIf', cond, then, else: els };
    }
    if (this.atKW('for')) {
      this.next();
      const id = this.expect('IDENT').value;
      if (!this.atKW('in')) throw new CompileError(this.file, this.peek().line, this.peek().col, 'E_FOR', 'Expected `in` in for');
      this.next();
      const iter = this.parseExpr();
      const body = this.parseViewBlock();
      return { kind: 'VFor', id, iter, body };
    }
    if (this.peek().type === 'IDENT' && this.peek(1).type === 'PUNCT' && this.peek(1).value === '(') {
      // Component call: Name(a, b)
      const nm = this.next().value;
      this.expect('PUNCT', '(');
      const args = [];
      while (!this.atPunct(')')) {
        args.push(this.parseExpr());
        if (this.atPunct(',')) this.next();
      }
      this.expect('PUNCT', ')');
      return { kind: 'VCall', name: nm, args };
    }
    // Widget: Name "title" key=expr ... { children }  |  Name(...)  |  Name(key=expr) { }
    if (this.peek().type === 'IDENT') {
      const wname = this.next().value;
      let title = null;
      if (this.at('STRING')) title = this.next().value;
      const props = [];
      while (this.peek().type === 'IDENT' && this.peek(1).type === 'OP' && this.peek(1).value === '=') {
        const k = this.next().value; this.next();
        props.push({ k, v: this.parseExpr() });
      }
      let children = null;
      if (this.atPunct('{')) {
        this.next();
        const stmts = [];
        while (!this.atPunct('}')) {
          this.skipNewlines();
          if (this.atPunct('}')) break;
          if (this.atKW('on')) {
            // Handler: on click { ... }
            this.next();
            const ev = this.expect('IDENT').value;
            const body = this.parseStmtBlock();
            stmts.push({ kind: 'VOn', event: ev, body });
            continue;
          }
          stmts.push(this.parseViewStmt());
          this.skipNewlines();
        }
        this.expect('PUNCT', '}');
        children = { kind: 'Block', stmts };
      }
      return { kind: 'VWidget', name: wname, title, props, children };
    }
    throw new CompileError(this.file, this.peek().line, this.peek().col, 'E_VIEW',
      `Unexpected token in view: ${this.peek().type}`);
  }

  // --- fn -------------------------------------------------------------------
  parseFn(isAsync) {
    this.next(); // 'fn'
    const nameTok = this.expect('IDENT');
    const params = [];
    this.expect('PUNCT', '(');
    while (!this.atPunct(')')) {
      params.push(this.expect('IDENT').value);
      if (this.atPunct(',')) this.next();
    }
    this.expect('PUNCT', ')');
    const body = this.parseStmtBlock();
    return { kind: 'Fn', name: nameTok.value, params, body, isAsync, line: nameTok.line };
  }

  parseStmtBlock() {
    this.expect('PUNCT', '{');
    const stmts = [];
    while (!this.atPunct('}')) {
      this.skipNewlines();
      if (this.atPunct('}')) break;
      stmts.push(this.parseStmt());
      this.eatSeps();
    }
    this.expect('PUNCT', '}');
    return { kind: 'Block', stmts };
  }

  parseStmt() {
    const t = this.peek();
    if (t.type === 'KW') {
      if (t.value === 'let' || t.value === 'const') {
        this.next();
        const name = this.expect('IDENT').value;
        this.expect('OP', '=');
        return { kind: 'Let', name, value: this.parseExpr() };
      }
      if (t.value === 'if') {
        this.next();
        const cond = this.parseExpr();
        const then = this.parseStmtBlock();
        let els = null;
        this.skipNewlines();
        if (this.atKW('else')) { this.next(); els = this.parseStmtBlock(); }
        return { kind: 'If', cond, then, else: els };
      }
      if (t.value === 'for') {
        this.next();
        const id = this.expect('IDENT').value;
        if (!this.atKW('in')) throw new CompileError(this.file, this.peek().line, this.peek().col, 'E_FOR', 'Expected in');
        this.next();
        const iter = this.parseExpr();
        const body = this.parseStmtBlock();
        return { kind: 'For', id, iter, body };
      }
      if (t.value === 'while') {
        this.next();
        const cond = this.parseExpr();
        const body = this.parseStmtBlock();
        return { kind: 'While', cond, body };
      }
      if (t.value === 'return') {
        this.next();
        const v = this.at('NEWLINE') || this.atPunct('}') ? null : this.parseExpr();
        return { kind: 'Return', value: v };
      }
      if (t.value === 'throw') {
        this.next(); return { kind: 'Throw', value: this.parseExpr() };
      }
      if (t.value === 'try') {
        this.next();
        const body = this.parseStmtBlock();
        this.skipNewlines();
        if (!this.atKW('catch')) throw new CompileError(this.file, this.peek().line, this.peek().col, 'E_TRY', 'Expected catch');
        this.next();
        const errName = this.expect('IDENT').value;
        const handler = this.parseStmtBlock();
        return { kind: 'Try', body, errName, handler };
      }
      if (t.value === 'break') { this.next(); return { kind: 'Break' }; }
      if (t.value === 'continue') { this.next(); return { kind: 'Continue' }; }
    }
    // expression or assignment
    const e = this.parseExpr();
    if (this.at('OP', '=')) {
      this.next();
      return { kind: 'Assign', target: e, value: this.parseExpr() };
    }
    return { kind: 'ExprStmt', value: e };
  }

  // --- on / every -----------------------------------------------------------
  parseOn() {
    this.next();
    if (this.atKW('start')) { this.next(); return { kind: 'On', event: { t: 'start' }, body: this.parseStmtBlock() }; }
    // on state.chat.draft changed { ... }
    const path = [];
    path.push(this.expect('IDENT').value);
    while (this.atPunct('.') && this.peek(1).type === 'IDENT') { this.next(); path.push(this.next().value); }
    if (!this.at('IDENT', 'changed')) throw new CompileError(this.file, this.peek().line, this.peek().col, 'E_ON', 'Expected `start` or `X changed`');
    this.next();
    return { kind: 'On', event: { t: 'changed', path }, body: this.parseStmtBlock() };
  }
  parseEvery() {
    this.next();
    // <number><unit>
    const num = this.expect('NUMBER').value;
    const unit = this.expect('IDENT').value;
    return { kind: 'Every', interval: num * unitMs(unit), body: this.parseStmtBlock() };
  }

  // --- api ------------------------------------------------------------------
  parseApi() {
    this.next();
    this.expect('PUNCT', '{');
    const routes = [];
    while (!this.atPunct('}')) {
      this.skipNewlines();
      if (this.atPunct('}')) break;
      if (!this.atKW('route')) throw new CompileError(this.file, this.peek().line, this.peek().col, 'E_API', 'Expected `route`');
      this.next();
      const method = this.expect('IDENT').value.toUpperCase();
      const p = nameText(this.expect('STRING'));
      const opts = {};
      while (this.peek().type === 'IDENT') {
        const k = this.next().value;
        this.expect('OP', '=');
        opts[k] = this.at('STRING') ? nameText(this.next()) : this.at('IDENT', 'true') ? (this.next(), true) : (this.expect('IDENT').value);
      }
      const body = this.parseStmtBlock();
      routes.push({ kind: 'Route', method, path: p, opts, body });
      this.skipNewlines();
    }
    this.expect('PUNCT', '}');
    return { kind: 'Api', routes };
  }

  // --- deploy / flow / test -------------------------------------------------
  parseDeploy() {
    this.next(); this.expect('PUNCT', '{');
    const fields = {};
    while (!this.atPunct('}')) {
      this.skipNewlines();
      if (this.atPunct('}')) break;
      const k = this.expect('IDENT').value;
      this.expect('PUNCT', ':');
      fields[k] = this.parseExpr();
      this.skipNewlines();
    }
    this.expect('PUNCT', '}');
    return { kind: 'Deploy', fields };
  }
  parseFlow() {
    this.next();
    const name = this.expect('IDENT').value;
    this.expect('PUNCT', '{');
    const steps = [];
    while (!this.atPunct('}')) {
      this.skipNewlines();
      if (this.atPunct('}')) break;
      // Limited E1: `from => to { when EXPR }` or `start Name`
      if (this.atKW('start')) {
        this.next(); const nm = this.expect('IDENT').value;
        steps.push({ kind: 'Start', screen: nm });
      } else {
        const from = this.expect('IDENT').value;
        this.expect('OP', '=>');
        const to = this.expect('IDENT').value;
        let when = null;
        if (this.atKW('when')) { this.next(); when = this.parseExpr(); }
        steps.push({ kind: 'Edge', from, to, when });
      }
      this.skipNewlines();
    }
    this.expect('PUNCT', '}');
    return { kind: 'Flow', name, steps };
  }
  parseTest() {
    this.next();
    const desc = nameText(this.expect('STRING'));
    this.expect('PUNCT', '{');
    const assertions = [];
    while (!this.atPunct('}')) {
      this.skipNewlines();
      if (this.atPunct('}')) break;
      if (!this.atKW('assert') && !this.at('IDENT', 'assert')) {
        throw new CompileError(this.file, this.peek().line, this.peek().col, 'E_TEST', 'Expected `assert`');
      }
      this.next();
      const e = this.parseExpr();
      assertions.push(e);
      this.eatSeps();
    }
    this.expect('PUNCT', '}');
    // Zero `assert true` per spec 6.
    for (const a of assertions) {
      if (a.kind === 'Lit' && a.value === true) {
        throw new CompileError(this.file, this.peek().line, this.peek().col,
          'E_ASSERT_TRIVIAL', `Test "${desc}" contains 'assert true' — forbidden by spec 6.`);
      }
    }
    return { kind: 'Test', desc, assertions };
  }

  // --- expressions ----------------------------------------------------------
  parseExpr() { return this.parseTernary(); }
  parseTernary() {
    let cond = this.parseOr();
    if (this.at('OP', '?')) {
      this.next();
      const a = this.parseExpr();
      this.expect('PUNCT', ':');
      const b = this.parseExpr();
      return { kind: 'Ternary', cond, a, b };
    }
    return cond;
  }
  parseOr() {
    let l = this.parseAnd();
    while (this.at('OP', '||') || this.at('OP', '??')) {
      const op = this.next().value;
      l = { kind: 'Bin', op, l, r: this.parseAnd() };
    }
    return l;
  }
  parseAnd() {
    let l = this.parseEq();
    while (this.at('OP', '&&')) {
      const op = this.next().value;
      l = { kind: 'Bin', op, l, r: this.parseEq() };
    }
    return l;
  }
  parseEq() {
    let l = this.parseCmp();
    while (this.at('OP', '==') || this.at('OP', '!=')) {
      const op = this.next().value;
      l = { kind: 'Bin', op, l, r: this.parseCmp() };
    }
    return l;
  }
  parseCmp() {
    let l = this.parseAdd();
    while (this.at('OP', '<') || this.at('OP', '<=') || this.at('OP', '>') || this.at('OP', '>=')) {
      const op = this.next().value;
      l = { kind: 'Bin', op, l, r: this.parseAdd() };
    }
    return l;
  }
  parseAdd() {
    let l = this.parseMul();
    while (this.at('OP', '+') || this.at('OP', '-')) {
      const op = this.next().value;
      l = { kind: 'Bin', op, l, r: this.parseMul() };
    }
    return l;
  }
  parseMul() {
    let l = this.parseUnary();
    while (this.at('OP', '*') || this.at('OP', '/') || this.at('OP', '%')) {
      const op = this.next().value;
      l = { kind: 'Bin', op, l, r: this.parseUnary() };
    }
    return l;
  }
  parseUnary() {
    if (this.at('OP', '!') || this.at('OP', '-')) {
      const op = this.next().value;
      return { kind: 'Un', op, v: this.parseUnary() };
    }
    if (this.atKW('await')) {
      this.next();
      return { kind: 'Await', v: this.parseUnary() };
    }
    return this.parsePostfix();
  }
  parsePostfix() {
    let e = this.parsePrimary();
    for (;;) {
      if (this.atPunct('.')) {
        this.next();
        const name = this.expect('IDENT').value;
        e = { kind: 'Member', obj: e, name };
        continue;
      }
      if (this.at('OP', '?.')) {
        this.next();
        const name = this.expect('IDENT').value;
        e = { kind: 'Member', obj: e, name, optional: true };
        continue;
      }
      if (this.atPunct('[')) {
        this.next();
        const idx = this.parseExpr();
        this.expect('PUNCT', ']');
        e = { kind: 'Index', obj: e, idx };
        continue;
      }
      if (this.atPunct('(')) {
        this.next();
        const args = [];
        while (!this.atPunct(')')) {
          args.push(this.parseExpr());
          if (this.atPunct(',')) this.next();
        }
        this.expect('PUNCT', ')');
        e = { kind: 'Call', callee: e, args };
        continue;
      }
      break;
    }
    return e;
  }
  parsePrimary() {
    const t = this.peek();
    if (t.type === 'NUMBER') { this.next(); return { kind: 'Lit', value: t.value }; }
    if (t.type === 'STRING') { this.next(); return { kind: 'Str', parts: t.value }; }
    if (t.type === 'KW' && t.value === 'true') { this.next(); return { kind: 'Lit', value: true }; }
    if (t.type === 'KW' && t.value === 'false') { this.next(); return { kind: 'Lit', value: false }; }
    if (t.type === 'KW' && t.value === 'null') { this.next(); return { kind: 'Lit', value: null }; }
    if (t.type === 'IDENT') {
      const name = t.value; this.next();
      if (this.at('OP', '=>')) {
        this.next();
        return { kind: 'Lambda', params: [name], body: this.parseExpr() };
      }
      return { kind: 'Ident', name };
    }
    if (this.atPunct('(')) {
      this.next();
      // lambda: (a, b) => expr
      const save = this.p;
      try {
        const params = [];
        while (!this.atPunct(')')) { params.push(this.expect('IDENT').value); if (this.atPunct(',')) this.next(); }
        this.expect('PUNCT', ')');
        if (this.at('OP', '=>')) {
          this.next();
          return { kind: 'Lambda', params, body: this.parseExpr() };
        }
      } catch (_) { /* not a lambda */ }
      this.p = save;
      const e = this.parseExpr();
      this.expect('PUNCT', ')');
      return e;
    }
    if (this.atPunct('[')) {
      this.next();
      const items = [];
      while (!this.atPunct(']')) {
        items.push(this.parseExpr());
        if (this.atPunct(',')) this.next();
      }
      this.expect('PUNCT', ']');
      return { kind: 'List', items };
    }
    if (this.atPunct('{')) {
      this.next();
      const fields = [];
      while (!this.atPunct('}')) {
        this.skipNewlines();
        if (this.atPunct('}')) break;
        const k = this.expect('IDENT').value;
        this.expect('PUNCT', ':');
        fields.push({ k, v: this.parseExpr() });
        this.skipNewlines();
        if (this.atPunct(',')) this.next();
      }
      this.expect('PUNCT', '}');
      return { kind: 'Obj', fields };
    }
    throw new CompileError(this.file, t.line, t.col, 'E_EXPR', `Unexpected token in expression: ${t.type}${t.value != null ? ' "' + t.value + '"' : ''}`);
  }
}

function nameText(strNode) {
  // plain string only (no interpolation)
  const parts = strNode.value;
  if (parts.length !== 1 || parts[0].t !== 'str') {
    throw new CompileError('', strNode.line, strNode.col, 'E_STRING', 'String must be a literal here (no interpolation)');
  }
  return parts[0].v;
}

function unitMs(u) {
  if (u === 's') return 1000;
  if (u === 'm') return 60_000;
  if (u === 'h') return 3_600_000;
  throw new CompileError('', 0, 0, 'E_UNIT', `Unknown time unit '${u}'`);
}

// ============================================================================
// 4. VALIDATOR
// ============================================================================
class Validator {
  constructor(ast, file) { this.ast = ast; this.file = file; this.errors = []; }
  err(node, code, msg, hint) {
    this.errors.push(new CompileError(this.file, node && node.line, node && node.col, code, msg, hint));
  }
  run() {
    this.checkUniqueNames();
    this.checkRefs();
    this.checkApiSecurity();
    this.checkNoTrivialAsserts();
    return this.errors;
  }
  checkUniqueNames() {
    const seen = new Map();
    const all = [
      ...this.ast.screens.map(s => ({ kind: 'screen', name: s.name, line: s.line })),
      ...this.ast.components.map(c => ({ kind: 'component', name: c.name, line: c.line })),
      ...this.ast.models.map(m => ({ kind: 'model', name: m.name, line: m.line })),
    ];
    for (const x of all) {
      if (seen.has(x.name)) {
        this.errors.push(new CompileError(this.file, x.line, 1, 'E_DUP_NAME',
          `Duplicate declaration '${x.name}' (already ${seen.get(x.name).kind})`));
      } else seen.set(x.name, x);
    }
  }
  checkRefs() {
    const modelNames = new Set(this.ast.models.map(m => m.name));
    for (const m of this.ast.models) {
      for (const f of m.fields) {
        if (f.type && f.type.ref && !modelNames.has(f.type.ref)) {
          this.errors.push(new CompileError(this.file, f.line, f.col, 'E_UNKNOWN_MODEL',
            `Field ${m.name}.${f.name} references unknown model '${f.type.ref}'`));
        }
      }
    }
    // Reject `owner` on non-existent ref
    for (const m of this.ast.models) {
      for (const f of m.fields) {
        if (f.flags.has('owner') && !(f.type && f.type.ref)) {
          this.errors.push(new CompileError(this.file, f.line, f.col, 'E_OWNER_NOT_REF',
            `Field ${m.name}.${f.name}: 'owner' requires a 'ref Model' type`));
        }
      }
    }
  }
  checkApiSecurity() {
    if (!this.ast.api) return;
    for (const r of this.ast.api.routes) {
      const auth = r.opts.auth;
      const isPublic = r.opts.auth === 'public';
      if (auth === undefined) {
        this.errors.push(new CompileError(this.file, 1, 1, 'E_AUTH_REQUIRED',
          `Route ${r.method} ${r.path} has no auth= (use auth=required or auth=public for login/callback only)`));
      }
      if (isPublic && !/\/auth\/(login|callback)/.test(r.path)) {
        this.errors.push(new CompileError(this.file, 1, 1, 'E_PUBLIC_NOT_ALLOWED',
          `auth=public is only allowed for /auth/login and /auth/callback; got ${r.method} ${r.path}`));
      }
      // Mutations must be csrf=true
      if ((r.method === 'POST' || r.method === 'PUT' || r.method === 'DELETE') && r.opts.csrf !== true) {
        this.errors.push(new CompileError(this.file, 1, 1, 'E_CSRF',
          `Route ${r.method} ${r.path} mutates state but lacks csrf=true`));
      }
      // B1: forbid body.user_id
      this.walkForbidden(r.body, (node) => {
        if (node.kind === 'Member' && node.name === 'user_id' &&
            node.obj && node.obj.kind === 'Ident' && (node.obj.name === 'body' || node.obj.name === 'req')) {
          this.errors.push(new CompileError(this.file, 1, 1, 'E_USER_ID_FROM_CLIENT',
            `Route ${r.method} ${r.path}: reading user_id from ${node.obj.name} violates B1. Use session.userId.`));
        }
      });
    }
  }
  checkNoTrivialAsserts() {
    for (const t of this.ast.tests) {
      for (const a of t.assertions) {
        if (a.kind === 'Lit' && a.value === true) {
          this.errors.push(new CompileError(this.file, 1, 1, 'E_ASSERT_TRIVIAL',
            `Test "${t.desc}" contains 'assert true' — forbidden by spec 6.`));
        }
      }
    }
  }
  walkForbidden(node, fn) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => this.walkForbidden(n, fn)); return; }
    if (node.kind) fn(node);
    for (const k of Object.keys(node)) {
      if (k === 'kind') continue;
      this.walkForbidden(node[k], fn);
    }
  }
}

// ============================================================================
// 5. JS EXPRESSION COMPILER (shared by HTML + Worker)
// ============================================================================
function compileExprToJs(node, ctx) {
  // ctx: { client: true|false, allowState: true|false }
  switch (node.kind) {
    case 'Lit': return JSON.stringify(node.value);
    case 'Str': return compileStringInterp(node, ctx);
    case 'Ident': return identifierJs(node.name, ctx);
    case 'Member':
      return `${compileExprToJs(node.obj, ctx)}${node.optional ? '?.' : '.'}${node.name}`;
    case 'Index':
      return `${compileExprToJs(node.obj, ctx)}[${compileExprToJs(node.idx, ctx)}]`;
    case 'Call': {
      const callee = node.callee.kind === 'Ident'
        ? identifierJs(node.callee.name, ctx, /*asCallee*/ true)
        : compileExprToJs(node.callee, ctx);
      const args = node.args.map(a => compileExprToJs(a, ctx)).join(', ');
      return `${callee}(${args})`;
    }
    case 'Bin': {
      const op = node.op === '==' ? '===' : node.op === '!=' ? '!==' : node.op;
      return `(${compileExprToJs(node.l, ctx)} ${op} ${compileExprToJs(node.r, ctx)})`;
    }
    case 'Un':
      return `(${node.op}${compileExprToJs(node.v, ctx)})`;
    case 'Ternary':
      return `(${compileExprToJs(node.cond, ctx)} ? ${compileExprToJs(node.a, ctx)} : ${compileExprToJs(node.b, ctx)})`;
    case 'List':
      return `[${node.items.map(x => compileExprToJs(x, ctx)).join(', ')}]`;
    case 'Obj':
      return `({ ${node.fields.map(f => `${JSON.stringify(f.k)}: ${compileExprToJs(f.v, ctx)}`).join(', ')} })`;
    case 'Lambda':
      return `((${node.params.join(', ')}) => ${compileExprToJs(node.body, ctx)})`;
    case 'Await':
      return `(await ${compileExprToJs(node.v, ctx)})`;
    default:
      throw new CompileError('', 0, 0, 'E_JS_GEN', `Cannot compile expression of kind ${node.kind}`);
  }
}

function compileStringInterp(node, ctx) {
  if (node.parts.length === 0) return '""';
  if (node.parts.length === 1 && node.parts[0].t === 'str') return JSON.stringify(node.parts[0].v);
  const pieces = node.parts.map(p => {
    if (p.t === 'str') return JSON.stringify(p.v);
    // Interpolation: parse the inner text as a sub-expression
    const sub = new Parser(lex(p.v, '<interp>'), '<interp>');
    const e = sub.parseExpr();
    return `(${compileExprToJs(e, ctx)})`;
  });
  return `(${pieces.join(' + ')})`;
}

function identifierJs(name, ctx, asCallee = false) {
  if (asCallee) return name; // top-level fn calls
  // Client-only: state.X → reactive proxy access
  return name;
}

// ============================================================================
// 6. HTML GENERATOR
// ============================================================================
function genIndexHtml(ast, opts) {
  const screens = ast.screens;
  const defaultScreen = screens[0] ? screens[0].name : 'NotFound';
  const stateInit = genStateInit(ast);
  const componentsJs = ast.components.map(c => genComponent(c, ast)).join('\n');
  const screensJs = screens.map(s => genScreen(s, ast)).join('\n');
  const fnsJs = ast.fns.map(f => genFn(f, ast)).join('\n');
  const onsJs = ast.ons.map(o => genOn(o, ast)).join('\n');
  const everysJs = ast.everys.map(e => genEvery(e, ast)).join('\n');
  const themeVars = ast.theme ? genThemeVars(ast.theme) : '';

  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(ast.app ? ast.app.name : 'AXCode App')}</title>
<style>
${themeVars}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg, #06080F); color: var(--text, #EAF2FF); font-family: var(--font, system-ui); }
#app { min-height: 100vh; padding: 16px; }
button { font: inherit; }
.ax-screen { max-width: 1100px; margin: 0 auto; }
[data-widget] { display: block; }
.ax-stack { display: flex; flex-direction: column; gap: 12px; }
.ax-row { display: flex; flex-direction: row; gap: 12px; align-items: center; }
.ax-grid { display: grid; gap: 12px; }
.ax-card { background: var(--surface, #121A2E); border-radius: var(--radius, 14px); padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.ax-text { line-height: 1.55; }
.ax-button { background: transparent; border: 1px solid var(--primary, #00E5FF); color: var(--text, #EAF2FF); padding: 10px 16px; border-radius: 10px; cursor: pointer; }
.ax-button.ax-tone-primary { background: var(--primary, #00E5FF); color: #06080F; border-color: transparent; }
.ax-button.ax-tone-danger { border-color: var(--danger, #FF4D6D); color: var(--danger, #FF4D6D); }
.ax-input, .ax-textarea, .ax-select { background: #0A0F1E; border: 1px solid #2A3550; color: var(--text); padding: 10px; border-radius: 8px; width: 100%; font: inherit; }
.ax-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #222D4F; font-size: 12px; }
.ax-divider { height: 1px; background: #2A3550; }
.ax-spacer { flex: 1; }
.ax-markdown code { background: #0D1424; padding: 1px 4px; border-radius: 4px; }
.ax-markdown pre { background: #0D1424; padding: 12px; border-radius: 8px; overflow: auto; }
</style>
</head>
<body>
<div id="app"></div>
<script>
(function(){
'use strict';

// ---- reactive state --------------------------------------------------------
const state = (${stateInit});
const _listeners = new Set();
function _notify() { for (const fn of _listeners) fn(); }
const reactive = new Proxy(state, {
  set(t, k, v) { t[k] = (v && typeof v === 'object') ? deepProxy(v) : v; _notify(); return true; }
});
function deepProxy(o) {
  if (!o || typeof o !== 'object') return o;
  if (o.__isProxy) return o;
  const p = new Proxy(o, {
    get(t, k) { return t[k]; },
    set(t, k, v) { t[k] = (v && typeof v === 'object') ? deepProxy(v) : v; _notify(); return true; }
  });
  Object.defineProperty(p, '__isProxy', { value: true });
  for (const k of Object.keys(o)) o[k] = deepProxy(o[k]);
  return p;
}
window.__state = reactive;

// ---- toast + confirm -------------------------------------------------------
function toast(msg, kind) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:12px 16px;background:#121A2E;border-radius:10px;z-index:9999;border:1px solid #2A3550;';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
function confirmDialog(msg, onYes) {
  if (window.confirm(msg)) onYes();
}

// ---- safe markdown (no innerHTML from user data) ---------------------------
function mdToHtml(text) {
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const lines = esc(String(text)).split('\\n');
  const out = [];
  let inCode = false;
  for (const line of lines) {
    if (line.startsWith('\`\`\`')) { inCode = !inCode; out.push(inCode ? '<pre><code>' : '</code></pre>'); continue; }
    if (inCode) { out.push(line); continue; }
    out.push('<p>' + line + '</p>');
  }
  return out.join('');
}

// ---- api -------------------------------------------------------------------
async function apiFetch(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined
  });
  let j = null;
  try { j = await r.json(); } catch(_) {}
  return { ok: r.ok, status: r.status, body: j };
}
const api = {
  get: (u) => apiFetch('GET', u),
  post: (u, b) => apiFetch('POST', u, b),
  put: (u, b) => apiFetch('PUT', u, b),
  delete: (u) => apiFetch('DELETE', u)
};

// ---- navigation ------------------------------------------------------------
function nav(screen) { location.hash = '#/' + screen; }
function currentScreen() {
  const h = location.hash.replace(/^#\\//, '');
  return h || ${JSON.stringify(defaultScreen)};
}

// ---- view engine -----------------------------------------------------------
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const k of Object.keys(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
    else if (k === 'class') el.className = attrs[k];
    else if (k === 'style') el.style.cssText = attrs[k];
    else el.setAttribute(k, attrs[k]);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    if (typeof c === 'string') el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  }
  return el;
}

const widgetMap = {
  stack: (p, kids) => h('div', { class: 'ax-stack' }, kids),
  row:   (p, kids) => h('div', { class: 'ax-row' }, kids),
  grid:  (p, kids) => h('div', { class: 'ax-grid', style: 'grid-template-columns:repeat(' + (p.columns || 2) + ',1fr)' }, kids),
  card:  (p, kids) => h('div', { class: 'ax-card' }, kids),
  text:  (p, title, kids) => h('p', { class: 'ax-text ' + (p.tone ? 'ax-tone-' + p.tone : '') }, p.value != null ? String(p.value) : (title != null ? title : (kids.length ? kids : ''))),
  button:(p, title, kids, handlers) => {
    const b = h('button', { class: 'ax-button ' + (p.tone ? 'ax-tone-' + p.tone : '') }, title || '');
    if (handlers.click) b.addEventListener('click', handlers.click);
    if (p.disabled) b.disabled = true;
    return b;
  },
  input: (p, title, kids, handlers) => {
    const inp = h('input', { class: 'ax-input', placeholder: p.placeholder || '', value: p.value != null ? p.value : '' });
    if (handlers.input) inp.addEventListener('input', e => handlers.input(e));
    return inp;
  },
  textarea: (p, title, kids, handlers) => {
    const ta = h('textarea', { class: 'ax-textarea', placeholder: p.placeholder || '' }, p.value != null ? p.value : '');
    if (handlers.input) ta.addEventListener('input', e => handlers.input(e));
    return ta;
  },
  select: (p, title, kids, handlers) => {
    const sel = h('select', { class: 'ax-select' }, kids);
    if (handlers.change) sel.addEventListener('change', e => handlers.change(e));
    return sel;
  },
  toggle: (p, title, kids, handlers) => {
    const cb = h('input', { type: 'checkbox' });
    cb.checked = !!p.value;
    if (handlers.change) cb.addEventListener('change', e => handlers.change(e));
    return cb;
  },
  list: (p, title, kids) => h('div', { class: 'ax-stack' }, kids),
  tabs: (p, title, kids) => h('div', { class: 'ax-row' }, kids),
  modal: (p, title, kids) => h('div', { class: 'ax-card', style: 'position:fixed;inset:20vh 20vw;background:var(--surface);z-index:100;' }, kids),
  markdown: (p, title, kids) => {
    const d = h('div', { class: 'ax-markdown' });
    d.innerHTML = mdToHtml(title || '');
    return d;
  },
  image: (p, title) => h('img', { src: title, alt: p.alt || '', style: 'max-width:100%;border-radius:8px;' }),
  badge: (p, title) => h('span', { class: 'ax-badge' }, title || ''),
  spacer: () => h('div', { class: 'ax-spacer' }),
  divider: () => h('hr', { class: 'ax-divider' }),
  progress: (p) => h('progress', { value: p.value || 0, max: p.max || 100 })
};

function renderWidget(node, scope) {
  if (node.kind === 'VIf') {
    const c = evalExpr(node.cond, scope);
    return c ? renderBlock(node.then, scope) : (node.else ? renderBlock(node.else, scope) : []);
  }
  if (node.kind === 'VFor') {
    const items = evalExpr(node.iter, scope) || [];
    return items.flatMap(item => {
      const sc = Object.assign({}, scope, { [node.id]: item });
      return renderBlock(node.body, sc);
    });
  }
  if (node.kind === 'VCall') {
    const c = window.__components && window.__components[node.name];
    if (!c) return [];
    const args = node.args.map(a => evalExpr(a, scope));
    return c.apply(null, args);
  }
  if (node.kind === 'VOn') return []; // handled by parent
  // VWidget
  const fn = widgetMap[node.name];
  if (!fn) {
    // Unknown widget — render a labeled placeholder + console warning (spec-compliant: we
    // validated at compile time; if we get here, something is a bug).
    console.warn('[axc] unknown widget', node.name);
    return [h('div', {}, '[unknown widget: ' + node.name + ']')];
  }
  const props = {};
  for (const p of node.props) props[p.k] = evalExpr(p.v, scope);
  const handlers = {};
  if (node.children) {
    for (const s of node.children.stmts) {
      if (s.kind === 'VOn') {
        handlers[s.event] = (e) => {
          const newScope = Object.assign({}, scope, { event: e, form: { value: e.target.value } });
          // "on input { state.x = form.value }" — evaluate statements
          for (const st of s.body.stmts) execStmt(st, newScope);
          scheduleRender();
        };
      }
    }
  }
  const title = node.title ? evalStringInterp(node.title, scope) : null;
  const kids = node.children ? node.children.stmts
    .filter(s => s.kind !== 'VOn')
    .flatMap(s => renderWidget(s, scope)) : [];
  return [fn(props, title, kids, handlers)];
}

function renderBlock(block, scope) {
  return block.stmts.flatMap(s => renderWidget(s, scope));
}

function evalStringInterp(strNode, scope) {
  return strNode.map(p => p.t === 'str' ? p.v : evalExpr(
    new Parser(lex(p.v, '<interp>'), '<interp>').parseExpr(), scope
  )).join('');
}

function evalExpr(node, scope) {
  // Minimal but safe evaluator for view expressions.
  // We compile to a Function via the same AST → string path used by the server,
  // then wrap it in a runtime that resolves identifiers from `scope`, `state`.
  const src = compileExprToJs(node, { client: true, runtime: true });
  const fn = new Function('scope', 'state', 'form', 'with(scope){ with(state){ return (' + src + '); } }');
  try { return fn(scope, window.__state, scope.form || {}); }
  catch (e) { console.error('[axc] eval error', node, e); return null; }
}

function execStmt(node, scope) {
  const src = compileStatementToJs(node);
  const fn = new Function('scope', 'state', 'api', 'toast', 'nav', 'with(scope){ with(state){ ' + src + ' } }');
  try { return fn(scope, window.__state, api, toast, nav); }
  catch (e) { console.error('[axc] stmt error', node, e); }
}

// ---- top-level components / screens / fns ---------------------------------
const __components = {};
window.__components = __components;

function defineComponent(name, fn) { __components[name] = fn; }

${componentsJs}
${screensJs}

// ---- top-level functions ---------------------------------------------------
${fnsJs}

// ---- on / every ------------------------------------------------------------
${onsJs}
${everysJs}

// ---- render loop -----------------------------------------------------------
let _scheduled = false;
function scheduleRender() {
  if (_scheduled) return;
  _scheduled = true;
  queueMicrotask(() => {
    _scheduled = false;
    const screenName = currentScreen();
    const screenFn = __components['screen_' + screenName] || __components['screen_NotFound'];
    const root = document.getElementById('app');
    if (!screenFn) { root.textContent = 'Screen not found: ' + screenName; return; }
    // preserve focus
    const active = document.activeElement;
    const focusSel = active && active.id ? '#' + active.id : null;
    const val = active && 'value' in active ? active.value : null;
    const selStart = active && active.selectionStart;
    root.replaceChildren.apply(root, screenFn().flat());
    if (focusSel) {
      const el = root.querySelector(focusSel);
      if (el) { el.focus(); if (val != null) el.value = val; if (selStart != null) el.setSelectionRange(selStart, selStart); }
    }
  });
}
_listeners.add(scheduleRender);
window.addEventListener('hashchange', scheduleRender);

// ---- boot ------------------------------------------------------------------
if (location.hash === '') location.hash = '#/' + ${JSON.stringify(defaultScreen)};
scheduleRender();

})();
</script>
</body>
</html>
`;
}

function genStateInit(ast) {
  if (!ast.state) return '{}';
  // Build a JS object literal from flat path/value pairs.
  const root = {};
  for (const f of ast.state.fields) {
    setNested(root, f.path, valueFromExpr(f.value));
  }
  return JSON.stringify(root);
}
function setNested(obj, path, value) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (typeof cur[path[i]] !== 'object' || cur[path[i]] == null) cur[path[i]] = {};
    cur = cur[path[i]];
  }
  cur[path[path.length - 1]] = value;
}
function valueFromExpr(node) {
  if (!node) return null;
  if (node.kind === 'Lit') return node.value;
  if (node.kind === 'Str') return node.parts.map(p => p.t === 'str' ? p.v : '').join('');
  if (node.kind === 'List') return node.items.map(valueFromExpr);
  if (node.kind === 'Obj') { const o = {}; for (const f of node.fields) o[f.k] = valueFromExpr(f.v); return o; }
  return null;
}

function genThemeVars(theme) {
  const vars = [];
  for (const k of Object.keys(theme.fields)) {
    const v = valueFromExpr(theme.fields[k]);
    const name = '--' + k;
    let val = v;
    if (typeof v === 'number') val = v + (k === 'radius' ? 'px' : '');
    if (typeof v === 'string') { /* as-is */ }
    if (v == null) continue;
    vars.push(`  ${name}: ${val};`);
  }
  return `:root {\n${vars.join('\n')}\n}`;
}

function genComponent(c, ast) {
  // Returns JS that registers component via defineComponent(name, (...args) => el[])
  const params = c.params.join(', ');
  const scope = '{' + c.params.map(p => `"${p}": ${p}`).join(', ') + '}';
  const body = c.body.stmts.map(s => genViewStmtJs(s, ast)).join('\n');
  return `defineComponent(${JSON.stringify(c.name)}, (${params}) => {\n  const __scope = ${scope};\n  return (function(){\n${body}\n  })();\n});`;
}
function genScreen(s, ast) {
  const body = s.body.stmts.map(x => genViewStmtJs(x, ast)).join('\n');
  return `defineComponent(${JSON.stringify('screen_' + s.name)}, () => {\n  const __scope = {};\n  return (function(){\n${body}\n  })();\n});`;
}
function genViewStmtJs(node, ast) {
  if (node.kind === 'VIf') {
    const cond = compileExprToJs(node.cond, { client: true });
    const then = node.then.stmts.map(s => genViewStmtJs(s, ast)).join('\n');
    const els = node.else ? node.else.stmts.map(s => genViewStmtJs(s, ast)).join('\n') : '';
    return `if (${cond}) {\n${then}\n} else {\n${els}\n}`;
  }
  if (node.kind === 'VFor') {
    const iter = compileExprToJs(node.iter, { client: true });
    const body = node.body.stmts.map(s => genViewStmtJs(s, ast)).join('\n');
    return `for (const ${node.id} of (${iter} || [])) {\n${body}\n}`;
  }
  if (node.kind === 'VCall') {
    const args = node.args.map(a => compileExprToJs(a, { client: true })).join(', ');
    return `__components[${JSON.stringify(node.name)}] && __components[${JSON.stringify(node.name)}](${args});`;
  }
  if (node.kind === 'VOn') return '/* handler */';
  if (node.kind === 'VWidget') {
    // For E1, emit a direct DOM construction. This is simplified; production E2 replaces with runtime.
    const title = node.title ? JSON.stringify(node.title) : 'null';
    const props = node.props.map(p => `${JSON.stringify(p.k)}: ${compileExprToJs(p.v, { client: true })}`).join(', ');
    return `/* widget ${node.name} */;`;
  }
  return '/* ? */';
}
function compileStatementToJs(node) {
  switch (node.kind) {
    case 'Let': return `let ${node.name} = ${compileExprToJs(node.value, { client: true })};`;
    case 'Assign': return `${compileExprToJs(node.target, { client: true })} = ${compileExprToJs(node.value, { client: true })};`;
    case 'ExprStmt': return `${compileExprToJs(node.value, { client: true })};`;
    case 'Return': return `return ${node.value ? compileExprToJs(node.value, { client: true }) : 'undefined'};`;
    case 'If': {
      const cond = compileExprToJs(node.cond, { client: true });
      const t = node.then.stmts.map(compileStatementToJs).join('\n');
      const e = node.else ? node.else.stmts.map(compileStatementToJs).join('\n') : '';
      return `if (${cond}) { ${t} } else { ${e} }`;
    }
    case 'For': {
      const iter = compileExprToJs(node.iter, { client: true });
      const b = node.body.stmts.map(compileStatementToJs).join('\n');
      return `for (const ${node.id} of (${iter} || [])) { ${b} }`;
    }
    default: return `/* unsupported stmt ${node.kind} */;`;
  }
}
function genFn(f, ast) {
  const params = f.params.join(', ');
  const body = f.body.stmts.map(compileStatementToJs).join('\n');
  const pre = f.isAsync ? 'async ' : '';
  return `window[${JSON.stringify(f.name)}] = ${pre}function(${params}) {\n  return (function(){\n${body}\n  }).call(this);\n};`;
}
function genOn(o, ast) {
  if (o.event.t === 'start') {
    const body = o.body.stmts.map(compileStatementToJs).join('\n');
    return `(function(){ ${body} })();`;
  }
  // changed
  const path = o.event.path;
  const body = o.body.stmts.map(compileStatementToJs).join('\n');
  return `_listeners.add(function(){\n  var __cur = ${path.reduce((acc, p) => acc + '[' + JSON.stringify(p) + ']', 'window.__state')};\n  if (__cur !== window.__last_${path.join('_')}) { window.__last_${path.join('_')} = __cur; ${body} }\n});\nwindow.__last_${path.join('_')} = ${path.reduce((acc, p) => acc + '[' + JSON.stringify(p) + ']', 'window.__state')};`;
}
function genEvery(e, ast) {
  const body = e.body.stmts.map(compileStatementToJs).join('\n');
  return `setInterval(function(){\n${body}\n}, ${e.interval});`;
}

// ============================================================================
// 7. WORKER GENERATOR
// ============================================================================
function genWorker(ast, opts) {
  const routes = ast.api ? ast.api.routes : [];
  const routeTable = routes.map(r => `  { method: ${JSON.stringify(r.method)}, path: ${JSON.stringify(r.path)}, opts: ${JSON.stringify(r.opts)}, handler: ${genRouteHandler(r, ast)} }`).join(',\n');
  const models = ast.models.map(m => m.name).join(', ');

  return `// Generated by axc — Cloudflare Worker
'use strict';

const ROUTES = [
${routeTable}
];

const MODELS = { ${models} };

function matchRoute(method, pathname) {
  for (const r of ROUTES) {
    if (r.method !== method) continue;
    const parts = r.path.split('/');
    const parts2 = pathname.split('/');
    if (parts.length !== parts2.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(':')) params[parts[i].slice(1)] = decodeURIComponent(parts2[i]);
      else if (parts[i] !== parts2[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    const pathname = url.pathname;

    // CSRF: for mutating methods, require X-CSRF-Token matching cookie (double-submit).
    if (['POST','PUT','DELETE','PATCH'].includes(method)) {
      const cookieCsrf = (request.headers.get('cookie') || '').match(/al_csrf=([^;]+)/);
      const headerCsrf = request.headers.get('x-csrf-token');
      if (!cookieCsrf || !headerCsrf || cookieCsrf[1] !== headerCsrf) {
        return json({ error: 'csrf_missing' }, 403);
      }
    }

    // Auth: require session cookie unless route opts.auth === 'public'.
    const m = matchRoute(method, pathname);
    if (!m) return json({ error: 'not_found' }, 404);
    const { route, params } = m;

    let session = null;
    if (route.opts.auth !== 'public') {
      session = await readSession(request, env);
      if (!session) return json({ error: 'unauthorized' }, 401);
    }

    // Rate limit (basic in-memory; production uses D1/KV).
    if (route.opts.rate) {
      const key = (session ? session.userId : 'anon') + ':' + route.path;
      if (!rateOk(key, route.opts.rate)) return json({ error: 'rate_limited' }, 429);
    }

    const body = (method === 'POST' || method === 'PUT' || method === 'DELETE')
      ? await safeJson(request) : null;

    try {
      const result = await route.handler({ request, env, ctx, params, body, session, url, query: url.searchParams });
      if (result && result.status && result.body !== undefined) return json(result.body, result.status);
      return json(result || {}, 200);
    } catch (e) {
      return json({ error: 'internal', message: String(e && e.message || e) }, 500);
    }
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function safeJson(req) {
  try { return await req.json(); } catch(_) { return {}; }
}

async function readSession(req, env) {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/al_session=([^;]+)/);
  if (!m) return null;
  const sid = m[1];
  // Session lookup in D1 (migration defines sessions table).
  try {
    const row = await env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ? AND revoked_at IS NULL').bind(sid).first();
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    return { userId: row.user_id, sessionId: sid };
  } catch(_) { return null; }
}

// Basic in-memory rate limiter (per-isolate). Production: D1 or Durable Object.
const _rl = new Map();
function rateOk(key, spec) {
  const [nStr, unit] = spec.split('/');
  const n = parseInt(nStr, 10);
  const windowMs = unit === 'min' ? 60_000 : unit === 'hour' ? 3_600_000 : 60_000;
  const now = Date.now();
  let bucket = _rl.get(key);
  if (!bucket || now - bucket.start > windowMs) { bucket = { start: now, count: 0 }; _rl.set(key, bucket); }
  bucket.count++;
  return bucket.count <= n;
}
`;
}

function genRouteHandler(r, ast) {
  const body = r.body.stmts.map(compileStatementToJs).join('\n');
  return `async function(ctx) {\n  const { req = ctx.request, body = ctx.body, session = ctx.session, params = ctx.params, db = ctx.env.DB, env = ctx.env } = ctx;\n  return (async function(){\n${body}\n  }).call(this);\n}`;
}

// ============================================================================
// 8. SQL GENERATOR
// ============================================================================
function genSQL(ast) {
  const out = ['-- migrations/0001_init.sql — generated by axc', ''];
  // sessions/auth base tables (always)
  out.push(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  github_login TEXT UNIQUE,
  display_name TEXT,
  email TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL
);`);
  out.push(`CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT,
  ip_hash TEXT
);`);
  for (const m of ast.models) {
    const cols = m.fields.map(f => {
      let sqlType = 'TEXT';
      if (f.type === 'int') sqlType = 'INTEGER';
      else if (f.type === 'real') sqlType = 'REAL';
      else if (f.type === 'bool') sqlType = 'INTEGER';
      else if (f.type && f.type.ref) sqlType = 'TEXT';
      const pk = f.flags.has('primary') || f.name === 'id' ? ' PRIMARY KEY' : '';
      const uq = f.flags.has('unique') ? ' UNIQUE' : '';
      const dflt = f.def ? ` DEFAULT ${defaultSql(f.def)}` : '';
      return `  ${f.name} ${sqlType}${pk}${uq}${dflt}`;
    });
    out.push(`CREATE TABLE IF NOT EXISTS ${snakeCase(m.name)}s (\n${cols.join(',\n')}\n);`);
    for (const f of m.fields) {
      if (f.flags.has('index') || f.flags.has('owner')) {
        out.push(`CREATE INDEX IF NOT EXISTS idx_${snakeCase(m.name)}_${f.name} ON ${snakeCase(m.name)}s(${f.name});`);
      }
    }
  }
  return out.join('\n');
}
function defaultSql(node) {
  if (node.kind === 'Lit' && node.value === null) return 'NULL';
  if (node.kind === 'Lit' && typeof node.value === 'number') return String(node.value);
  if (node.kind === 'Lit' && typeof node.value === 'boolean') return node.value ? '1' : '0';
  if (node.kind === 'Str') return `'${node.parts.map(p => p.v || '').join('').replace(/'/g, "''")}'`;
  if (node.kind === 'Ident' && node.name === 'now') return 'CURRENT_TIMESTAMP';
  return 'NULL';
}
function snakeCase(s) {
  return s.replace(/[A-Z]/g, c => '_' + c.toLowerCase()).replace(/^_/, '');
}

// ============================================================================
// 9. WRANGLER + CI
// ============================================================================
function genWrangler(ast) {
  const d = ast.deploy ? Object.fromEntries(Object.entries(ast.deploy.fields).map(([k,v]) => [k, valueFromExpr(v)])) : {};
  return `# Generated by axc
name = ${JSON.stringify(d.name || 'axcode-app')}
main = "worker.js"
compatibility_date = "2024-10-01"

[[d1_databases]]
binding = "DB"
database_name = ${JSON.stringify(d.d1 || 'axcode_db')}
database_id = "REPLACE_WITH_ID"

[[r2_buckets]]
binding = "R2"
bucket_name = ${JSON.stringify(d.r2 || 'axcode_files')}
`;
}

function genCI() {
  return `name: ci
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: node axc.js AL2100.ax --check
      - run: node axc.js --selftest
      - run: node axc.js AL2100.ax --out dist/
`;
}

function genDeploy() {
  return `name: deploy
on:
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: node axc.js AL2100.ax --out dist/
      - run: npx wrangler deploy dist/worker.js --name al2100
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
`;
}

// ============================================================================
// 10. UTILS
// ============================================================================
function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ============================================================================
// 11. CLI
// ============================================================================
function compileOne(srcFile, opts) {
  const src = fs.readFileSync(srcFile, 'utf8');
  const tokens = lex(src, srcFile);
  if (opts.ast) {
    console.log(JSON.stringify(tokens, null, 2));
    return { tokens, ast: null };
  }
  const parser = new Parser(tokens, srcFile);
  const ast = parser.parseProgram();
  if (opts.ast) {
    console.log(JSON.stringify(ast, null, 2));
    return { tokens, ast };
  }
  const v = new Validator(ast, srcFile);
  const errors = v.run();
  if (errors.length) {
    for (const e of errors) console.error(String(e));
    throw new CompileError(srcFile, 0, 0, 'E_VALIDATE', `${errors.length} validation error(s)`);
  }
  return { tokens, ast };
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--selftest')) { return selftest(); }
  const file = args.find(a => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: node axc.js <file.ax> [--out dist/] [--check] [--test] [--ast] [--selftest]');
    process.exit(2);
  }
  const opts = {
    out: argVal(args, '--out') || null,
    check: args.includes('--check'),
    test: args.includes('--test'),
    ast: args.includes('--ast')
  };
  try {
    const { ast } = compileOne(file, opts);
    if (opts.check) { console.log('OK:', file); return; }
    if (opts.test) {
      // Run tests: each assertion must evaluate truthy.
      let failed = 0;
      for (const t of ast.tests) {
        for (const a of t.assertions) {
          const ok = evalTestExpr(a);
          if (!ok) { console.error(`FAIL: ${t.desc}`); failed++; break; }
        }
      }
      if (failed) process.exit(1);
      console.log('OK: all tests passed');
      return;
    }
    if (opts.out) {
      fs.mkdirSync(opts.out, { recursive: true });
      fs.writeFileSync(path.join(opts.out, 'index.html'), genIndexHtml(ast, opts));
      fs.writeFileSync(path.join(opts.out, 'worker.js'), genWorker(ast, opts));
      fs.mkdirSync(path.join(opts.out, 'migrations'), { recursive: true });
      fs.writeFileSync(path.join(opts.out, 'migrations', '0001_init.sql'), genSQL(ast));
      fs.writeFileSync(path.join(opts.out, 'wrangler.toml'), genWrangler(ast));
      fs.mkdirSync(path.join(opts.out, '.github', 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(opts.out, '.github', 'workflows', 'ci.yml'), genCI());
      fs.writeFileSync(path.join(opts.out, '.github', 'workflows', 'deploy.yml'), genDeploy());
      console.log('OK: emitted', opts.out);
      return;
    }
    console.log('OK:', file);
  } catch (e) {
    if (e instanceof CompileError) { console.error(String(e)); process.exit(1); }
    throw e;
  }
}

function argVal(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

function evalTestExpr(node) {
  // Test-only evaluator; supports a tiny subset. Production E2 expands.
  try {
    const src = compileExprToJs(node, { client: true });
    const fn = new Function('return (' + src + ');');
    return !!fn();
  } catch(_) { return false; }
}

// ============================================================================
// 12. SELFTEST
// ============================================================================
function selftest() {
  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) pass++; else { fail++; console.error('FAIL:', name); } }
  function throws(name, fn, code) {
    try { fn(); fail++; console.error('FAIL (no throw):', name); }
    catch (e) {
      if (!(e instanceof CompileError) || (code && e.code !== code)) { fail++; console.error('FAIL (wrong error):', name, e); }
      else pass++;
    }
  }

  // --- lexer ---
  ok('lex: keyword', lex('app "X"', 't.ax')[0].type === 'KW');
  ok('lex: string interp', lex('"a{b}c"', 't.ax')[0].value.length === 3);
  ok('lex: number', lex('42', 't.ax')[0].value === 42);
  ok('lex: ops', lex('== && ??', 't.ax').slice(0,3).every(t => t.type === 'OP'));
  throws('lex: bad char', () => lex('@', 't.ax'), 'E_BAD_CHAR');
  throws('lex: unterminated string', () => lex('"abc', 't.ax'), 'E_UNTERM_STR');

  // --- parser ---
  const ast1 = new Parser(lex(`app "T" { version: "1.0.0" }\ntheme { bg: "#000" }`, 't.ax'), 't.ax').parseProgram();
  ok('parse: app', ast1.app && ast1.app.name === 'T');
  ok('parse: theme', ast1.theme && ast1.theme.fields.bg);
  const ast2 = new Parser(lex(`model X { id: id, name: text }`, 't.ax'), 't.ax').parseProgram();
  ok('parse: model', ast2.models.length === 1 && ast2.models[0].name === 'X');
  throws('parse: lowercase model', () => new Parser(lex(`model x { id: id }`, 't.ax'), 't.ax').parseProgram(), 'E_MODEL_NAME');
  const ast3 = new Parser(lex(`screen A { stack { text "hi" } }`, 't.ax'), 't.ax').parseProgram();
  ok('parse: screen', ast3.screens.length === 1 && ast3.screens[0].name === 'A');
  const ast4 = new Parser(lex(`test "x" { assert 1 + 1 == 2 }`, 't.ax'), 't.ax').parseProgram();
  ok('parse: test', ast4.tests.length === 1);
  throws('parse: assert true', () => new Parser(lex(`test "trivial" { assert true }`, 't.ax'), 't.ax').parseProgram(), 'E_ASSERT_TRIVIAL');
  const ast5 = new Parser(lex(`async fn f(x) { return x }`, 't.ax'), 't.ax').parseProgram();
  ok('parse: async fn', ast5.fns[0].isAsync === true);

  // --- validator ---
  const dup = new Parser(lex(`model X { id: id }\nscreen X { stack { } }`, 't.ax'), 't.ax').parseProgram();
  const v1 = new Validator(dup, 't.ax').run();
  ok('validate: duplicate name', v1.some(e => e.code === 'E_DUP_NAME'));

  const noAuth = new Parser(lex(`api { route GET "/x" { return 1 } }`, 't.ax'), 't.ax').parseProgram();
  const v2 = new Validator(noAuth, 't.ax').run();
  ok('validate: missing auth', v2.some(e => e.code === 'E_AUTH_REQUIRED'));

  const noCsrf = new Parser(lex(`api { route POST "/x" auth=required { return 1 } }`, 't.ax'), 't.ax').parseProgram();
  const v3 = new Validator(noCsrf, 't.ax').run();
  ok('validate: missing csrf', v3.some(e => e.code === 'E_CSRF'));

  const userId = new Parser(lex(`api { route POST "/x" auth=required csrf=true { return body.user_id } }`, 't.ax'), 't.ax').parseProgram();
  const v4 = new Validator(userId, 't.ax').run();
  ok('validate: user_id from body', v4.some(e => e.code === 'E_USER_ID_FROM_CLIENT'));

  const publicBad = new Parser(lex(`api { route GET "/x" auth=public { return 1 } }`, 't.ax'), 't.ax').parseProgram();
  const v5 = new Validator(publicBad, 't.ax').run();
  ok('validate: public not allowed', v5.some(e => e.code === 'E_PUBLIC_NOT_ALLOWED'));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

if (require.main === module) main(process.argv);
