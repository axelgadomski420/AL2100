#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const VERSION = '4.0.0';
const ROOT = process.cwd();

const IDENT_CHAR = /[\p{L}\p{N}_$.-]/u;
const IDENT_START = /[\p{L}_$]/u;
const HEX_DIGIT = /[0-9A-Fa-f]/u;

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
        const map = {
          n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v',
          '\\': '\\', '"': '"', "'": "'", u: 'u'
        };
        if (e === 'u') {
          const hex = this.src.slice(this.pos, this.pos + 4);
          if (/^[0-9A-Fa-f]{4}$/u.test(hex)) {
            s += String.fromCodePoint(parseInt(hex, 16));
            this.pos += 4;
            continue;
          }
          s += map[e] ?? e;
          continue;
        }
        s += map[e] ?? e;
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
      if (IDENT_CHAR.test(c)) s += this.advance();
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
      if (c === '#' && HEX_DIGIT.test(this.peek(1) || '')) {
        let s = '#';
        this.advance();
        while (!this.atEnd() && HEX_DIGIT.test(this.peek())) s += this.advance();
        this.tokens.push({ type: T.COLOR, value: s, line, col });
        continue;
      }
      const dm = this.src.slice(this.pos).match(/^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?/u);
      if (dm) {
        for (let i = 0; i < dm[0].length; i++) this.advance();
        this.tokens.push({ type: dm[2] ? T.DATETIME : T.DATE, value: dm[0], line, col });
        continue;
      }
      if (/\p{N}/u.test(c)) {
        const durM = this.src.slice(this.pos).match(/^(\d+)(ms|m|h|d|w)(?=\s|$|\})/u);
        if (durM) {
          for (let i = 0; i < durM[0].length; i++) this.advance();
          this.tokens.push({ type: T.DURATION, value: durM[0], line, col });
          continue;
        }
        let s = '';
        while (!this.atEnd() && /[0-9._]/u.test(this.peek())) s += this.advance();
        this.tokens.push({ type: T.NUMBER, value: s, line, col });
        continue;
      }
      if (IDENT_START.test(c)) {
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
