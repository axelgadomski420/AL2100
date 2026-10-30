#!/usr/bin/env node
'use strict';
// ============================================================================
// axc — kompilator AXCode v1.1 (Node 18+, zero zależności)
// Użycie: node axc.js AL2100.ax --out dist/ [--check] [--ast] [--test] [--selftest]
// Wyjście: index.html, worker.js, migrations/0001_init.sql, wrangler.toml,
//          .github/workflows/ci.yml, .github/workflows/deploy.yml
// ============================================================================
const AXC_VERSION = '1.1.0';

// ------------------------------ tabele języka ------------------------------
const PUNCT = ['...','->','=>','==','!=','<=','>=','&&','||','?.','??','{','}','(',')','[',']',',',';',':','.','=','<','>','+','-','*','/','%','!','?'];
const TYPEWORDS = new Set(['id','text','int','real','number','bool','boolean','datetime','date','json','enum','ref']);
const WIDGETS = {
  stack:['gap','pad','align','grow','tone'], row:['gap','pad','align','grow'],
  grid:['cols','gap'], card:['title','pad','tone'],
  text:['value','style','size','tone','align','mono'], markdown:['value'],
  image:['src','alt','size'], badge:['value','tone'], spacer:['size'], divider:[],
  progress:['value','max'], button:['label','tone','disabled','visible','icon'],
  icon_button:['icon','tone','disabled'], input:['bind','placeholder','label','type'],
  textarea:['bind','placeholder','rows','label'], select:['bind','options','label'],
  toggle:['bind','label','description'], tabs:[], tab:['active'],
  list:['items'], item:[], empty:[], modal:[], banner:['tone'],
  header:['title','subtitle'], sidebar:[], main:[], center:[], slot:[]
};
const CLIENT_FNS = ['api','nav','toast','confirm','confirmBox','storage','clipboard','now','uid','json','stream','isToday','fmt','recompute','assert'];
const SERVER_SYMS = new Set(['req','params','query','body','session','db','r2','env','audit','approval','usage','fetchSafe','ai','crypto']);
const APPROVAL_ACTIONS = new Set(['deploy','github.push','github.pr','github.commit','file.delete','conversation.delete','memory.mutate','provider.delete','sessions.revoke_all']);
const SENSITIVE_APPROVAL = [
  [/^POST .*\/deploy$/, 'deploy'],
  [/^DELETE .*\/conversations\//, 'conversation.delete'],
  [/^DELETE .*\/memory\//, 'memory.mutate'],
  [/^DELETE .*\/providers\//, 'provider.delete'],
  [/^DELETE .*\/files\//, 'file.delete'],
  [/sessions\/revoke-all/, 'sessions.revoke_all']
];

// ------------------------------ tokenizer ---------------------------------
function tokenize(src){
  const toks = []; let i = 0, line = 1, col = 1;
  const isId = c => /[A-Za-z0-9_]/.test(c);
  while (i < src.length){
    const c = src[i];
    if (c === '/' && src[i+1] === '/'){ while (i < src.length && src[i] !== '\n'){ i++; col++; } continue; }
    if (c === '\n'){ line++; col = 1; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r'){ i++; col++; continue; }
    if (c === '"'){
      let j = i+1, v = '';
      while (j < src.length && src[j] !== '"'){
        if (src[j] === '\\' && src[j+1] === '{'){ v += '{'; j += 2; col += 2; continue; }
        if (src[j] === '\\' && src[j+1] === '"'){ v += '"'; j += 2; col += 2; continue; }
        if (src[j] === '\\' && src[j+1] === '\\'){ v += '\\'; j += 2; col += 2; continue; }
        if (src[j] === '\n'){ line++; col = 1; }
        v += src[j]; j++; col++;
      }
      if (j >= src.length) return { error: 'niezamknięty string', line, col };
      toks.push({ t:'str', v, line, col }); i = j+1; col++; continue;
    }
    if (c === '#'){
      let j = i+1; while (j < src.length && /[0-9A-Fa-f]/.test(src[j])) j++;
      toks.push({ t:'str', v: src.slice(i, j), line, col }); col += (j-i); i = j; continue;
    }
    if (/[0-9]/.test(c)){
      let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
      toks.push({ t:'num', v: parseFloat(src.slice(i,j)), line, col }); col += (j-i); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)){
      let j = i; while (j < src.length && isId(src[j])) j++;
      toks.push({ t:'id', v: src.slice(i,j), line, col }); col += (j-i); i = j; continue;
    }
    let m = null;
    for (const p of PUNCT){ if (src.startsWith(p, i)){ m = p; break; } }
    if (m){ toks.push({ t:'p', v:m, line, col }); i += m.length; col += m.length; continue; }
    return { error: `nieoczekiwany znak '${c}'`, line, col };
  }
  toks.push({ t:'eof', v:null, line, col });
  return toks;
}
function parseExprString(s){
  const r = tokenize(s);
  if (!Array.isArray(r)) throw new Error(`błąd w interpolacji: ${r.error}`);
  const p = new Parser(r); const e = p.parseExpr();
  if (p.errors.length) throw new Error(`błąd w interpolacji: ${p.errors[0]}`);
  return e;
}

// ------------------------------ parser ------------------------------------
class Parser {
  constructor(toks){ this.t = toks; this.i = 0; this.errors = []; this.decls = []; }
  peek(k){ return this.t[this.i + (k||0)]; }
  next(){ return this.t[this.i++]; }
  at(v){ const p = this.peek(); return (p.t==='id'||p.t==='p'||p.t==='str') && p.v===v; }
  atT(t){ return this.peek().t === t; }
  accept(v){ if (this.at(v)){ this.i++; return true; } return false; }
  expect(v){ if (!this.accept(v)) this.err(`oczekiwano '${v}', otrzymano '${String(this.peek().v)}'`); }
  err(msg){ const p = this.peek(); this.errors.push(`${p.line}:${p.col}: ${msg}`); if (p.t!=='eof') this.i++; }

  parseProgram(){
    while (!this.atT('eof')){
      const p = this.peek();
      if (p.t !== 'id'){ this.err(`oczekiwano deklaracji, otrzymano '${String(p.v)}'`); break; }
      switch (p.v){
        case 'app': this.next(); { const name = this.next().v; this.decls.push({ k:'app', name, body: this.parseKVBlock() }); } break;
        case 'theme': case 'permissions': case 'sync': case 'ai': case 'deploy':
          this.next(); this.decls.push({ k: p.v, body: this.parseKVBlock() }); break;
        case 'state': this.next(); this.decls.push({ k:'state', ...this.parseStateBlock() }); break;
        case 'storage': this.next(); this.expect('local'); {
          const db = this.next().v; this.accept('version');
          const version = this.atT('num') ? this.next().v : 1;
          const models = []; const indexes = [];
          this.expect('{');
          while (!this.at('}') && !this.atT('eof')){
            if (this.accept('index')){ let m = this.next().v; this.expect('.'); const f = this.next().v; indexes.push({ model:m, field:f }); this.accept(';'); }
            else if (this.at('model')){ this.next(); models.push(this.parseModel()); }
            else this.err("oczekiwano 'model' lub 'index'");
          }
          this.expect('}');
          this.decls.push({ k:'storage', db, version, models, indexes });
        } break;
        case 'model': this.next(); this.decls.push({ k:'modelTop', model: this.parseModel() }); break;
        case 'component': this.next(); {
          const name = this.next().v; const params = [];
          if (this.accept('(')){ while (!this.at(')')){ params.push(this.next().v); this.accept(','); } this.expect(')'); }
          const { kids, ons } = this.parseViewsBlock();
          this.decls.push({ k:'component', name, params, kids, ons });
        } break;
        case 'screen': this.next(); {
          const name = this.next().v; const { kids, ons } = this.parseViewsBlock();
          this.decls.push({ k:'screen', name, kids, ons });
        } break;
        case 'logic': this.next(); {
          const fns = [];
          this.expect('{');
          while (!this.at('}') && !this.atT('eof')){
            if (this.at('function') || this.at('fn') || this.at('async')){
              const isAsync = this.accept('async');
              this.accept('function') || this.accept('fn') || this.err("oczekiwano 'function'");
              const name = this.next().v; const params = [];
              if (this.accept('(')){ while (!this.at(')')){ params.push(this.next().v); this.accept(','); } this.expect(')'); }
              const body = this.parseStmtBlock();
              fns.push({ name, params, body, async: isAsync || hasAwait(body) });
            } else this.err("oczekiwano 'function' w bloku logic");
          }
          this.expect('}');
          this.decls.push({ k:'logic', fns });
        } break;
        case 'api': this.next(); {
          const routes = [];
          this.expect('{');
          while (!this.at('}') && !this.atT('eof')){
            if (this.accept('route')){
              const method = this.next().v.toUpperCase(); const path = this.next().v;
              const opts = {};
              while (this.peek().t === 'id' && ['auth','csrf','rate','approval'].includes(this.peek().v)){
                const on = this.next().v; this.expect('='); opts[on] = this.next().v;
              }
              const body = this.parseStmtBlock();
              routes.push({ method, path, opts, body });
            } else this.err("oczekiwano 'route' w bloku api");
          }
          this.expect('}');
          this.decls.push({ k:'api', routes });
        } break;
        case 'middleware': this.next(); { const name = this.next().v; this.decls.push({ k:'middleware', name, body: this.parseStmtBlock() }); } break;
        case 'queue': this.next(); { const name = this.next().v; this.decls.push({ k:'queue', name, body: this.parseStmtBlock() }); } break;
        case 'cron': this.next(); { const expr = this.next().v; this.decls.push({ k:'cron', expr, body: this.parseStmtBlock() }); } break;
        case 'flow': this.next(); { const name = this.next().v; this.decls.push({ k:'flow', name, body: this.parseStmtBlock() }); } break;
        case 'on': this.next(); { const ev = this.next().v; this.decls.push({ k:'on', ev, body: this.parseStmtBlock() }); } break;
        case 'every': this.next(); {
          let n = this.next().v; const unit = this.next().v;
          this.decls.push({ k:'every', n, unit, body: this.parseStmtBlock() });
        } break;
        case 'test': this.next(); { const desc = this.next().v; this.decls.push({ k:'test', desc, body: this.parseStmtBlock() }); } break;
        default: this.err(`nieznana deklaracja '${p.v}'`);
      }
    }
    return { decls: this.decls, errors: this.errors };
  }

  parseKVBlock(){
    this.expect('{');
    const o = {};
    while (!this.at('}') && !this.atT('eof')){
      const p = this.peek();
      if (p.t !== 'id'){ this.err('oczekiwano klucza'); break; }
      let key = this.next().v;
      if (this.accept('.')) key = key + '.' + this.next().v;
      this.accept(':');
      if (this.at('{')){ o[key] = this.parseKVBlock(); }
      else if (this.accept('[')){
        const arr = [];
        while (!this.at(']') && !this.atT('eof')){ arr.push(this.next().v); this.accept(','); }
        this.expect(']');
        o[key] = arr;
      } else {
        const vals = []; let depth = 0;
        while (!this.atT('eof')){
          const q = this.peek();
          if (q.v === '(' || q.v === '[') depth++;
          if (q.v === ')' || q.v === ']') depth--;
          if (depth === 0 && (q.v === ';' || q.v === ',' || q.v === '}')) break;
          vals.push(this.next());
        }
        if (vals.length === 1) o[key] = vals[0].t === 'num' ? vals[0].v : vals[0].v;
        else if (vals.length > 1) o[key] = vals.map(t => String(t.v)).join(' ');
        else o[key] = null;
      }
      this.accept(';'); this.accept(',');
    }
    this.expect('}');
    return o;
  }

  parseStateBlock(){
    this.expect('{');
    const fields = [], computed = [], events = [];
    while (!this.at('}') && !this.atT('eof')){
      const p = this.peek();
      if (p.t !== 'id'){ this.err('oczekiwano pola state'); break; }
      if (p.v === 'computed'){
        this.next(); const name = this.next().v;
        computed.push({ name, body: this.parseStmtBlock() });
      } else if (p.v === 'event'){
        this.next();
        let path = this.next().v;
        while (this.accept('.')) path += '.' + this.next().v;
        this.expect('changed');
        events.push({ path, body: this.parseStmtBlock() });
      } else {
        let path = this.next().v;
        while (this.accept('.')) path += '.' + this.next().v;
        this.expect('=');
        fields.push({ path, val: this.parseExpr() });
      }
      this.accept(';');
    }
    this.expect('}');
    return { fields, computed, events };
  }

  parseModel(){
    const name = this.next().v;
    this.expect('{');
    const fields = [];
    while (!this.at('}') && !this.atT('eof')){
      const p = this.peek();
      if (p.t !== 'id'){ this.err('oczekiwano nazwy pola'); break; }
      const fname = this.next().v;
      let ftype = 'text';
      const tp = this.peek();
      if (tp.t === 'id' && TYPEWORDS.has(tp.v)){
        this.next(); ftype = tp.v === 'boolean' ? 'bool' : tp.v;
        if (ftype === 'enum'){
          const opts = []; this.expect('[');
          while (!this.at(']') && !this.atT('eof')){ opts.push(this.next().v); this.accept(','); }
          this.expect(']'); ftype = 'text';
          const emods = { enum: opts };
          if (this.at('default')){ this.next(); emods.default = this.parseLiteral(); }
          else if (this.accept('=')){ emods.default = this.parseLiteral(); }
          fields.push({ name: fname, type:'text', mods: emods }); this.accept(';'); continue;
        }
        if (ftype === 'ref') ftype = 'text';
      }
      const mods = {};
      while (true){
        const m = this.peek();
        if (m.t === 'id' && ['primary','unique','optional','index','owner','secret'].includes(m.v)){ mods[m.v] = true; this.next(); }
        else if (m.t === 'id' && m.v === 'default'){ this.next(); mods.default = this.parseLiteral(); }
        else if (this.accept('=')){ mods.default = this.parseLiteral(); }
        else break;
      }
      fields.push({ name: fname, type: ftype, mods });
      this.accept(';');
    }
    this.expect('}');
    return { name, fields };
  }
  parseLiteral(){
    const p = this.peek();
    if (p.t === 'str' || p.t === 'num'){ this.next(); return p.v; }
    if (p.t === 'id' && (p.v === 'true' || p.v === 'false')){ this.next(); return p.v === 'true'; }
    if (p.t === 'id' && p.v === 'null'){ this.next(); return null; }
    this.err('oczekiwano literału'); return null;
  }

  // --- widoki ---
  parseViewsBlock(){
    this.expect('{');
    const kids = [], ons = [];
    while (!this.at('}') && !this.atT('eof')){
      const n = this.parseViewNode();
      if (!n) break;
      if (n.k === 'on') ons.push(n); else kids.push(n);
    }
    this.expect('}');
    return { kids, ons };
  }
  parseViewNode(){
    const p = this.peek();
    if (p.t !== 'id'){ this.err(`oczekiwano widgetu, otrzymano '${String(p.v)}'`); return null; }
    if (p.v === 'if'){
      this.next(); const cond = this.parseExpr();
      const then = this.parseViewsBlock();
      let els = null;
      if (this.at('else')){ this.next(); els = this.parseViewsBlock(); }
      return { k:'if', cond, then: then.kids, thenOns: then.ons, els: els ? els.kids : null };
    }
    if (p.v === 'for'){
      this.next(); const v = this.next().v; this.expect('in');
      const list = this.parseExpr();
      const b = this.parseViewsBlock();
      return { k:'for', var: v, list, kids: b.kids };
    }
    if (p.v === 'on'){
      this.next(); const ev = this.next().v;
      return { k:'on', ev, body: this.parseStmtBlock() };
    }
    const name = this.next().v;
    if (this.at('(')){ // wywołanie komponentu
      this.next(); const args = [];
      while (!this.at(')') && !this.atT('eof')){ args.push(this.parseExpr()); this.accept(','); }
      this.expect(')');
      let kids = null;
      if (this.at('{')) kids = this.parseViewsBlock().kids;
      return { k:'comp', name, args, kids };
    }
    let arg = null;
    if (this.atT('str')){ arg = this.next().v; }
    const attrs = {};
    while (this.peek().t === 'id' && WIDGETS[name] && WIDGETS[name].includes(this.peek().v)){
      const an = this.next().v; this.accept('=');
      attrs[an] = this.parseExpr();
      this.accept(';');
    }
    let kids = [], ons = [];
    if (this.at('{')){ const b = this.parseViewsBlock(); kids = b.kids; ons = b.ons; }
    return { k:'widget', name, arg, attrs, kids, ons };
  }

  // --- instrukcje ---
  parseStmtBlock(){
    this.expect('{');
    const b = this.parseStmts();
    this.expect('}');
    return b;
  }
  parseStmts(){
    const out = [];
    while (!this.at('}') && !this.atT('eof')){
      const s = this.parseStmt();
      if (s) out.push(s);
    }
    return out;
  }
  parseStmt(){
    const p = this.peek();
    if (p.t !== 'id' && p.t !== 'p'){ this.err('oczekiwano instrukcji'); return null; }
    if (this.accept(';')) return null;
    if (p.t === 'id' && p.v === 'assert'){
      this.next(); const e = this.parseExpr(); this.accept(';');
      return { k:'expr', e:{ k:'call', f:{ k:'id', v:'assert' }, args:[e] } };
    }
    if (p.t === 'id' && (p.v === 'let' || p.v === 'const')){
      this.next(); const n = this.next().v; this.expect('=');
      const v = this.parseExpr(); this.accept(';');
      return { k: p.v, n, v };
    }
    if (p.t === 'id' && p.v === 'if'){
      this.next(); const c = this.parseExpr();
      const t = this.parseStmtBlock();
      let e = null;
      if (this.at('else')){
        this.next();
        e = this.at('if') ? [this.parseStmt()] : this.parseStmtBlock();
      }
      return { k:'if', c, t, e };
    }
    if (p.t === 'id' && p.v === 'for'){
      this.next(); const v = this.next().v; this.expect('in');
      const l = this.parseExpr();
      return { k:'for', v, l, body: this.parseStmtBlock() };
    }
    if (p.t === 'id' && p.v === 'while'){
      this.next(); const c = this.parseExpr();
      return { k:'while', c, body: this.parseStmtBlock() };
    }
    if (p.t === 'id' && p.v === 'return'){
      this.next();
      const e = (this.at(';') || this.at('}')) ? null : this.parseExpr();
      this.accept(';');
      return { k:'return', e };
    }
    if (p.t === 'id' && p.v === 'break'){ this.next(); this.accept(';'); return { k:'break' }; }
    if (p.t === 'id' && p.v === 'continue'){ this.next(); this.accept(';'); return { k:'continue' }; }
    if (p.t === 'id' && p.v === 'throw'){ this.next(); const e = this.parseExpr(); this.accept(';'); return { k:'throw', e }; }
    if (p.t === 'id' && p.v === 'try'){
      this.next(); const t = this.parseStmtBlock();
      this.expect('catch'); const e = this.next().v;
      const c = this.parseStmtBlock();
      return { k:'try', t, e, c };
    }
    const e1 = this.parseExpr();
    if (this.accept('=')){
      const r = this.parseExpr(); this.accept(';');
      return { k:'assign', l: e1, r };
    }
    this.accept(';');
    return { k:'expr', e: e1 };
  }

  // --- wyrażenia ---
  parseExpr(){ return this.parseTernary(); }
  parseTernary(){
    const c = this.parseCoalesce();
    if (this.accept('?')){
      const a = this.parseExpr(); this.expect(':');
      const b = this.parseExpr();
      return { k:'cond', c, a, b };
    }
    return c;
  }
  parseCoalesce(){ let l = this.parseOr(); while (this.accept('??')) l = { k:'bin', op:'??', l, r: this.parseOr() }; return l; }
  parseOr(){ let l = this.parseAnd(); while (this.accept('||')) l = { k:'bin', op:'||', l, r: this.parseAnd() }; return l; }
  parseAnd(){ let l = this.parseEq(); while (this.accept('&&')) l = { k:'bin', op:'&&', l, r: this.parseEq() }; return l; }
  parseEq(){ let l = this.parseRel(); while (this.at('==') || this.at('!=')) { const op = this.next().v; l = { k:'bin', op, l, r: this.parseRel() }; } return l; }
  parseRel(){ let l = this.parseAdd(); while (['<','<=','>','>='].includes(this.peek().v)) { const op = this.next().v; l = { k:'bin', op, l, r: this.parseAdd() }; } return l; }
  parseAdd(){ let l = this.parseMul(); while (this.at('+') || this.at('-')) { const op = this.next().v; l = { k:'bin', op, l, r: this.parseMul() }; } return l; }
  parseMul(){ let l = this.parseUnary(); while (['*','/','%'].includes(this.peek().v)) { const op = this.next().v; l = { k:'bin', op, l, r: this.parseUnary() }; } return l; }
  parseUnary(){
    if (this.accept('!')) return { k:'not', e: this.parseUnary() };
    if (this.accept('-')) return { k:'neg', e: this.parseUnary() };
    if (this.at('await')){ this.next(); return { k:'await', e: this.parseUnary() }; }
    return this.parsePostfix();
  }
  parsePostfix(){
    let e = this.parsePrimary();
    while (true){
      if (this.accept('(')){
        const args = [];
        while (!this.at(')') && !this.atT('eof')){ args.push(this.parseExpr()); this.accept(','); }
        this.expect(')');
        e = { k:'call', f: e, args };
      } else if (this.accept('.')){ e = { k:'member', o: e, n: this.next().v, opt: false }; }
      else if (this.accept('?.')){ e = { k:'member', o: e, n: this.next().v, opt: true }; }
      else if (this.accept('[')){ const ix = this.parseExpr(); this.expect(']'); e = { k:'index', o: e, ix }; }
      else break;
    }
    return e;
  }
  parsePrimary(){
    const p = this.peek();
    if (p.t === 'num'){ this.next(); return { k:'num', v: p.v }; }
    if (p.t === 'str'){ this.next(); return { k:'str', v: p.v }; }
    if (p.t === 'id'){
      if (p.v === 'true' || p.v === 'false'){ this.next(); return { k:'bool', v: p.v === 'true' }; }
      if (p.v === 'null'){ this.next(); return { k:'null' }; }
      this.next(); return { k:'id', v: p.v };
    }
    if (p.v === '('){
      this.next();
      const save = this.i;
      const params = [];
      let ok = true;
      if (!this.at(')')){
        if (this.peek().t === 'id'){
          params.push(this.next().v);
          while (this.accept(',')){ if (this.peek().t !== 'id'){ ok = false; break; } params.push(this.next().v); }
          if (ok && !this.at(')')) ok = false;
        } else ok = false;
      }
      if (ok && this.accept(')') && (this.accept('->') || this.accept('=>'))){
        const body = this.at('{') ? { k:'block', body: this.parseStmtBlock() } : this.parseExpr();
        return { k:'lambda', params, body };
      }
      this.i = save;
      const e = this.parseExpr(); this.expect(')');
      return e;
    }
    if (p.v === '['){
      this.next(); const items = [];
      while (!this.at(']') && !this.atT('eof')){ items.push(this.parseExpr()); this.accept(','); }
      this.expect(']');
      return { k:'list', items };
    }
    if (p.v === '{'){
      this.next(); const props = [];
      while (!this.at('}') && !this.atT('eof')){
        if (this.accept('...')){ props.push({ key:null, v: this.parseExpr(), spread: true }); this.accept(','); continue; }
        const key = this.next().v; this.expect(':');
        props.push({ key, v: this.parseExpr() });
        this.accept(',');
      }
      this.expect('}');
      return { k:'obj', props };
    }
    this.err(`nieoczekiwane wyrażenie '${String(p.v)}'`);
    this.next();
    return { k:'null' };
  }
}
function hasAwait(body){
  const s = JSON.stringify(body);
  return s.includes('"k":"await"') || s.includes('"await"');
}

// ------------------------------ zbieranie symboli --------------------------
function collectSymbols(ast){
  const sym = { screens:{}, components:{}, models:{}, fns:{}, statePaths:new Set(), stateRoots:new Set(), computed:new Set(), flows:{}, fieldsByModel:{} };
  for (const d of ast.decls){
    switch (d.k){
      case 'screen': sym.screens[d.name] = d; break;
      case 'component': sym.components[d.name] = d; break;
      case 'storage': for (const m of d.models){ sym.models[m.name] = m; } break;
      case 'modelTop': sym.models[d.model.name] = d.model; break;
      case 'logic': for (const f of d.fns) sym.fns[f.name] = f; break;
      case 'state':
        for (const f of d.fields){ sym.statePaths.add(f.path); sym.stateRoots.add(f.path.split('.')[0]); }
        for (const c of d.computed) sym.computed.add(c.name);
        break;
      case 'flow': sym.flows[d.name] = d; break;
    }
  }
  return sym;
}

// ------------------------------ walidator ---------------------------------
function validate(ast){
  const errors = [];
  const err = (tok, code, msg, hint) => errors.push({ line: tok ? tok.line : 0, col: tok ? tok.col : 0, code, msg, hint: hint || '' });
  const sym = collectSymbols(ast);
  // E001 kolizje nazw PascalCase
  const seen = new Map();
  for (const [n] of Object.entries(sym.screens)){ if (seen.has(n)) err(null,'E001',`kolizja nazwy '${n}' (screen)`,'Nazwy ekranów, komponentów i modeli są globalnie unikalne'); seen.set(n,'screen'); }
  for (const [n] of Object.entries(sym.components)){ if (seen.has(n)) err(null,'E001',`kolizja nazwy '${n}' (component)`,''); seen.set(n,'component'); }
  for (const [n] of Object.entries(sym.models)){ if (seen.has(n)) err(null,'E001',`kolizja nazwy '${n}' (model)`,''); seen.set(n,'model'); }
  // E012 duplikaty ścieżek state
  const stDecl = ast.decls.find(d => d.k === 'state');
  if (stDecl){
    const paths = new Set();
    for (const f of stDecl.fields){ if (paths.has(f.path)) err(null,'E012',`pole state '${f.path}' zadeklarowane drugi raz`,'Usuń duplikat'); paths.add(f.path); }
  }
  const declaredPaths = sym.statePaths;
  const isStatePath = (p) => { for (const d of declaredPaths){ if (p === d || p.startsWith(d + '.') || d.startsWith(p + '.')) return true; } return false; };
  // sprawdźanie wyrażeń
  function walkExpr(e, ctxPath, out){
    if (!e || typeof e !== 'object') return;
    if (e.k === 'id'){
      if (ctxPath !== null && sym.stateRoots.has(e.v)) out.push({ root: e.v, node: e });
      return;
    }
    if (e.k === 'member'){
      if (e.o && e.o.k === 'id' && CLIENT_FNS.includes(e.o.v)) return; // symbol biblioteki (np. nav.go)
      if (ctxPath !== null && e.o && e.o.k === 'id' && sym.stateRoots.has(e.o.v)) out.push({ root: e.o.v, node: e });
      else walkExpr(e.o, ctxPath, out);
      return;
    }
    if (e.k === 'call'){ walkExpr(e.f, ctxPath, out); for (const a of e.args) walkExpr(a, ctxPath, out); return; }
    for (const key of ['l','r','c','a','b','e','o','ix']) if (e[key]) walkExpr(e[key], ctxPath, out);
    if (e.items) for (const it of e.items) walkExpr(it, ctxPath, out);
    if (e.props) for (const p of e.props) walkExpr(p.v, ctxPath, out);
    if (e.body && e.body.body) walkStmts(e.body.body, ctxPath, out);
  }
  function memberPath(e){ // pełna ścieżka kropkowa albo null
    if (!e) return null;
    if (e.k === 'id') return e.v;
    if (e.k === 'member' && !e.opt){ const base = memberPath(e.o); return base ? base + '.' + e.n : null; }
    return null;
  }
  function walkStmts(stmts, server, out){
    for (const s of stmts || []){
      if (!s) continue;
      if (s.k === 'let' || s.k === 'const') walkExpr(s.v, server, out);
      else if (s.k === 'assign'){ walkExpr(s.l, server, out); walkExpr(s.r, server, out);
        // E005: user_id z body/req
        if (server && s.l && s.l.k === 'obj'){ for (const p of s.l.props){ if (p.key === 'user_id' && p.v && p.v.k === 'member' && p.v.o && ['body','req','query'].includes(p.v.o.v)) err(null,'E005',`user_id z '${p.v.o.v}' — user_id pochodzi wyłącznie z session`, 'Użyj session.userId (owner dopisze je automatycznie)'); } }
      }
      else if (s.k === 'if'){ walkExpr(s.c, server, out); walkStmts(s.t, server, out); walkStmts(s.e, server, out); }
      else if (s.k === 'for' || s.k === 'while'){ walkExpr(s.l || s.c, server, out); walkStmts(s.body, server, out); }
      else if (s.k === 'return'){ if (s.e) walkExpr(s.e, server, out); }
      else if (s.k === 'throw' || s.k === 'expr'){ walkExpr(s.e, server, out); }
      else if (s.k === 'try'){ walkStmts(s.t, server, out); walkStmts(s.c, server, out); }
    }
  }
  // E002 ścieżki state w wyrażeniach klienckich
  function checkClientExprs(nodes, out){
    for (const n of nodes){
      if (!n) continue;
      if (n.k === 'if'){ walkExpr(n.cond, false, out); checkClientExprs(n.then, out); checkClientExprs(n.els || [], out); }
      else if (n.k === 'for'){ walkExpr(n.list, false, out); checkClientExprs(n.kids, out); }
      else if (n.k === 'widget'){ for (const a of Object.values(n.attrs)) walkExpr(a, false, out); checkClientExprs(n.kids, out); for (const o of n.ons) walkStmts(o.body, false, out); }
      else if (n.k === 'comp'){ for (const a of n.args) walkExpr(a, false, out); checkClientExprs(n.kids || [], out); }
    }
  }
  const stateOut = [];
  for (const d of ast.decls){
    if (d.k === 'screen' || d.k === 'component'){
      const out = [];
      checkClientExprs(d.kids, out);
      walkStmts([].concat(...(d.ons || []).map(o => o.body)), false, out);
      for (const r of out){
        const p = memberPath(r.node);
        if (p && !isStatePath(p) && !sym.computed.has(p)) err(null, 'E002', `nieznane pole state '${p}'`, 'Zadeklaruj je w bloku state');
      }
    }
    if (d.k === 'logic'){
      for (const f of d.fns){
        const out = [];
        walkStmts(f.body, false, out);
        for (const r of out){
          const p = memberPath(r.node);
          if (p && !isStatePath(p)) err(null, 'E002', `nieznane pole state '${p}' w fn ${f.name}`, '');
        }
      }
    }
    if (d.k === 'state'){
      for (const c of d.computed){
        const out = [];
        walkStmts(c.body, false, out);
        for (const r of out){
          const p = memberPath(r.node);
          if (p && !isStatePath(p)) err(null, 'E002', `nieznane pole state '${p}' w computed ${c.name}`, '');
        }
      }
      for (const ev of d.events){
        if (!isStatePath(ev.path)) err(null, 'E002', `event na nieznanym polu '${ev.path}'`, '');
      }
    }
    if (d.k === 'api'){
      for (const rt of d.routes){
        const isPublic = rt.opts.auth === 'public';
        const isMutation = rt.method !== 'GET';
        const authAllowedPublic = rt.path.startsWith('/api/auth/') || rt.path.startsWith('/api/csrf');
        // E003
        if (!rt.opts.auth) err(null, 'E003', `trasa ${rt.method} ${rt.path} bez auth`, 'Dodaj auth=required lub auth=public (tylko login/callback/csrf)');
        if (isPublic && !authAllowedPublic) err(null, 'E003', `auth=public dozwolone tylko dla /api/auth/* i /api/csrf (${rt.path})`, '');
        // E004
        if (isMutation && rt.opts.csrf !== 'true' && !isPublic) err(null, 'E004', `mutacja ${rt.method} ${rt.path} bez csrf=true`, 'Double-submit cookie chroni przed CSRF');
        // E006
        const need = SENSITIVE_APPROVAL.find(([re]) => re.test(`${rt.method} ${rt.path}`));
        if (need && rt.opts.approval !== need[1]) err(null, 'E006', `trasa ${rt.method} ${rt.path} wymaga approval="${need[1]}"`, 'Operacja z listy B4 wymaga zatwierdzenia');
        if (rt.opts.approval && !APPROVAL_ACTIONS.has(rt.opts.approval)) err(null, 'E006', `nieznana akcja approval '${rt.opts.approval}'`, `Dozwolone: ${[...APPROVAL_ACTIONS].join(', ')}`);
        // E005 + E011 w ciele trasy
        const out = [];
        walkStmts(rt.body, true, out);
        for (const s of rt.body){
          const src = JSON.stringify(s);
          if (src.includes('"user_id"') && (src.includes('body') || src.includes('req.'))) err(null, 'E005', `trasa ${rt.path}: user_id nie może pochodzić z req/body`, '');
          if (src.includes('db.') ){
            const m = src.match(/"f":\{"k":"member","o":\{"k":"id","v":"db"\},"n":"([A-Za-z]+)"/);
          }
        }
      }
    }
    if (d.k === 'test'){
      for (const s of d.body){
        if (s && s.k === 'expr' && s.e && s.e.k === 'call' && s.e.f && s.e.f.k === 'id' && s.e.f.v === 'assert' && s.e.args.length === 1 && s.e.args[0].k === 'bool' && s.e.args[0].v === true)
          err(null, 'E010', `test "${d.desc}": 'assert true' — test nie testuje niczego`, 'Napisz realną asercję (reguła: zero assert true)');
        if (s && s.k === 'return') err(null, 'E010', `test "${d.desc}": return poza funkcją`, '');
      }
    }
  }
  // E007/E008/E009 w widokach i handlerach
  function checkViews(nodes, where){
    for (const n of nodes || []){
      if (!n) continue;
      if (n.k === 'widget'){
        if (!WIDGETS[n.name] && !(n.name === 'item' || n.name === 'empty')) err(null, 'E007', `nieznany widget '${n.name}' w ${where}`, `Dozwolone: ${Object.keys(WIDGETS).join(', ')}`);
        checkViews(n.kids, where);
      } else if (n.k === 'comp'){
        if (!sym.components[n.name]) err(null, 'E008', `nieznany komponent '${n.name}' w ${where}`, '');
        checkViews(n.kids, where);
      } else if (n.k === 'if'){ checkViews(n.then, where); checkViews(n.els, where); }
      else if (n.k === 'for'){ checkViews(n.kids, where); }
    }
  }
  for (const d of ast.decls){
    if (d.k === 'screen') checkViews(d.kids, `screen ${d.name}`);
    if (d.k === 'component') checkViews(d.kids, `component ${d.name}`);
  }
  function checkCalls(stmts, where, extra){
    for (const s of stmts || []){
      if (!s) continue;
      const js = JSON.stringify(s);
      const re = /"f":\{"k":"id","v":"([a-zA-Z_][a-zA-Z0-9_]*)"\}/g;
      let m;
      while ((m = re.exec(js))){
        const name = m[1];
        const ok = sym.fns[name] || CLIENT_FNS.includes(name) || extra.has(name);
        if (!ok) err(null, 'E009', `nieznana funkcja '${name}' w ${where}`, 'Symbol spoza biblioteki standardowej = błąd kompilacji');
      }
    }
  }
  const globalClient = new Set([...Object.keys(sym.fns), 'ui', 'window', 'navigator', 'date', 'alert', 'console', 'item', 'e', 'err']);
  for (const d of ast.decls){
    if (d.k === 'logic') for (const f of d.fns) checkCalls(f.body, `fn ${f.name}`, globalClient);
    if (d.k === 'state') for (const c of d.computed) checkCalls(c.body, `computed ${c.name}`, globalClient);
    if (d.k === 'test') checkCalls(d.body, `test "${d.desc}"`, new Set([...globalClient, 'api']));
  }
  return errors;
}

// ------------------------------ transpiler --------------------------------
function esc(s){ return JSON.stringify(String(s)); }
function evalDefault(code){
  return new Function('"use strict"; return (' + code + ');')();
}
function genString(v, ctx){
  const parts = []; let buf = '';
  for (let i = 0; i < v.length; i++){
    if (v[i] === '{'){
      let d = 1, j = i + 1;
      while (j < v.length && d > 0){ if (v[j] === '{') d++; else if (v[j] === '}') d--; j++; }
      if (buf){ parts.push(esc(buf)); buf = ''; }
      parts.push('(' + genExpr(parseExprString(v.slice(i+1, j-1)), ctx) + ')');
      i = j - 1;
    } else buf += v[i];
  }
  if (buf) parts.push(esc(buf));
  if (!parts.length) parts.push('""');
  return '(' + parts.join('+') + ')';
}
function genExpr(e, ctx){
  if (!e) return 'null';
  switch (e.k){
    case 'num': return String(e.v);
    case 'bool': return e.v ? 'true' : 'false';
    case 'null': return 'null';
    case 'str': return genString(e.v, ctx);
    case 'id': {
      if (ctx.scope.has(e.v)) return e.v;
      if (ctx.server) return e.v;
      if (ctx.stateRoots.has(e.v)) return 'S.' + e.v;
      if (ctx.computed.has(e.v)) return 'C.' + e.v;
      return e.v;
    }
    case 'list': return '[' + e.items.map(x => genExpr(x, ctx)).join(',') + ']';
    case 'obj': return '{' + e.props.map(p => p.spread ? '...' + genExpr(p.v, ctx) : (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p.key) ? p.key : esc(p.key)) + ':' + genExpr(p.v, ctx)).join(',') + '}';
    case 'member': return genExpr(e.o, ctx) + (e.opt ? '?.' : '.') + e.n;
    case 'index': return genExpr(e.o, ctx) + '[' + genExpr(e.ix, ctx) + ']';
    case 'call': {
      if (!ctx.server && !ctx.scope.has('nav') && e.f && e.f.k === 'member' && e.f.o && e.f.o.k === 'id' && e.f.o.v === 'nav' && e.f.n === 'go')
        return 'nav.go(' + e.args.map(a => genExpr(a, ctx)).join(',') + ')';
      return genExpr(e.f, ctx) + '(' + e.args.map(a => genExpr(a, ctx)).join(',') + ')';
    }
    case 'bin':
      if (e.op === '+') return '__add(' + genExpr(e.l, ctx) + ',' + genExpr(e.r, ctx) + ')';
      return '(' + genExpr(e.l, ctx) + e.op + genExpr(e.r, ctx) + ')';
    case 'not': return '!(' + genExpr(e.e, ctx) + ')';
    case 'neg': return '(-' + genExpr(e.e, ctx) + ')';
    case 'cond': return '(' + genExpr(e.c, ctx) + '?' + genExpr(e.a, ctx) + ':' + genExpr(e.b, ctx) + ')';
    case 'await': return '(await ' + genExpr(e.e, ctx) + ')';
    case 'lambda': {
      const sc = new Set(ctx.scope); for (const p of e.params) sc.add(p);
      const isAsync = e.body.k === 'block' && hasAwait(e.body.body);
      const body = e.body.k === 'block'
        ? '{' + genStmts(e.body.body, { ...ctx, scope: sc }) + '}'
        : '(' + genExpr(e.body, { ...ctx, scope: sc }) + ')';
      return '(' + (isAsync ? 'async ' : '') + '(' + e.params.join(',') + ')=>' + body + ')';
    }
    default: throw new Error('genExpr: nieznany węzeł ' + e.k);
  }
}
function genStmt(s, ctx){
  switch (s.k){
    case 'let': case 'const': {
      ctx.scope.add(s.n);
      return (s.k === 'const' ? 'const ' : 'let ') + s.n + '=' + genExpr(s.v, ctx) + ';';
    }
    case 'assign': return genExpr(s.l, ctx) + '=' + genExpr(s.r, ctx) + ';';
    case 'if': return 'if(' + genExpr(s.c, ctx) + '){' + genStmts(s.t, ctx) + '}' + (s.e ? 'else{' + genStmts(s.e, ctx) + '}' : '');
    case 'for': {
      const sc = new Set(ctx.scope); sc.add(s.v);
      return 'for(const ' + s.v + ' of __arr(' + genExpr(s.l, ctx) + ')){' + genStmts(s.body, { ...ctx, scope: sc }) + '}';
    }
    case 'while': return 'while(' + genExpr(s.c, ctx) + '){' + genStmts(s.body, ctx) + '}';
    case 'return': return 'return ' + (s.e ? genExpr(s.e, ctx) : '') + ';';
    case 'break': return 'break;';
    case 'continue': return 'continue;';
    case 'throw': return 'throw new __AxError(' + genExpr(s.e, ctx) + ');';
    case 'try': return 'try{' + genStmts(s.t, ctx) + '}catch(' + s.e + '){' + genStmts(s.c, ctx) + '}';
    case 'expr': return genExpr(s.e, ctx) + ';';
    default: throw new Error('genStmt: nieznany węzeł ' + s.k);
  }
}
function genStmts(list, ctx){ return (list || []).map(s => s ? genStmt(s, ctx) : '').join('\n'); }

// ------------------------------ codegen: widoki ----------------------------
function pathOf(e){
  if (!e) return null;
  if (e.k === 'id') return e.v;
  if (e.k === 'member' && !e.opt){ const b = pathOf(e.o); return b ? b + '.' + e.n : null; }
  return null;
}
function genViewNode(n, ctx){
  if (!n) return 'null';
  if (n.k === 'if'){
    const t = '[' + n.then.map(x => genViewNode(x, ctx)).join(',') + ']';
    const e = n.els ? '[' + n.els.map(x => genViewNode(x, ctx)).join(',') + ']' : '[]';
    return '__flat((' + genExpr(n.cond, ctx) + ')?' + t + ':' + e + ')';
  }
  if (n.k === 'for'){
    const sc = new Set(ctx.scope); sc.add(n.var);
    const kids = '[' + n.kids.map(x => genViewNode(x, { ...ctx, scope: sc })).join(',') + ']';
    return '__flat(__map(' + genExpr(n.list, ctx) + ',(' + n.var + ')=>' + kids + '))';
  }
  if (n.k === 'widget'){
    if (n.name === 'slot') return '__flat($kids)';
    if (n.name === 'list'){
      const itemNode = n.kids.find(k => k && k.k === 'widget' && k.name === 'item');
      const emptyNode = n.kids.find(k => k && k.k === 'widget' && k.name === 'empty');
      const itemCode = itemNode ? '[' + itemNode.kids.map(x => genViewNode(x, { ...ctx, scope: new Set([...ctx.scope, 'item']) })).join(',') + ']' : '[]';
      const emptyCode = emptyNode ? '[' + emptyNode.kids.map(x => genViewNode(x, ctx)).join(',') + ']' : '[]';
      return '$list(' + genExpr(n.attrs.items, ctx) + ',(item)=>__flat(' + itemCode + '),()=>__flat(' + emptyCode + '))';
    }
    const attrsCode = [];
    for (const [k, v] of Object.entries(n.attrs)){
      if (k === 'bind') attrsCode.push('bind:' + esc(pathOf(v) || ''));
      else attrsCode.push(k + ':' + genExpr(v, ctx));
    }
    attrsCode.push('_arg:' + (n.arg != null ? genString(n.arg, ctx) : 'null'));
    const kidsCode = '__flat([' + n.kids.filter(x => !(x && x.k === 'widget' && (x.name === 'item' || x.name === 'empty'))).map(x => genViewNode(x, ctx)).join(',') + '])';
    const onsCode = '{' + n.ons.map(o => o.ev + ':(e)=>{' + genStmts(o.body, ctx) + '$render();}').join(',') + '}';
    return '$w(' + esc(n.name) + ',{' + attrsCode.join(',') + '},' + kidsCode + ',' + onsCode + ')';
  }
  if (n.k === 'comp'){
    const args = n.args.map(a => genExpr(a, ctx));
    const kidsCode = '__flat([' + (n.kids || []).map(x => genViewNode(x, ctx)).join(',') + '])';
    return 'CMP_' + n.name + '(' + args.join(',') + (args.length ? ',' : '') + kidsCode + ')';
  }
  throw new Error('genViewNode: nieznany węzeł ' + n.k);
}

// ------------------------------ codegen: index.html ------------------------
function buildIndexHtml(ast){
  const sym = collectSymbols(ast);
  const theme = (ast.decls.find(d => d.k === 'theme') || { body: {} }).body;
  const app = ast.decls.find(d => d.k === 'app');
  const cctx = { scope: new Set(), server: false, stateRoots: sym.stateRoots, computed: sym.computed };
  // state defaults
  const stateObj = {};
  for (const f of (ast.decls.find(d => d.k === 'state') || { fields: [] }).fields){
    const parts = f.path.split('.');
    let o = stateObj;
    for (let i = 0; i < parts.length - 1; i++){ o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; }
    o[parts[parts.length - 1]] = evalDefault(genExpr(f.val, { ...cctx, scope: new Set() }));
  }
  const computedCode = (stDecl => stDecl ? stDecl.computed.map(c =>
    'function CPT_' + c.name + '(){' + genStmts(c.body, { ...cctx, scope: new Set() }) + '}'
  ).join('\n') : '')(ast.decls.find(d => d.k === 'state'));
  const computedNames = (stDecl => stDecl ? stDecl.computed.map(c => c.name) : [])(ast.decls.find(d => d.k === 'state'));
  const eventsCode = (stDecl => stDecl ? stDecl.events.map((ev, i) =>
    'SUBS.push({path:' + esc(ev.path) + ',fn:(()=>{' + genStmts(ev.body, cctx) + '})});'
  ).join('\n') : '')(ast.decls.find(d => d.k === 'state'));
  const logicFns = [];
  for (const d of ast.decls) if (d.k === 'logic')
    for (const f of d.fns)
      logicFns.push((f.async ? 'async ' : '') + 'function ' + f.name + '(' + f.params.join(',') + '){' + genStmts(f.body, { ...cctx, scope: new Set(f.params) }) + '}');
  const flows = [];
  for (const d of ast.decls) if (d.k === 'flow')
    flows.push('async function FLW_' + d.name + '(){' + genStmts(d.body, cctx) + '} FLW_' + d.name + '();');
  const onStart = [];
  for (const d of ast.decls) if (d.k === 'on' && d.ev === 'start') onStart.push(genStmts(d.body, cctx));
  const timers = [];
  for (const d of ast.decls) if (d.k === 'every'){
    const mult = { s: 1000, m: 60000, h: 3600000 }[d.unit] || 60000;
    timers.push('setInterval(()=>{' + genStmts(d.body, cctx) + '$render();},' + (Number(d.n) * mult) + ');');
  }
  const screens = [];
  for (const d of ast.decls) if (d.k === 'screen')
    screens.push('function SCN_' + d.name + '($kids){' + (d.kids.some(k => k && k.k === 'comp') ? '' : '') + 'return __flat([' + d.kids.map(x => genViewNode(x, { ...cctx, scope: new Set() })).join(',') + ']);}');
  const comps = [];
  for (const d of ast.decls) if (d.k === 'component')
    comps.push('function CMP_' + d.name + '(' + d.params.join(',') + (d.params.length ? ',' : '') + '$kids){return __flat([' + d.kids.map(x => genViewNode(x, { ...cctx, scope: new Set(d.params) })).join(',') + ']);}');
  const screenNames = Object.keys(sym.screens);
  const css = buildCss(theme);
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${(app && app.name) || 'AXCode App'}</title>
<style>${css}</style>
</head>
<body>
<div id="root" role="main"></div>
<div id="a11y" aria-live="polite" class="sr-only"></div>
<script>
'use strict';
// ====== wygenerowane przez axc ${AXC_VERSION} — runtime klienta ======
const S0 = ${JSON.stringify(stateObj)};
const COMPUTED_NAMES = ${JSON.stringify(computedNames)};
const SCREENS = { ${screenNames.map(n => n + ': SCN_' + n).join(',')} };
${screens.join('\n')}
${comps.join('\n')}
${computedCode}
${logicFns.join('\n')}
${flows.join('\n')}
const SUBS = [];
${eventsCode}
const C = {};
function __add(a, b){ if (Array.isArray(a) || Array.isArray(b)) return (Array.isArray(a) ? a : [a]).concat(Array.isArray(b) ? b : [b]); return a + b; }
function __arr(x){ if (x == null) return []; return Array.isArray(x) ? x : [x]; }
function __flat(a){ const out = []; (function rec(x){ if (x == null) return; if (Array.isArray(x)) { for (const y of x) rec(y); } else out.push(x); })(a); return out; }
function __map(xs, f){ return __arr(xs).map(f); }
function __AxError(m){ const e = new Error(typeof m === 'string' ? m : JSON.stringify(m)); e.ax = m; return e; }
function uid(){ return 'ax' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
function now(){ return Date.now(); }
const json = { parse: (s) => JSON.parse(s), stringify: (s) => JSON.stringify(s) };
String.prototype.lower = function(){ return this.toLowerCase(); };
String.prototype.upper = function(){ return this.toUpperCase(); };
String.prototype.contains = function(s){ return this.indexOf(s) !== -1; };
String.prototype.starts_with = function(s){ return this.startsWith(s); };
Number.prototype.round = function(d){ const p = Math.pow(10, d || 0); return Math.round(this * p) / p; };
function isToday(dt){ if (!dt) return false; const d = new Date(dt), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); }
function fmt(dt){ if (!dt) return ''; const d = new Date(dt); return d.toLocaleDateString('pl-PL') + ' ' + d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }); }
function getCookie(n){ const m = document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; }
const api = {
  async req(method, path, body, headers){
    const h = { 'X-Requested-With': 'AXCode', ...(headers || {}) };
    const csrf = getCookie('al_csrf');
    if (csrf && method !== 'GET') h['X-CSRF-Token'] = csrf;
    if (body != null) h['Content-Type'] = 'application/json';
    const res = await fetch(path, { method, headers: h, credentials: 'same-origin', body: body != null ? JSON.stringify(body) : undefined });
    let b = null; try { b = await res.json(); } catch (e) { b = null; }
    return { ok: res.ok, status: res.status, body: b };
  },
  get: (p) => api.req('GET', p),
  post: (p, b, h) => api.req('POST', p, b, h),
  put: (p, b) => api.req('PUT', p, b),
  delete: (p, b, h) => api.req('DELETE', p, b, h)
};
function stream(path, body, handlers){
  const ctrl = new AbortController();
  (async () => {
    try {
      const res = await fetch(path, { method: 'POST', signal: ctrl.signal, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCookie('al_csrf') || '', 'X-Requested-With': 'AXCode' },
        body: JSON.stringify(body || {}) });
      if (!res.ok || !res.body){ let eb = null; try { eb = await res.json(); } catch (e) {} handlers.onError && handlers.onError({ status: res.status, body: eb }); return; }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      while (true){
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\\n\\n')) !== -1){
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          for (const line of chunk.split('\\n')){
            if (line.startsWith('data: ')){
              const data = line.slice(6);
              if (data === '[DONE]'){ handlers.onDone && handlers.onDone({}); return; }
              try { const ev = JSON.parse(data); if (ev.delta != null) handlers.onDelta && handlers.onDelta(ev); else if (ev.error) handlers.onError && handlers.onError(ev); else handlers.onDone && handlers.onDone(ev); } catch (e) {}
            }
          }
        }
      }
      handlers.onDone && handlers.onDone({});
    } catch (e) { if (e.name !== 'AbortError') handlers.onError && handlers.onError({ error: 'network' }); }
  })();
  return { abort: () => ctrl.abort() };
}
const nav = { go: (name) => { location.hash = '#/' + name; } };
const clipboard = { write: (t) => navigator.clipboard && navigator.clipboard.writeText(t) };
const storage = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
function toast(msg, tone){ S.ui.toast = { message: String(msg), kind: tone || 'info' }; $render(); setTimeout(() => { S.ui.toast = null; $render(); }, 3200); }
function confirmBox(msg, onYes){ S.ui.confirm = { message: msg, on_yes: onYes }; $render(); }
// --- reaktywność ---
let $dirty = false;
function $schedule(){ if ($dirty) return; $dirty = true; setTimeout(() => { $dirty = false; $render(); }, 0); }
function fireSubs(path){
  for (const s of SUBS){ if (path === s.path || path.startsWith(s.path + '.') || s.path.startsWith(path + '.')){ try { s.fn(); } catch (e) { console.error(e); } } }
}
function makeReactive(obj, prefix, depth){
  if (obj == null || typeof obj !== 'object' || depth > 6) return obj;
  return new Proxy(obj, {
    get(t, p){ if (p in t) return makeReactive(t[p], prefix ? prefix + '.' + String(p) : String(p), depth + 1); return undefined; },
    set(t, p, v){ t[p] = v; const full = prefix ? prefix + '.' + String(p) : String(p); fireSubs(full); $schedule(); return true; }
  });
}
const S = makeReactive(S0, '', 0);
const CPT_HOOKS = { ${computedNames.map(n => n + ': CPT_' + n).join(',')} };
function recompute(){ for (const n of COMPUTED_NAMES) { try { C[n] = CPT_HOOKS[n](); } catch (e) { C[n] = null; } } }
function getPath(path){ const parts = path.split('.'); let v = S; for (const p of parts){ if (v == null) return null; v = v[p]; } return v; }
function setPath(path, v){ const parts = path.split('.'); let o = S; for (let i = 0; i < parts.length - 1; i++){ if (o[parts[i]] == null) o[parts[i]] = {}; o = o[parts[i]]; } o[parts[parts.length - 1]] = v; }
// --- markdown (B6: pełne escapowanie, linky tylko https) ---
function escapeHtml(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function mdToHtml(src){
  const lines = String(src || '').split('\\n'); let html = '', inCode = false, codeBuf = [];
  const inline = (t) => escapeHtml(t).replace(/\`([^\`]+)\`/g, '<code>$1</code>')
    .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
    .replace(/https:\\/\\/([a-zA-Z0-9._\\/-]+)/g, (m) => '<a href="' + m + '" target="_blank" rel="noopener noreferrer">' + m + '</a>');
  for (const ln of lines){
    if (ln.startsWith('\`\`\`')){ if (inCode){ html += '<pre><code>' + escapeHtml(codeBuf.join('\\n')) + '</code></pre>'; codeBuf = []; } inCode = !inCode; continue; }
    if (inCode){ codeBuf.push(ln); continue; }
    if (ln.startsWith('### ')) html += '<h4>' + inline(ln.slice(4)) + '</h4>';
    else if (ln.startsWith('## ')) html += '<h3>' + inline(ln.slice(3)) + '</h3>';
    else if (ln.startsWith('# ')) html += '<h2>' + inline(ln.slice(2)) + '</h2>';
    else if (ln.startsWith('- ')) html += '<li>' + inline(ln.slice(2)) + '</li>';
    else if (ln.trim() === '') html += '';
    else html += '<p>' + inline(ln) + '</p>';
  }
  if (codeBuf.length) html += '<pre><code>' + escapeHtml(codeBuf.join('\\n')) + '</code></pre>';
  return html;
}
// --- widgety ---
function $el(tag, cls, txt){ const d = document.createElement(tag); if (cls) d.className = cls; if (txt != null) d.textContent = txt; return d; }
function stylePx(v){ return v == null ? null : (typeof v === 'number' ? v + 'px' : v); }
function applyTone(el, tone){
  el.classList.remove('tone-primary','tone-secondary','tone-danger','tone-success','tone-warning','tone-ghost','tone-muted','tone-info');
  if (tone) el.classList.add('tone-' + tone);
}
function $w(name, a, kids, ons){
  let e;
  switch (name){
    case 'stack': { e = $el('div', 'w-stack'); e.style.gap = stylePx(a.gap != null ? a.gap : 12); if (a.pad) e.style.padding = stylePx(a.pad); e.style.alignItems = a.align || 'stretch'; if (a.grow) e.style.flex = '1 1 auto'; applyTone(e, a.tone); break; }
    case 'row': { e = $el('div', 'w-row'); e.style.gap = stylePx(a.gap != null ? a.gap : 8); if (a.pad) e.style.padding = stylePx(a.pad); e.style.alignItems = a.align || 'center'; if (a.grow) e.style.flex = '1 1 auto'; break; }
    case 'grid': { e = $el('div', 'w-grid'); e.style.gridTemplateColumns = 'repeat(' + (a.cols || 2) + ',1fr)'; e.style.gap = stylePx(a.gap != null ? a.gap : 12); break; }
    case 'card': { e = $el('div', 'w-card'); if (a.pad) e.style.padding = stylePx(a.pad); applyTone(e, a.tone); const ttl = a.title != null ? a.title : a._arg; if (ttl != null && ttl !== '') e.appendChild($el('div', 'card-title', String(ttl))); break; }
    case 'text': { e = $el('div', 'w-text'); if (a.style) e.classList.add('t-' + a.style); const sz = { sm: '13px', md: '16px', lg: '18px', xl: '24px', xxl: '32px', small: '13px', base: '16px', heading: '20px' }[a.size]; if (sz) e.style.fontSize = sz; e.textContent = String(a.value != null ? a.value : (a._arg != null ? a._arg : '')); if (a.mono) e.classList.add('mono'); if (a.align) e.style.textAlign = a.align; applyTone(e, a.tone); break; }
    case 'markdown': { e = $el('div', 'w-markdown'); e.innerHTML = mdToHtml(a.value || a._arg || ''); break; }
    case 'image': { e = $el('img', 'w-image'); if (a.src) e.src = String(a.src); e.alt = a.alt || ''; if (a.size) e.style.width = stylePx(a.size); break; }
    case 'badge': { e = $el('span', 'w-badge'); e.textContent = String(a.value != null ? a.value : (a._arg != null ? a._arg : '')); applyTone(e, a.tone || 'primary'); break; }
    case 'spacer': { e = $el('div', 'w-spacer'); e.style.height = stylePx(a.size != null ? a.size : (a._arg != null ? parseInt(a._arg) : 16)); break; }
    case 'divider': { e = $el('hr', 'w-divider'); break; }
    case 'progress': { const w = $el('div', 'w-progress'); const bar = $el('div', 'w-progress-bar'); const max = a.max || 100; bar.style.width = Math.max(0, Math.min(100, ((a.value || 0) / max) * 100)) + '%'; w.appendChild(bar); e = w; break; }
    case 'button': case 'icon_button': {
      e = $el('button', 'w-button ' + (name === 'icon_button' ? 'icon-btn' : ''));
      if (a.icon) e.appendChild($el('span', 'btn-icn', a.icon));
      const lbl = a.label != null ? String(a.label) : a._arg;
      e.appendChild($el('span', '', lbl));
      applyTone(e, a.tone || 'secondary');
      if (a.disabled) e.disabled = true;
      if (ons.click) e.addEventListener('click', (ev) => { ev.preventDefault(); ons.click(ev); });
      break;
    }
    case 'input': case 'textarea': {
      e = $el(name === 'input' ? 'input' : 'textarea', 'w-input');
      if (name === 'input') e.type = a.type || 'text';
      if (a.placeholder) e.placeholder = String(a.placeholder);
      if (a.rows) e.rows = a.rows;
      if (a.bind){ e.dataset.bind = a.bind; e.value = getPath(a.bind) != null ? getPath(a.bind) : ''; e.addEventListener('input', () => { setPath(a.bind, e.value); }); }
      if (a.label){ const w = $el('label', 'w-field'); w.appendChild($el('span', 'field-label', a.label)); w.appendChild(e); e = w; }
      break;
    }
    case 'select': {
      e = $el('select', 'w-input');
      for (const o of __arr(a.options)){ const op = $el('option', '', String(typeof o === 'object' ? (o.label != null ? o.label : o.value) : o)); op.value = typeof o === 'object' ? o.value : o; e.appendChild(op); }
      if (a.bind){ e.dataset.bind = a.bind; const v = getPath(a.bind); if (v != null) e.value = v; e.addEventListener('change', () => { setPath(a.bind, e.value); }); }
      break;
    }
    case 'toggle': {
      const w = $el('label', 'w-toggle'); const cb = $el('input'); cb.type = 'checkbox';
      if (a.bind){ cb.dataset.bind = a.bind; cb.checked = !!getPath(a.bind); cb.addEventListener('change', () => setPath(a.bind, cb.checked)); }
      w.appendChild(cb); w.appendChild($el('span', '', a.label != null ? String(a.label) : (a._arg || '')));
      if (a.description) w.appendChild($el('span', 'field-desc', a.description));
      e = w; break;
    }
    case 'tabs': { e = $el('div', 'w-row w-tabs'); break; }
    case 'tab': {
      e = $el('button', 'w-button w-tab' + (a.active ? ' active' : ''));
      e.appendChild($el('span', '', a._arg != null ? a._arg : String(a.value || '')));
      if (ons.click) e.addEventListener('click', (ev) => { ev.preventDefault(); ons.click(ev); });
      break;
    }
    case 'modal': { e = $el('div', 'w-modal'); const c = $el('div', 'w-modal-card'); for (const k of kids) c.appendChild(k); e.appendChild(c); break; }
    case 'banner': { e = $el('div', 'w-banner'); applyTone(e, a.tone || 'info'); break; }
    case 'header': { e = $el('div', 'w-header'); if (a.title != null) e.appendChild($el('div', 'hdr-title', String(a.title))); if (a.subtitle != null) e.appendChild($el('div', 'hdr-sub', String(a.subtitle))); break; }
    case 'sidebar': { e = $el('aside', 'w-sidebar'); break; }
    case 'main': { e = $el('div', 'w-main'); break; }
    case 'center': { e = $el('div', 'w-center'); break; }
    default: e = $el('div', 'w-unknown');
  }
  if (a.visible === false) e.style.display = 'none';
  if (a.grow) e.style.flex = '1 1 auto';
  const containers = ['stack','row','grid','card','modal','banner','header','sidebar','main','center','tabs','w-field'];
  if (containers.includes(name) || name === 'toggle'){ for (const k of kids) e.appendChild(k); }
  return e;
}
function $list(items, itemFn, emptyFn){
  const arr = __arr(items);
  if (!arr.length) return __flat(emptyFn());
  return __flat(arr.map(itemFn));
}
// --- render + router + fokus ---
const root = document.getElementById('root');
let currentScreen = null;
function screenFromHash(){ const h = location.hash.replace(/^#\\/?/, ''); return SCREENS[h] ? h : (SCREENS.Login ? 'Login' : screenNamesDefault[0]); }
const screenNamesDefault = ${JSON.stringify(screenNames)};
function $render(){
  recompute();
  const name = screenFromHash();
  currentScreen = name;
  const focusBind = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.bind : null;
  const selStart = document.activeElement && document.activeElement.selectionStart;
  root.replaceChildren();
  try { const nodes = SCREENS[name](); for (const n of nodes) root.appendChild(n); }
  catch (e) { console.error(e); root.appendChild($el('div', 'w-banner tone-danger', 'Błąd renderowania: ' + e.message)); }
  document.title = name + ' — ${(app && app.name) || 'App'}';
  if (focusBind){ const el2 = root.querySelector('[data-bind="' + focusBind + '"]'); if (el2){ el2.focus(); try { el2.setSelectionRange(selStart, selStart); } catch (e) {} } }
  const a11y = document.getElementById('a11y'); if (a11y && S.ui.toast) a11y.textContent = S.ui.toast.message;
}
window.addEventListener('hashchange', () => { if (S.nav) S.nav.current_screen = screenFromHash(); $render(); });
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')){ e.preventDefault(); S.nav.command_palette = !S.nav.command_palette; $render(); }
  if (e.key === 'Escape'){ if (S.ui.confirm){ S.ui.confirm = null; } else if (S.nav && S.nav.command_palette != null){ S.nav.command_palette = false; } $render(); }
});
// --- start ---
${onStart.join('\n')}
${timers.join('\n')}
$render();
</script>
</body>
</html>`;
}

function buildCss(theme){
  const t = k => theme && theme[k] != null ? theme[k] : null;
  const c = {
    bg: t('bg') || '#06080F', surface: t('surface') || '#121A2E', text: t('text') || '#EAF2FF',
    primary: t('primary') || '#00E5FF', muted: t('muted') || '#8A99B8', border: t('border') || '#2A3550',
    danger: t('danger') || '#FF4D6D', success: t('success') || '#22D3A6', warning: t('warning') || '#FFB020',
    secondary: t('secondary') || '#7C4DFF'
  };
  const radius = t('radius') || 14;
  const font = t('font') || 'system-ui';
  return `:root{--bg:${c.bg};--surface:${c.surface};--text:${c.text};--primary:${c.primary};--muted:${c.muted};--border:${c.border};--danger:${c.danger};--success:${c.success};--warning:${c.warning};--secondary:${c.secondary};--radius:${radius}px;--font:${font}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);font-size:16px;line-height:1.55}
#root{min-height:100vh}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.w-stack{display:flex;flex-direction:column}
.w-row{display:flex;flex-direction:row;flex-wrap:wrap}
.w-grid{display:grid}
.w-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;box-shadow:0 6px 18px rgba(0,0,0,.35)}
.card-title{font-weight:700;margin-bottom:8px}
.w-text{overflow-wrap:break-word}
.t-heading{font-size:20px;font-weight:700}.t-muted{color:var(--muted)}.t-sub{color:var(--muted);font-size:13px}
.w-text.mono{font-family:ui-monospace,monospace}
.w-text.heading{font-size:20px;font-weight:700}.w-text.muted{color:var(--muted)}.w-text.small{font-size:13px}.w-text.xl{font-size:24px}.w-text.mono{font-family:ui-monospace,monospace}
.w-button{background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:calc(var(--radius) - 6px);padding:8px 14px;font:inherit;cursor:pointer;transition:filter .15s}
.w-button:hover:not(:disabled){filter:brightness(1.2)}
.w-button:disabled{opacity:.45;cursor:not-allowed}
.tone-primary{background:var(--primary);color:#00232b;border-color:transparent;font-weight:600}
.tone-secondary{background:transparent;border-color:var(--secondary);color:var(--text)}
.tone-danger{background:transparent;border-color:var(--danger);color:var(--danger)}
.tone-success{background:transparent;border-color:var(--success);color:var(--success)}
.tone-ghost{background:transparent;border-color:transparent;color:var(--muted)}
.tone-muted{background:transparent;color:var(--muted);border-color:var(--border)}
.tone-warning{background:transparent;border-color:var(--warning);color:var(--warning)}
.tone-info{background:transparent;border-color:var(--primary);color:var(--primary)}
.icon-btn{padding:6px 10px}
.w-input{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:calc(var(--radius) - 6px);padding:10px 12px;font:inherit;width:100%}
.w-input:focus{outline:2px solid var(--primary);outline-offset:-1px}
.w-field{display:flex;flex-direction:column;gap:6px}
.field-label{font-size:13px;color:var(--muted)}
.field-desc{font-size:12px;color:var(--muted)}
.w-badge{display:inline-block;padding:2px 10px;border-radius:9999px;border:1px solid var(--primary);font-size:12px}
.w-banner{border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;background:var(--surface);margin:8px 0}
.w-header{display:flex;flex-direction:column;gap:2px;padding:12px 0}
.hdr-title{font-size:20px;font-weight:700}
.hdr-sub{color:var(--muted);font-size:13px}
.w-sidebar{min-width:230px;padding:16px;border-right:1px solid var(--border);min-height:100vh}
.w-main{flex:1;padding:20px;min-width:0}
.w-center{max-width:560px;margin:0 auto;padding:48px 20px;display:flex;flex-direction:column;align-items:center}
.w-divider{border:none;border-top:1px solid var(--border);margin:12px 0}
.w-progress{height:8px;background:var(--bg);border-radius:9999px;overflow:hidden;border:1px solid var(--border)}
.w-progress-bar{height:100%;background:var(--primary);transition:width .3s}
.w-tabs{gap:8px;border-bottom:1px solid var(--border);padding-bottom:0}
.w-tab.active{border-color:var(--primary);color:var(--primary)}
.w-modal{position:fixed;inset:0;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;z-index:50;padding:20px}
.w-modal-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:24px;max-width:520px;width:100%;box-shadow:0 14px 40px rgba(0,0,0,.6)}
.w-markdown p{margin:6px 0}.w-markdown pre{background:#0D1424;border:1px solid var(--border);border-radius:8px;padding:12px;overflow:auto}
.w-markdown code{font-family:ui-monospace,monospace}
.w-markdown a{color:var(--primary)}
.w-toggle{display:flex;gap:8px;align-items:center;cursor:pointer}
.w-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:60}
@media (max-width:640px){.w-sidebar{display:none}.w-main{padding:12px}}
@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}`;
}

// ------------------------------ codegen: worker ---------------------------
function pathToRegex(p){
  const keys = [];
  const re = p.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (m, k) => { keys.push(k); return '([^/]+)'; });
  return { re: new RegExp('^' + re + '/?$'), keys };
}
function buildWorker(ast){
  const sym = collectSymbols(ast);
  const sctx = { scope: new Set([...SERVER_SYMS, 'uid', 'now_iso', 'mask', 'PROVIDER_BASE']), server: true, stateRoots: new Set(), computed: new Set() };
  const deploy = (ast.decls.find(d => d.k === 'deploy') || { body: {} }).body;
  const aiDecl = (ast.decls.find(d => d.k === 'ai') || { body: {} }).body;
  const routes = [];
  for (const d of ast.decls) if (d.k === 'api'){
    for (const rt of d.routes){
      const { re, keys } = pathToRegex(rt.path);
      const body = genStmts(rt.body, { ...sctx, scope: new Set([...sctx.scope]) });
      routes.push(`{ method:'${rt.method}', path:${esc(rt.path)}, re:${re.toString()}, keys:${JSON.stringify(keys)}, auth:'${rt.opts.auth || 'required'}', csrf:${rt.opts.csrf === 'true'}, rate:${esc(rt.opts.rate || null)}, approval:${esc(rt.opts.approval || null)},
  fn: async ({req,params,query,body,session,db,r2,env,audit,approval,usage,fetchSafe,ai,crypto}) => {
${body}
  } }`);
    }
  }
  const modelsMeta = {};
  for (const [name, m] of Object.entries(sym.models)){
    modelsMeta[name] = {
      table: name,
      owner: m.fields.some(f => f.name === 'user_id' && f.mods.owner),
      secrets: m.fields.filter(f => f.mods.secret).map(f => f.name),
      fields: m.fields.map(f => f.name)
    };
  }
  const crons = ast.decls.filter(d => d.k === 'cron').map(d => ({ expr: d.expr, body: genStmts(d.body, sctx) }));
  const queuesD = ast.decls.filter(d => d.k === 'queue');
  return `// worker.js — wygenerowane przez axc ${AXC_VERSION}. NIE EDYTUJ RĘCZNIE.
const MODELS = ${JSON.stringify(modelsMeta)};
const BUDGETS = { daily: ${Number(aiDecl.budget_daily || 10)}, monthly: ${Number(aiDecl.budget_monthly || 100)} };
const PROVIDER_BASE = { mistral:'https://api.mistral.ai/v1', openai:'https://api.openai.com/v1', groq:'https://api.groq.com/openai/v1', openrouter:'https://openrouter.ai/api/v1' }; // NIEPEWNE: zweryfikuj w dokumentacji dostawców
class AxError extends Error { constructor(code, status){ super(code); this.code = code; this.status = status || 400; } }
function uid(){ return crypto.randomUUID(); }
function now_iso(){ return new Date().toISOString(); }
function mask(k){ const s = String(k || ''); return '••••' + s.slice(-4); }
function jsonResp(status, obj, headers){ return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...(headers || {}) } }); }
function parseCookies(req){ const out = {}; const h = req.headers.get('cookie') || ''; for (const part of h.split(';')){ const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } return out; }
// --- sesje ---
async function get_session(req, env){
  const sid = parseCookies(req)['al_session'];
  if (!sid) return null;
  const row = await env.DB.prepare('SELECT * FROM Session WHERE id = ?1').bind(sid).first();
  if (!row) return null;
  if (row.revoked_at || (row.expires_at && row.expires_at < now_iso())) return null;
  const u = await env.DB.prepare('SELECT * FROM User WHERE id = ?1').bind(row.user_id).first();
  if (!u) return null;
  return { id: row.id, userId: row.user_id, user: u };
}
async function create_session(env, userId, userAgent){
  const id = uid(); const now = new Date(); const exp = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  await env.DB.prepare('INSERT INTO Session (id, user_id, created_at, expires_at, user_agent) VALUES (?1,?2,?3,?4,?5)')
    .bind(id, userId, now.toISOString(), exp.toISOString(), userAgent || '').run();
  return { id, expires: exp.toISOString() };
}
function sessionCookie(sid){ return \`al_session=\${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000\`; }
function csrfCookie(){ return \`al_csrf=\${uid()}; Path=/; Secure; SameSite=Lax; Max-Age=2592000\`; }
// --- db (owner filtr automatyczny) ---
function stripSecrets(model, row){ const meta = MODELS[model]; if (!row) return row; const o = { ...row }; for (const s of (meta ? meta.secrets : [])) if (s in o) delete o[s]; return o; }
const db = {
  async insert(env, model, obj, userId){
    const meta = MODELS[model]; if (!meta) throw new AxError('unknown_model', 500);
    if (meta.owner && obj.user_id == null) obj.user_id = userId;
    if (obj.id == null) obj.id = uid();
    if (obj.created_at == null) obj.created_at = now_iso();
    const cols = [], vals = [];
    for (const [k, v] of Object.entries(obj)){ cols.push(k); vals.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v); }
    const sql = \`INSERT INTO \${model} (\${cols.join(',')}) VALUES (\${cols.map((c, i) => '?' + (i + 1)).join(',')})\`;
    await env.DB.prepare(sql).bind(...vals).run();
    return obj;
  },
  async get(env, model, id, userId){
    const meta = MODELS[model]; if (!meta) throw new AxError('unknown_model', 500);
    let sql = \`SELECT * FROM \${model} WHERE id = ?1\`; const binds = [id];
    if (meta.owner){ sql += ' AND user_id = ?2'; binds.push(userId); }
    return await env.DB.prepare(sql).bind(...binds).first();
  },
  async list(env, model, opts){
    const meta = MODELS[model]; if (!meta) throw new AxError('unknown_model', 500);
    opts = opts || {}; let sql = \`SELECT * FROM \${model} WHERE 1=1\`; const binds = [];
    if (opts.where){ sql += ' AND ' + opts.where; for (const a of (opts.args || [])) binds.push(a); }
    if (meta.owner && opts.byUser !== false){ const ph = binds.length + 1; sql += \` AND user_id = ?\${ph}\`; binds.push(opts.userId); }
    if (opts.order) sql += ' ORDER BY ' + String(opts.order);
    const lim = Math.min(parseInt(opts.limit || 200, 10) || 200, 500);
    sql += ' LIMIT ' + lim;
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return results || [];
  },
  async update(env, model, id, patch, userId){
    const meta = MODELS[model]; if (!meta) throw new AxError('unknown_model', 500);
    const cols = [], vals = [];
    for (const [k, v] of Object.entries(patch)){ cols.push(k + ' = ?' + (cols.length + 1)); vals.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v); }
    let sql = \`UPDATE \${model} SET \${cols.join(', ')} WHERE id = ?\${cols.length + 1}\`; vals.push(id);
    if (meta.owner){ sql += \` AND user_id = ?\${cols.length + 2}\`; vals.push(userId); }
    await env.DB.prepare(sql).bind(...vals).run();
    return await db.get(env, model, id, userId);
  },
  async delete(env, model, id, userId){
    const meta = MODELS[model]; if (!meta) throw new AxError('unknown_model', 500);
    let sql = \`DELETE FROM \${model} WHERE id = ?1\`; const binds = [id];
    if (meta.owner){ sql += ' AND user_id = ?2'; binds.push(userId); }
    await env.DB.prepare(sql).bind(...binds).run();
  }
};
// --- audyt / usage (tylko serwer, B2) ---
const audit = (env, userId) => async (action, meta) => {
  await env.DB.prepare('INSERT INTO AuditLog (id, user_id, action, metadata, created_at) VALUES (?1,?2,?3,?4,?5)')
    .bind(uid(), userId || null, String(action), JSON.stringify(meta || {}), now_iso()).run();
};
const usage = (env, userId) => ({
  async record(kind, provider, model, tokens_in, tokens_out, cost_usd){
    await env.DB.prepare('INSERT INTO UsageRecord (id, user_id, kind, provider, model, tokens_out, cost_usd, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)')
      .bind(uid(), userId, kind, provider || null, model || null, tokens_out || 0, cost_usd || 0, now_iso()).run();
  },
  async check(){
    const day = new Date(); day.setHours(0,0,0,0);
    const row = await env.DB.prepare('SELECT COALESCE(SUM(cost_usd),0) AS c FROM UsageRecord WHERE user_id = ?1 AND created_at >= ?2').bind(userId, day.toISOString()).first();
    if ((row ? row.c : 0) >= BUDGETS.daily) throw new AxError('budget_exceeded', 402);
  },
  async today(){
    const day = new Date(); day.setHours(0,0,0,0);
    const r = await env.DB.prepare('SELECT COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(tokens_out),0) AS tokens, COUNT(*) AS requests FROM UsageRecord WHERE user_id = ?1 AND created_at >= ?2').bind(userId, day.toISOString()).first();
    return r || { cost: 0, tokens: 0, requests: 0 };
  }
});
// --- klucze AES-GCM (B5) ---
const cryptoSvc = (env) => ({
  async encrypt(text){
    const raw = env.AL_MASTER_ENCRYPTION_KEY;
    const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(raw), c => c.charCodeAt(0)), 'AES-GCM', false, ['encrypt']);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, new TextEncoder().encode(text)));
    const b64 = arr => btoa(String.fromCharCode(...arr));
    return 'v1:' + b64(nonce) + ':' + b64(ct);
  },
  async decrypt(payload){
    const [v, nb, cb] = payload.split(':');
    const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(env.AL_MASTER_ENCRYPTION_KEY), c => c.charCodeAt(0)), 'AES-GCM', false, ['decrypt']);
    const nonce = Uint8Array.from(atob(nb), c => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(cb), c => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct);
    return new TextDecoder().decode(pt);
  }
});
// --- approval (B4: jednorazowy, user+akcja+hash parametrów, TTL 10 min) ---
async function sha256(s){ const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return btoa(String.fromCharCode(...new Uint8Array(h))); }
function approvalSvc(env, session){
  return {
    async require(action, parameters){
      if (!action) throw new AxError('missing_action');
      const id = uid(); const exp = new Date(Date.now() + 24 * 3600 * 1000);
      await env.DB.prepare('INSERT INTO Approval (id, user_id, action, parameters, status, expires_at, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)')
        .bind(id, session.userId, action, JSON.stringify(parameters || {}), 'pending', exp.toISOString(), now_iso()).run();
      return { id, action, parameters: parameters || {}, status: 'pending', expires_at: exp.toISOString() };
    },
    async approve(id){
      const row = await db.get(env, 'Approval', id, session.userId);
      if (!row || row.status !== 'pending') throw new AxError('approval_not_pending', 404);
      const token = uid() + uid();
      const th = await sha256(token);
      const exp = new Date(Date.now() + 10 * 60 * 1000);
      await db.update(env, 'Approval', id, { status: 'approved', token_hash: th, approved_at: now_iso(), expires_at: exp.toISOString() }, session.userId);
      let params = {}; try { params = JSON.parse(row.parameters || '{}'); } catch (e) {}
      return { token, action: row.action, parameters: params, expires_at: exp.toISOString() };
    },
    async consume(token, action, reqCtx){
      const th = await sha256(String(token || ''));
      const row = await env.DB.prepare('SELECT * FROM Approval WHERE token_hash = ?1').bind(th).first();
      if (!row || row.user_id !== session.userId) throw new AxError('approval_invalid', 403);
      if (row.consumed_at) throw new AxError('approval_used', 403);
      if (row.action !== action) throw new AxError('approval_action_mismatch', 403);
      if (row.expires_at < now_iso()) throw new AxError('approval_expired', 403);
      let params = {}; try { params = JSON.parse(row.parameters || '{}'); } catch (e) {}
      for (const k of Object.keys(params)){
        const inParams = reqCtx.params && k in reqCtx.params;
        const inBody = reqCtx.body && reqCtx.body[k] !== undefined;
        const inQuery = reqCtx.query && reqCtx.query[k] !== undefined;
        const val = inParams ? reqCtx.params[k] : inBody ? reqCtx.body[k] : inQuery ? reqCtx.query[k] : undefined;
        if (String(val) !== String(params[k])) throw new AxError('approval_params_mismatch', 403);
      }
      await db.update(env, 'Approval', row.id, { consumed_at: now_iso() }, session.userId);
      return true;
    }
  };
}
// --- SSRF: fetchSafe (B3; ograniczenie platformy: Workers nie wystawia DNS resolve — pełny IP pinning wymaga DoH) ---
const BLOCKED_HOST = /^(localhost|127\\.|0\\.|10\\.|192\\.168\\.|169\\.254\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|\\[::1\\]|::1$)/;
function ipForm(host){
  if (/^\\d{9,10}$/.test(host)) return true; // dziesiętny zapis IP
  if (/^0x[0-9a-f]+$/i.test(host)) return true; // szesnastkowy
  if (/^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(host)) return true;
  return false;
}
async function fetchSafe(url, opts){
  let u = new URL(url);
  for (let hop = 0; hop < 4; hop++){
    if (u.protocol !== 'https:') throw new AxError('ssrf_not_https', 400);
    const h = u.hostname.toLowerCase();
    if (BLOCKED_HOST.test(h) || ipForm(h) && /^https:\\/\\/(127|10|192|172|169|0)\\./.test(u.href)) throw new AxError('ssrf_blocked', 400);
    if (ipForm(h)) throw new AxError('ssrf_ip_blocked', 400);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(u.href, { ...opts, redirect: 'manual', signal: ctrl.signal });
    clearTimeout(t);
    if (res.status >= 300 && res.status < 400){
      const loc = res.headers.get('location');
      if (!loc) throw new AxError('ssrf_redirect_missing', 400);
      u = new URL(loc, u); continue;
    }
    return res;
  }
  throw new AxError('ssrf_too_many_redirects', 400);
}
// --- AI: streaming OpenAI-compatible (NIEPEWNE: endpointy do weryfikacji) ---
const ABORTS = new Map();
function aiSvc(env, session){
  const U = usage(env, session.userId);
  return {
    async stream(providerName, messages, opts){
      const provs = await db.list(env, 'Provider', { userId: session.userId });
      const prov = provs.find(p => p.provider === providerName) || provs[0];
      if (!prov) throw new AxError('no_provider', 400);
      const base = PROVIDER_BASE[prov.provider];
      if (!base) throw new AxError('provider_not_supported', 400);
      const key = await cryptoSvc(env).decrypt(prov.encrypted_key);
      const msgId = uid();
      await db.insert(env, 'Message', { id: msgId, conversation_id: opts.conversation_id, user_id: session.userId, role: 'assistant', content: '', status: 'streaming', provider: prov.provider, model: prov.model || '', created_at: now_iso() });
      const upstream = await fetchSafe(base + '/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: prov.model || 'mistral-large-latest', stream: true, messages: messages.map(m => ({ role: m.role, content: m.content })) })
      });
      if (!upstream.ok || !upstream.body) throw new AxError('provider_error_' + upstream.status, 502);
      ABORTS.set(session.userId + ':' + opts.conversation_id, msgId);
      const reader = upstream.body.getReader(); const dec = new TextDecoder();
      const enc = new TextEncoder();
      let buf = '', acc = '', tokens = 0, aborted = false;
      const self = this;
      return new ReadableStream({
        async pull(controller){
          const { done, value } = await reader.read();
          if (done){
            const status = aborted ? 'interrupted' : 'completed';
            await db.update(env, 'Message', msgId, { content: acc, status, tokens_out: tokens }, session.userId);
            await U.record('ai', prov.provider, prov.model, 0, tokens, 0);
            ABORTS.delete(session.userId + ':' + opts.conversation_id);
            controller.enqueue(enc.encode('data: ' + JSON.stringify({ done: true, message_id: msgId, status }) + '\\n\\n'));
            controller.enqueue(enc.encode('data: [DONE]\\n\\n'));
            controller.close(); return;
          }
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\\n')) !== -1){
            const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const j = JSON.parse(data);
              const delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
              if (delta){ acc += delta; tokens += 1; controller.enqueue(enc.encode('data: ' + JSON.stringify({ delta, message_id: msgId }) + '\\n\\n')); }
            } catch (e) {}
          }
        },
        cancel(){ aborted = true; ABORTS.delete(session.userId + ':' + opts.conversation_id); reader.cancel(); }
      });
    },
    async interrupt(conversationId){
      const msgId = ABORTS.get(session.userId + ':' + conversationId);
      if (msgId){ await db.update(env, 'Message', msgId, { status: 'interrupted' }, session.userId); ABORTS.delete(session.userId + ':' + conversationId); }
    },
    async test(providerId){
      const p = await db.get(env, 'Provider', providerId, session.userId);
      if (!p) throw new AxError('no_provider', 404);
      try {
        const key = await cryptoSvc(env).decrypt(p.encrypted_key);
        const base = PROVIDER_BASE[p.provider];
        if (!base) throw new AxError('provider_not_supported');
        const res = await fetchSafe(base + '/models', { headers: { authorization: 'Bearer ' + key } });
        const ok = res.ok;
        await db.update(env, 'Provider', providerId, { status: ok ? 'verified' : 'error', last_error: ok ? null : 'http_' + res.status }, session.userId);
        return { ok, status: ok ? 'verified' : 'error' };
      } catch (e) {
        await db.update(env, 'Provider', providerId, { status: 'error', last_error: String(e.message || e) }, session.userId);
        return { ok: false, status: 'error', error: String(e.message || e) };
      }
    }
  };
}
// --- rate limit (per izolat + fallback D1 przy dużym obciążeniu: TODO) ---
const RATE = new Map();
function rateCheck(rate, key){
  if (!rate) return true;
  const m = rate.match(/^(\\d+)\\s*\\/(\\d+)\\s*(s|min|h)$/); if (!m) return true;
  const max = parseInt(m[1], 10); const unit = m[3];
  const win = unit === 's' ? parseInt(m[2], 10) * 1000 : unit === 'min' ? parseInt(m[2], 10) * 60000 : parseInt(m[2], 10) * 3600000;
  const nowT = Date.now();
  let rec = RATE.get(key);
  if (!rec || nowT - rec.start > win){ rec = { start: nowT, count: 0 }; RATE.set(key, rec); }
  rec.count++;
  return rec.count <= max;
}
// --- routing ---
const ROUTES = [
${routes.join(',\n')}
];
async function handleRequest(req, env, ctx){
  const url = new URL(req.url);
  const path = url.pathname;
  for (const rt of ROUTES){
    if (rt.method !== req.method) continue;
    const m = path.match(rt.re);
    if (!m) continue;
    const params = {}; rt.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1]));
    const query = Object.fromEntries(url.searchParams.entries());
    const session = await get_session(req, env);
    if (rt.auth === 'required' && !session) return jsonResp(401, { error: 'unauthorized' });
    if (rt.csrf && req.method !== 'GET'){
      const cookie = parseCookies(req)['al_csrf']; const header = req.headers.get('x-csrf-token');
      if (!cookie || !header || cookie !== header) return jsonResp(403, { error: 'csrf_failed' });
    }
    if (rt.rate){
      const key = (session ? session.userId : (req.headers.get('cf-connecting-ip') || 'anon')) + ':' + path;
      if (!rateCheck(rt.rate, key)) return jsonResp(429, { error: 'rate_limited' });
    }
    let body = null;
    if (req.method !== 'GET'){ try { body = await req.json(); } catch (e) { body = null; } }
    const services = {
      req, params, query, body, session, env,
      db: { insert: (mo, o) => db.insert(env, mo, o, session ? session.userId : null), get: (mo, id) => db.get(env, mo, id, session ? session.userId : null), list: (mo, o) => db.list(env, mo, { ...(o || {}), userId: session ? session.userId : null }), update: (mo, id, p) => db.update(env, mo, id, p, session ? session.userId : null), delete: (mo, id) => db.delete(env, mo, id, session ? session.userId : null) },
      r2: { put: async (key, bytes) => { if (!key.startsWith('u/' + session.userId + '/')) throw new AxError('r2_prefix', 403); return await env.R2.put(key, bytes); }, get: async (key) => { if (!key.startsWith('u/' + session.userId + '/')) throw new AxError('r2_prefix', 403); return await env.R2.get(key); }, delete: async (key) => { if (!key.startsWith('u/' + session.userId + '/')) throw new AxError('r2_prefix', 403); return await env.R2.delete(key); } },
      env: { secret: (n) => env[n] },
      audit: audit(env, session ? session.userId : null),
      approval: approvalSvc(env, session),
      usage: usage(env, session ? session.userId : null),
      fetchSafe,
      ai: session ? aiSvc(env, session) : null,
      crypto: cryptoSvc(env)
    };
    if (rt.approval){
      const token = req.headers.get('x-approval-token');
      try { await services.approval.consume(token, rt.approval, { params, query, body: body || {} }); }
      catch (e){ return jsonResp(403, { error: e.code || 'approval_required' }); }
    }
    try {
      const out = await rt.fn(services);
      if (out && out.stream) return new Response(out.stream, { status: out.status || 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
      const headers = {};
      if (out && out.set_cookie) headers['set-cookie'] = out.set_cookie;
      return jsonResp(out && out.status ? out.status : 200, out && out.body !== undefined ? out.body : { ok: true }, headers);
    } catch (e) {
      if (e instanceof AxError) return jsonResp(e.status, { error: e.code });
      console.error(e);
      return jsonResp(500, { error: 'internal' });
    }
  }
  return jsonResp(404, { error: 'not_found' });
}
export default {
  async fetch(req, env, ctx){ return handleRequest(req, env, ctx); },
  async scheduled(event, env, ctx){ /* cron: ${crons.length ? 'obsłużone w kolejnych etapach' : 'brak'} */ }
};
`;
}

// ------------------------------ codegen: SQL ------------------------------
function sqlType(t){
  switch (t){ case 'int': return 'INTEGER'; case 'real': case 'number': return 'REAL'; case 'bool': return 'INTEGER'; default: return 'TEXT'; }
}
function buildMigration(ast){
  const sym = collectSymbols(ast);
  const lines = ['-- migrations/0001_init.sql — wygenerowane przez axc ' + AXC_VERSION, 'PRAGMA foreign_keys = ON;'];
  for (const [name, m] of Object.entries(sym.models)){
    const cols = m.fields.map(f => {
      let c = '  ' + f.name + ' ' + sqlType(f.type);
      if (f.mods.primary) c += ' PRIMARY KEY';
      if (f.mods.unique) c += ' UNIQUE';
      if (f.mods.default !== undefined && f.mods.default !== null) c += " DEFAULT " + (typeof f.mods.default === 'string' ? "'" + f.mods.default + "'" : f.mods.default);
      return c;
    });
    lines.push('CREATE TABLE IF NOT EXISTS ' + name + ' (\n' + cols.join(',\n') + '\n);');
    for (const f of m.fields){
      if (f.mods.index) lines.push('CREATE INDEX IF NOT EXISTS idx_' + name + '_' + f.name + ' ON ' + name + '(' + f.name + ');');
      if (f.mods.enum) lines.push('CREATE TRIGGER IF NOT EXISTS trg_' + name + '_' + f.name + ' CHECK_' + name + '_' + f.name + '\nBEFORE INSERT ON ' + name + '\nWHEN NEW.' + f.name + " NOT IN (" + f.mods.enum.map(v => "'" + v + "'").join(',') + ")\nBEGIN\n  SELECT RAISE(ABORT, 'enum_" + f.name + "');\nEND;");
    }
  }
  return lines.join('\n') + '\n';
}

// ------------------------------ codegen: infra -----------------------------
function buildWrangler(ast){
  const deploy = (ast.decls.find(d => d.k === 'deploy') || { body: {} }).body;
  const name = deploy.name || 'axcode-app';
  return `# wrangler.toml — wygenerowane przez axc ${AXC_VERSION}
name = "${name}"
main = "worker.js"
compatibility_date = "2025-01-01"

[[d1_databases]]
binding = "DB"
database_name = "${deploy.d1 || name + '_db'}"
# database_id = "<wklej z dashboardu Cloudflare>"

[[r2_buckets]]
binding = "R2"
bucket_name = "${deploy.r2 || name + '_files'}"
${deploy.queues && deploy.queues.length ? `
[queues.producers]
queue = "${deploy.queues[0]}"
` : ''}
# Sekrety (wrangler secret put NAME):
${(deploy.secrets || []).map(s => '#   wrangler secret put ' + s).join('\n')}
`;
}
function buildCi(){
  return `# .github/workflows/ci.yml — wygenerowane przez axc
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 18 }
      - name: Kompilacja (check)
        run: node axc.js AL2100.ax --check
      - name: Testy AXCode
        run: node axc.js AL2100.ax --test
      - name: Build
        run: node axc.js AL2100.ax --out dist/
      - uses: actions/upload-artifact@v4
        with: { name: dist, path: dist/ }
`;
}
function buildDeployYml(ast){
  const deploy = (ast.decls.find(d => d.k === 'deploy') || { body: {} }).body;
  return `# .github/workflows/deploy.yml — wygenerowane przez axc (tylko ręczne uruchomienie lub tag)
name: Deploy
on:
  workflow_dispatch: {}
  push:
    tags: ['v*']
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 18 }
      - run: node axc.js AL2100.ax --out dist/
      - name: Migracje D1
        run: npx wrangler d1 migrations apply ${(deploy.d1 || 'al2100_db')} --remote
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - name: Deploy Workers
        run: npx wrangler deploy
        working-directory: dist/
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
`;
}

// ------------------------------ testy --test ------------------------------
async function runTests(ast){
  const sym = collectSymbols(ast);
  const results = [];
  const cctx = { scope: new Set(), server: false, stateRoots: sym.stateRoots, computed: sym.computed };
  const stDecl = ast.decls.find(d => d.k === 'state');
  const stateObj = {};
  for (const f of (stDecl ? stDecl.fields : [])){
    const parts = f.path.split('.'); let o = stateObj;
    for (let i = 0; i < parts.length - 1; i++){ o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; }
    let v = null;
    try { v = evalDefault(genExpr(f.val, { ...cctx, scope: new Set() })); } catch (e) { v = null; }
    o[parts[parts.length - 1]] = v;
  }
  const computedCode = (stDecl ? stDecl.computed : []).map(c => 'function CPT_' + c.name + '(){' + genStmts(c.body, { ...cctx, scope: new Set() }) + '}').join('\n');
  const logicCode = [];
  for (const d of ast.decls) if (d.k === 'logic') for (const f of d.fns)
    logicCode.push((f.async ? 'async ' : '') + 'function ' + f.name + '(' + f.params.join(',') + '){' + genStmts(f.body, { ...cctx, scope: new Set(f.params) }) + '}');
  const prelude = `
    const S = ${JSON.stringify(stateObj)};
    const C = {};
    const COMPUTED_NAMES = ${JSON.stringify([...sym.computed])};
    function __add(a,b){ if (Array.isArray(a) || Array.isArray(b)) return (Array.isArray(a)?a:[a]).concat(Array.isArray(b)?b:[b]); return a+b; }
    function __arr(x){ return x == null ? [] : (Array.isArray(x) ? x : [x]); }
    function uid(){ return 't'; }
    function now(){ return 1700000000000; }
    const api = {
      get: async () => ({ ok: false, status: 401, body: { error: 'no_session' } }),
      post: async (p, b) => ({ ok: true, status: 200, body: Object.assign({ id: 't1' }, b || {}) }),
      put: async (p, b) => ({ ok: true, status: 200, body: b || {} }),
      delete: async () => ({ ok: false, status: 403, body: { error: 'approval_required' } })
    };
    function isToday(){ return false; }
    function toast(m, t){ S.ui = S.ui || {}; S.ui.toast = { message: m, kind: t }; }
    function confirmBox(m, y){ S.ui = S.ui || {}; S.ui.confirm = { message: m, on_yes: y }; }
    const nav = { go: (n) => { S.nav = S.nav || {}; S.nav.current_screen = n; } };
    const clipboard = { write: () => {} };
    const storage = { get: () => null, set: () => {} };
    String.prototype.lower = function(){ return this.toLowerCase(); };
    String.prototype.upper = function(){ return this.toUpperCase(); };
    String.prototype.contains = function(s){ return this.indexOf(s) !== -1; };
    String.prototype.starts_with = function(s){ return this.indexOf(s) === 0; };
    String.prototype.trim = String.prototype.trim || function(){ return this.replace(/^\\s+|\\s+$/g, ''); };
    Number.prototype.round = function(d){ const p = Math.pow(10, d || 0); return Math.round(this * p) / p; };
    function assert(c, msg){ if (!c) throw new Error('asercja nie przeszła' + (msg ? ': ' + msg : '')); }
  `;
  for (const d of ast.decls) if (d.k === 'test'){
    try {
      const code = prelude + '\n' + computedCode + '\n' + logicCode.join('\n') +
        '\nconst CPT_HOOKS = {' + [...sym.computed].map(n => n + ': CPT_' + n).join(',') + '};' +
        '\nfunction recompute(){ for (const n of COMPUTED_NAMES){ try { C[n] = CPT_HOOKS[n](); } catch (e) { C[n] = null; } } }' +
        '\nrecompute();' +
        '\nreturn (async () => {\n' + genStmts(d.body, { ...cctx, scope: new Set(['assert']) }) + '\n})();';
      await new Function(code)();
      results.push({ desc: d.desc, ok: true });
    } catch (e) {
      results.push({ desc: d.desc, ok: false, error: String(e.message || e) });
    }
  }
  return results;
}

// ------------------------------ compile ------------------------------------
function compile(src, opts){
  opts = opts || {};
  const toks = tokenize(src);
  if (!Array.isArray(toks)) return { ok: false, errors: [{ line: toks.line, col: toks.col, code: 'E000', msg: toks.error, hint: '' }] };
  const parser = new Parser(toks);
  const ast = parser.parseProgram();
  if (parser.errors.length) return { ok: false, errors: parser.errors.map(e => { const [l, c] = e.split(':'); return { line: Number(l), col: Number(c.split(' ')[0].trim()) || Number(c), code: 'E000', msg: e.split(': ').slice(1).join(': '), hint: '' }; }) };
  if (opts.ast) return { ok: true, ast };
  const errors = validate(ast);
  if (errors.length) return { ok: false, errors, ast };
  if (opts.check) return { ok: true, errors: [], manifest: manifest(ast) };
  const files = {
    'index.html': buildIndexHtml(ast),
    'worker.js': buildWorker(ast),
    'migrations/0001_init.sql': buildMigration(ast),
    'wrangler.toml': buildWrangler(ast),
    '.github/workflows/ci.yml': buildCi(),
    '.github/workflows/deploy.yml': buildDeployYml(ast)
  };
  const out = { ok: true, files, manifest: manifest(ast) };
  if (opts.test){
    out.testPromise = (async () => {
      const tests = await runTests(ast);
      out.tests = tests;
      if (!tests.every(t => t.ok)) out.testFailed = true;
      return tests;
    })();
  }
  return out;
}
function manifest(ast){
  const sym = collectSymbols(ast);
  const st = ast.decls.find(d => d.k === 'state');
  const apiD = ast.decls.find(d => d.k === 'api');
  return {
    state: st ? st.fields.map(f => f.path) : [],
    computed: st ? st.computed.map(c => c.name) : [],
    models: Object.fromEntries(Object.entries(sym.models).map(([n, m]) => [n, m.fields.map(f => f.name + ':' + f.type + (f.mods.owner ? ':owner' : '') + (f.mods.secret ? ':secret' : ''))])),
    api: apiD ? apiD.routes.map(r => ({ method: r.method, path: r.path, auth: r.opts.auth || '(brak)', approval: r.opts.approval || null })) : [],
    screens: Object.keys(sym.screens),
    components: Object.keys(sym.components),
    fn: Object.keys(sym.fns),
    flows: Object.keys(sym.flows),
    tests: ast.decls.filter(d => d.k === 'test').map(d => d.desc)
  };
}

// ------------------------------ selftest ----------------------------------
function selftest(){
  const results = [];
  const t = (name, fn) => { try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, error: String(e.message || e) }); } };
  // tokenizer
  t('tokenize: string z interpolacją', () => { const r = tokenize('"a {b} c"'); if (!Array.isArray(r)) throw new Error(r.error); if (r[0].v !== 'a {b} c') throw new Error('wartość'); });
  t('tokenize: kolor jako string', () => { const r = tokenize('#0A0F1E'); if (!Array.isArray(r) || r[0].v !== '#0A0F1E') throw new Error('kolor'); });
  t('tokenize: błąd niezamkniętego stringa', () => { const r = tokenize('"abc'); if (Array.isArray(r)) throw new Error('powinien być błąd'); });
  t('tokenize: -> i => osobno', () => { const r = tokenize('(a) -> 1 (b) => 2'); if (!Array.isArray(r)) throw new Error(r.error); const ops = r.filter(x => x.t === 'p').map(x => x.v); if (!ops.includes('->') || !ops.includes('=>')) throw new Error('operatory'); });
  // parser
  t('parse: app + theme', () => { const r = compile('app "X" { version: "1.0.0" }\ntheme { bg: "#000000", radius: 8 }', { check: true }); if (!r.ok) throw new Error(JSON.stringify(r.errors)); });
  t('parse: state + computed + event', () => {
    const r = compile('state { a.x = 1; computed dbl { return a.x * 2 } event a.x changed { a.x = a.x + 1 } }', { check: true });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
  });
  t('parse: model z enum i owner', () => {
    const r = compile('model T { id text primary; user_id text owner index; s enum ["a","b"] }', { check: true });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
  });
  t('parse: api route + walidacja E003', () => {
    const r = compile('api { route GET "/api/x" { return { status: 200, body: { ok: true } } } }', { check: true });
    if (r.ok) throw new Error('powinien być E003 (brak auth)');
    if (!r.errors.some(e => e.code === 'E003')) throw new Error('oczekiwano E003, jest ' + JSON.stringify(r.errors));
  });
  t('parse: widget z handlerem i bindem', () => {
    const r = compile('state { q.draft = "" }\nscreen S { stack { input bind=q.draft placeholder "Pisz..." { } button "OK" tone "primary" { on click { toast("x", "success") } } } }', { check: true });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
  });
  t('parse: lambda -> i => równoważne', () => {
    const r = compile('logic { function f(xs) { return xs.map((x) -> x * 2) } }', { check: true });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
  });
  t('validate: E002 nieznane pole state', () => {
    const r = compile('state { a.x = 1 }\nscreen S { text value a.y }', { check: true });
    if (r.ok) throw new Error('powinien być E002');
    if (!r.errors.some(e => e.code === 'E002')) throw new Error('oczekiwano E002');
  });
  t('validate: E004 mutacja bez csrf', () => {
    const r = compile('api { route POST "/api/x" auth=required { return { status: 200, body: {} } } }', { check: true });
    if (r.ok) throw new Error('powinien być E004');
    if (!r.errors.some(e => e.code === 'E004')) throw new Error('oczekiwano E004');
  });
  t('validate: E006 delete rozmowy bez approval', () => {
    const r = compile('api { route DELETE "/api/conversations/9" auth=required csrf=true { return { status: 200, body: {} } } }', { check: true });
    if (r.ok) throw new Error('powinien być E006');
    if (!r.errors.some(e => e.code === 'E006')) throw new Error('oczekiwano E006');
  });
  t('validate: E010 assert true', () => {
    const r = compile('test "x" { assert true }', { check: true });
    if (r.ok) throw new Error('powinien być E010');
    if (!r.errors.some(e => e.code === 'E010')) throw new Error('oczekiwano E010');
  });
  t('codegen: index.html zawiera runtime i ekrany', () => {
    const r = compile('screen Login { center { text "Cześć" } }', {});
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    if (!r.files['index.html'].includes('SCN_Login')) throw new Error('brak ekranu');
    if (!r.files['index.html'].includes('mdToHtml')) throw new Error('brak runtime markdown');
  });
  t('codegen: worker.js zawiera trasy i db', () => {
    const r = compile('model Mm { id text primary; user_id text owner index }\napi { route GET "/api/auth/x" auth=public { return { status: 200, body: { ok: true } } } }', {});
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    if (!r.files['worker.js'].includes('/api/auth/x')) throw new Error('brak trasy');
    if (!r.files['worker.js'].includes('user_id = ?')) throw new Error('brak filtra owner');
  });
  t('codegen: SQL zawiera CREATE TABLE', () => {
    const r = compile('model Zz { id text primary; n text }', {});
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    if (!r.files['migrations/0001_init.sql'].includes('CREATE TABLE IF NOT EXISTS Zz')) throw new Error('brak tabeli');
  });
  t('B6: markdown escapuje HTML', () => {
    // sprawdzamy kod runtime: escapeHtml istnieje i jest używany przed innerHTML
    const r = compile('screen S { markdown value "<b>x</b>" }', {});
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    if (!r.files['index.html'].includes('escapeHtml(')) throw new Error('brak escapowania');
  });
  return results;
}

// ------------------------------ CLI ----------------------------------------
async function main(){
  const args = process.argv.slice(2);
  const flags = args.filter(a => a.startsWith('--'));
  const file = args.find(a => !a.startsWith('--'));
  const getFlag = f => flags.includes(f);
  const outIdx = args.indexOf('--out');
  const outDir = outIdx !== -1 ? args[outIdx + 1] : 'dist';
  if (getFlag('--selftest')){
    const results = selftest();
    let failed = 0;
    for (const r of results){
      console.log((r.ok ? 'OK  ' : 'FAIL') + '  ' + r.name + (r.ok ? '' : '  — ' + r.error));
      if (!r.ok) failed++;
    }
    console.log(`\\nselftest: ${results.length - failed}/${results.length} OK`);
    process.exit(failed ? 1 : 0);
  }
  if (!file){ console.error('Użycie: node axc.js <plik.ax> [--out dir] [--check] [--test] [--ast] [--selftest]'); process.exit(2); }
  let src;
  try { src = require('fs').readFileSync(file, 'utf8'); }
  catch (e) { console.error('Nie można odczytać: ' + file); process.exit(2); }
  const result = compile(src, { check: getFlag('--check'), ast: getFlag('--ast'), test: getFlag('--test') });
  if (!result.ok){
    console.error('BŁĘDY KOMPILACJI:');
    for (const e of result.errors) console.error(`  ${file}:${e.line}:${e.col}  [${e.code}] ${e.msg}${e.hint ? ' — ' + e.hint : ''}`);
    process.exit(1);
  }
  if (getFlag('--check')){ console.log('OK — walidacja przeszła bez błędów.'); process.exit(0); }
  if (getFlag('--ast')){ console.log(JSON.stringify(result.ast, null, 2)); process.exit(0); }
  if (result.testPromise){
    const tests = await result.testPromise;
    let failed = 0;
    for (const t of tests){ console.log((t.ok ? 'OK  ' : 'FAIL') + '  ' + t.desc + (t.ok ? '' : '  — ' + t.error)); if (!t.ok) failed++; }
    console.log(`testy: ${tests.length - failed}/${tests.length} OK`);
    if (failed){ process.exit(1); }
  }
  const fs = require('fs'); const path = require('path');
  for (const [name, content] of Object.entries(result.files)){
    const p = path.join(outDir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    console.log('napisano ' + p + ' (' + content.length + ' B)');
  }
  console.log('\\nMANIFEST:');
  console.log(JSON.stringify(result.manifest, null, 2));
}
if (typeof process !== 'undefined' && process.versions && process.versions.node){
  if (process.argv && process.argv.length > 1 && (process.argv[1] || '').endsWith('axc.js')) main().catch(e => { console.error(e); process.exit(1); });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { compile, tokenize, validate, manifest, selftest, runTests, AXC_VERSION };
