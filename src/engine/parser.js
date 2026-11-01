// Recursive-descent parser producing an AST for MATLAB code.
import { lex, ParseError } from './lexer.js';

const INVALID_EXPR = 'Invalid expression. When calling a function or indexing a variable, use parentheses. Otherwise, check for mismatched delimiters.';

export function parse(src, fileName = '') {
  const p = new Parser(lex(src), src);
  const res = p.parseFile();
  res.fileName = fileName;
  return res;
}

class Parser {
  constructor(toks, src) {
    this.toks = toks; this.i = 0; this.src = src;
    this.indexDepth = 0;   // > 0 while parsing index args (end is valid)
    this.matrixDepth = 0;
    this.srcLines = src.split('\n');
  }
  get tok() { return this.toks[this.i]; }
  peek(k = 1) { return this.toks[this.i + k]; }
  next() { return this.toks[this.i++]; }
  is(t, v) { const k = this.tok; return k.t === t && (v === undefined || k.v === v); }
  isOp(v) { return this.tok.t === 'op' && this.tok.v === v; }
  isKw(v) { return this.tok.t === 'kw' && this.tok.v === v; }
  err(msg, tok = this.tok) { throw new ParseError(msg, tok.line, tok.col); }
  expectOp(v) {
    if (!this.isOp(v)) {
      if (v === ')' || v === ']' || v === '}') this.err(INVALID_EXPR);
      this.err(`Invalid expression.`);
    }
    return this.next();
  }
  skipNewlines() { while (this.tok.t === 'nl' || this.tok.t === ';' || this.tok.t === ',') this.next(); }

  parseFile() {
    const body = [];
    const functions = [];
    this.skipNewlines();
    while (!this.is('eof')) {
      if (this.isKw('function')) functions.push(this.parseFunction());
      else {
        if (functions.length) {
          // statements after local functions are not allowed
          this.err('Function definitions in a script must appear at the end of the file.\nMove all statements after the "' + functions[functions.length - 1].name + '" function definition to before the first local function definition.');
        }
        body.push(this.parseStatement());
      }
      this.skipNewlines();
    }
    return { type: 'File', body, functions, isFunctionFile: body.length === 0 && functions.length > 0 };
  }

  parseFunction() {
    const ftok = this.next(); // 'function'
    let outs = [], name, params = [];
    // forms: function name, function name(args), function out = name(args), function [a,b] = name(args)
    if (this.isOp('[')) {
      this.next();
      while (!this.isOp(']')) {
        if (this.is('id')) outs.push(this.next().v);
        else if (this.is(',')) this.next();
        else this.err('Invalid expression.');
      }
      this.next();
      this.expectOp('=');
      name = this.expectId();
    } else {
      const first = this.expectId();
      if (this.isOp('=')) { this.next(); outs = [first]; name = this.expectId(); }
      else name = first;
    }
    // allow dotted names? no
    if (this.isOp('(')) {
      this.next();
      while (!this.isOp(')')) {
        if (this.is('id')) params.push(this.next().v);
        else if (this.isOp('~')) { this.next(); params.push('~'); }
        else if (this.is(',')) this.next();
        else this.err('Invalid expression.');
      }
      this.next();
    }
    // help text: comment lines right after the definition line
    const help = [];
    for (let ln = ftok.line; ln < this.srcLines.length; ln++) {
      const t = this.srcLines[ln].trim();
      if (t.startsWith('%')) help.push(t.replace(/^%+\s?/, ''));
      else break;
    }
    const body = this.parseBlock(['end', 'function'], true);
    if (this.isKw('end')) this.next();
    return { type: 'Function', name, params, outs, body, line: ftok.line, help: help.join('\n') };
  }

  expectId() {
    if (!this.is('id')) this.err('Invalid expression.');
    return this.next().v;
  }

  // parse statements until one of terminators (keywords) is current
  parseBlock(terms, allowEof = false) {
    const stmts = [];
    this.skipNewlines();
    while (true) {
      if (this.is('eof')) {
        if (allowEof) break;
        this.err('At least one END is missing: the statement may begin here.', this.blockStart || this.tok);
      }
      if (this.tok.t === 'kw' && terms.includes(this.tok.v)) break;
      stmts.push(this.parseStatement());
      this.skipNewlines();
    }
    return stmts;
  }

  endOfStatement(stmt) {
    // determine printing: ';' suppresses
    const t = this.tok;
    if (t.t === ';') { this.next(); stmt.print = false; if (this.tok.t === 'nl') this.next(); }
    else if (t.t === ',' || t.t === 'nl') { this.next(); stmt.print = true; }
    else if (t.t === 'eof') stmt.print = true;
    else if (t.t === 'kw' && ['end', 'else', 'elseif', 'case', 'otherwise', 'catch', 'function'].includes(t.v)) stmt.print = true;
    else {
      // e.g. "x = 3 4"
      this.err(INVALID_EXPR.replace('Invalid expression.', 'Invalid expression.'));
    }
    return stmt;
  }

  parseStatement() {
    const t = this.tok;
    const line = t.line;
    let st;
    if (t.t === 'cmd') {
      this.next();
      st = { type: 'Cmd', name: t.v, args: t.args, line };
      return this.endOfStatement(st);
    }
    if (t.t === 'kw') {
      switch (t.v) {
        case 'if': st = this.parseIf(); break;
        case 'for': case 'parfor': st = this.parseFor(); break;
        case 'while': st = this.parseWhile(); break;
        case 'switch': st = this.parseSwitch(); break;
        case 'try': st = this.parseTry(); break;
        case 'break': this.next(); st = { type: 'Break' }; break;
        case 'continue': this.next(); st = { type: 'Continue' }; break;
        case 'return': this.next(); st = { type: 'Return' }; break;
        case 'global': case 'persistent': {
          this.next(); const names = [];
          while (this.is('id')) names.push(this.next().v);
          st = { type: t.v === 'global' ? 'Global' : 'Persistent', names }; break;
        }
        case 'function': this.err('Function definitions are not supported in this context. Functions can only be created as local or nested functions in code files.');
        case 'end': this.err("Illegal use of reserved keyword \"end\".");
        default: this.err(`Illegal use of reserved keyword "${t.v}".`);
      }
      st.line = line;
      if (this.tok.t === ';' || this.tok.t === ',' || this.tok.t === 'nl') this.endOfStatement(st);
      return st;
    }
    // multi-assignment [a,b] = ...
    if (this.isOp('[')) {
      const save = this.i;
      const lhs = this.tryParseMultiLhs();
      if (lhs) {
        const rhs = this.parseExpr();
        st = { type: 'Assign', lhs, rhs, line, multi: true };
        return this.endOfStatement(st);
      }
      this.i = save;
    }
    const e = this.parseExpr();
    if (this.isOp('=')) {
      const eqTok = this.next();
      if (!isLvalue(e)) {
        if (e.type === 'Bin' || e.type === 'Num' || e.type === 'Str') this.err("Incorrect use of '=' operator. To assign a value to a variable, use '='. To compare values for equality, use '=='.", eqTok);
        this.err('Invalid expression.', eqTok);
      }
      const rhs = this.parseExpr();
      if (this.isOp('=')) this.err("Incorrect use of '=' operator. To assign a value to a variable, use '='. To compare values for equality, use '=='.");
      st = { type: 'Assign', lhs: [e], rhs, line };
    } else {
      st = { type: 'Expr', expr: e, line };
    }
    return this.endOfStatement(st);
  }

  tryParseMultiLhs() {
    // returns array of lvalues if "[...] =" else null
    let depth = 0, j = this.i;
    for (; j < this.toks.length; j++) {
      const k = this.toks[j];
      if (k.t === 'op' && (k.v === '[' || k.v === '(' || k.v === '{')) depth++;
      else if (k.t === 'op' && (k.v === ']' || k.v === ')' || k.v === '}')) { depth--; if (depth === 0) break; }
      else if (k.t === 'nl' || k.t === 'eof') return null;
    }
    const after = this.toks[j + 1];
    if (!after || !(after.t === 'op' && after.v === '=')) return null;
    this.next(); // [
    const lhs = [];
    while (!this.isOp(']')) {
      if (this.is(',')) { this.next(); continue; }
      if (this.isOp('~')) { this.next(); lhs.push({ type: 'Tilde' }); continue; }
      const e = this.parsePostfix();
      if (!isLvalue(e)) this.err('Invalid expression.');
      lhs.push(e);
    }
    this.next(); // ]
    this.next(); // =
    return lhs;
  }

  parseIf() {
    const start = this.next();
    this.blockStart = start;
    const clauses = [];
    let cond = this.parseExpr();
    let body = this.parseBlock(['elseif', 'else', 'end']);
    clauses.push({ cond, body });
    let elseBody = null;
    while (true) {
      if (this.isKw('elseif')) { this.next(); cond = this.parseExpr(); body = this.parseBlock(['elseif', 'else', 'end']); clauses.push({ cond, body }); }
      else if (this.isKw('else')) { this.next(); elseBody = this.parseBlock(['end']); }
      else break;
    }
    this.next(); // end
    return { type: 'If', clauses, elseBody };
  }
  parseFor() {
    const start = this.next();
    this.blockStart = start;
    let paren = false;
    if (this.isOp('(')) { paren = true; this.next(); }
    const v = this.parsePostfix();
    if (v.type !== 'Id') this.err('Invalid expression.');
    this.expectOp('=');
    const expr = this.parseExpr();
    if (paren) {
      if (this.is(',')) { this.next(); this.parseExpr(); } // parfor (i=1:n, M)
      this.expectOp(')');
    }
    const body = this.parseBlock(['end']);
    this.next();
    return { type: 'For', varName: v.name, expr, body };
  }
  parseWhile() {
    const start = this.next();
    this.blockStart = start;
    const cond = this.parseExpr();
    const body = this.parseBlock(['end']);
    this.next();
    return { type: 'While', cond, body };
  }
  parseSwitch() {
    const start = this.next();
    this.blockStart = start;
    const expr = this.parseExpr();
    this.skipNewlines();
    const cases = []; let otherwise = null;
    while (true) {
      if (this.isKw('case')) {
        this.next();
        const val = this.parseExpr();
        const body = this.parseBlock(['case', 'otherwise', 'end']);
        cases.push({ val, body });
      } else if (this.isKw('otherwise')) {
        this.next();
        otherwise = this.parseBlock(['case', 'otherwise', 'end']);
      } else if (this.isKw('end')) { this.next(); break; }
      else if (this.is('eof')) this.err('At least one END is missing: the statement may begin here.', start);
      else this.err('Invalid expression.');
    }
    return { type: 'Switch', expr, cases, otherwise };
  }
  parseTry() {
    const start = this.next();
    this.blockStart = start;
    const body = this.parseBlock(['catch', 'end']);
    let id = null, catchBody = [];
    if (this.isKw('catch')) {
      const ct = this.next();
      if (this.is('id') && this.tok.line === ct.line) id = this.next().v;
      catchBody = this.parseBlock(['end']);
    }
    this.next();
    return { type: 'Try', body, id, catchBody };
  }

  // ---------------- expressions ----------------
  parseExpr() { return this.parseOrOr(); }
  parseOrOr() {
    let l = this.parseAndAnd();
    while (this.isOp('||')) { this.next(); l = { type: 'OrOr', l, r: this.parseAndAnd() }; }
    return l;
  }
  parseAndAnd() {
    let l = this.parseOr();
    while (this.isOp('&&')) { this.next(); l = { type: 'AndAnd', l, r: this.parseOr() }; }
    return l;
  }
  parseOr() {
    let l = this.parseAnd();
    while (this.isOp('|')) { this.next(); l = { type: 'Bin', op: '|', l, r: this.parseAnd() }; }
    return l;
  }
  parseAnd() {
    let l = this.parseCmp();
    while (this.isOp('&')) { this.next(); l = { type: 'Bin', op: '&', l, r: this.parseCmp() }; }
    return l;
  }
  parseCmp() {
    let l = this.parseRange();
    while (this.tok.t === 'op' && ['==', '~=', '<', '<=', '>', '>='].includes(this.tok.v)) {
      const op = this.next().v; l = { type: 'Bin', op, l, r: this.parseRange() };
    }
    return l;
  }
  parseRange() {
    // colon alone inside index
    if (this.isOp(':') && this.indexDepth > 0) {
      const nx = this.peek();
      if ((nx.t === ',' ) || (nx.t === 'op' && (nx.v === ')' || nx.v === '}'))) { this.next(); return { type: 'Colon' }; }
    }
    let a = this.parseAdd();
    if (this.isOp(':')) {
      this.next();
      let b = this.parseAdd();
      if (this.isOp(':')) { this.next(); const c = this.parseAdd(); return { type: 'Range', start: a, step: b, stop: c }; }
      return { type: 'Range', start: a, step: null, stop: b };
    }
    return a;
  }
  parseAdd() {
    let l = this.parseMul();
    while (this.tok.t === 'op' && (this.tok.v === '+' || this.tok.v === '-')) {
      const op = this.next().v; l = { type: 'Bin', op, l, r: this.parseMul() };
    }
    return l;
  }
  parseMul() {
    let l = this.parseUnary();
    while (this.tok.t === 'op' && ['*', '/', '\\', '.*', './', '.\\'].includes(this.tok.v)) {
      const op = this.next().v; l = { type: 'Bin', op, l, r: this.parseUnary() };
    }
    return l;
  }
  parseUnary() {
    if (this.tok.t === 'op' && (this.tok.v === '-' || this.tok.v === '+' || this.tok.v === '~')) {
      const op = this.next().v;
      const e = this.parseUnary();
      return { type: 'Un', op, e };
    }
    return this.parsePower();
  }
  parsePower() {
    let base = this.parsePostfix();
    while (this.tok.t === 'op' && (this.tok.v === '^' || this.tok.v === '.^')) {
      const op = this.next().v;
      // exponent may have unary minus: 2^-1
      let exp;
      if (this.tok.t === 'op' && (this.tok.v === '-' || this.tok.v === '+' || this.tok.v === '~')) {
        const u = this.next().v; exp = { type: 'Un', op: u, e: this.parsePostfixPow() };
      } else exp = this.parsePostfixPow();
      base = { type: 'Bin', op, l: base, r: exp };
    }
    return base;
  }
  parsePostfixPow() { return this.parsePostfix(); }

  parsePostfix() {
    let e = this.parsePrimary();
    while (true) {
      const t = this.tok;
      if (t.t === 'op' && t.v === '(' && !(this.matrixDepth > 0 && this.toks[this.i - 1].spaceAfter)) {
        this.next();
        const args = this.parseArgs(')');
        e = { type: 'Index', e, kind: '()', args };
      } else if (t.t === 'op' && t.v === '{' && !(this.matrixDepth > 0 && this.toks[this.i - 1].spaceAfter)) {
        this.next();
        const args = this.parseArgs('}');
        e = { type: 'Index', e, kind: '{}', args };
      } else if (t.t === 'op' && t.v === '.' ) {
        this.next();
        if (this.is('id') || this.is('kw')) e = { type: 'Field', e, name: this.next().v };
        else if (this.isOp('(')) { this.next(); const fe = this.parseExpr(); this.expectOp(')'); e = { type: 'Field', e, dyn: fe }; }
        else this.err('Invalid expression.');
      } else if (t.t === 'op' && (t.v === "'" || t.v === ".'")) {
        this.next(); e = { type: 'Post', op: t.v, e };
      } else break;
    }
    return e;
  }
  parseArgs(close) {
    const args = [];
    this.indexDepth++;
    const savedM = this.matrixDepth; this.matrixDepth = 0;
    while (this.tok.t === 'nl') this.next();
    if (this.isOp(close)) { this.next(); this.indexDepth--; this.matrixDepth = savedM; return args; }
    while (true) {
      args.push(this.parseExpr());
      if (this.is(',')) { this.next(); continue; }
      if (this.isOp(close)) { this.next(); break; }
      this.err(INVALID_EXPR);
    }
    this.indexDepth--; this.matrixDepth = savedM;
    return args;
  }

  parsePrimary() {
    const t = this.tok;
    switch (t.t) {
      case 'num': this.next(); return { type: 'Num', v: t.v, imag: t.imag };
      case 'str': this.next(); return { type: 'Str', v: t.v };
      case 'dstr': this.next(); return { type: 'DStr', v: t.v };
      case 'id': this.next(); return { type: 'Id', name: t.v, line: t.line };
      case 'kw':
        if (t.v === 'end' && this.indexDepth > 0) { this.next(); return { type: 'End' }; }
        this.err(`Illegal use of reserved keyword "${t.v}".`);
      case 'cmd':
        // command-syntax token appearing in expression context: treat as identifier call
        this.err(INVALID_EXPR);
      case 'op':
        if (t.v === '(') {
          this.next();
          const savedM = this.matrixDepth; this.matrixDepth = 0;
          const savedI = this.indexDepth; this.indexDepth = 0;
          const e = this.parseExpr();
          this.matrixDepth = savedM; this.indexDepth = savedI;
          this.expectOp(')');
          return { type: 'Paren', e };
        }
        if (t.v === '[') return this.parseMatrix('[', ']');
        if (t.v === '{') return this.parseMatrix('{', '}');
        if (t.v === '@') {
          this.next();
          if (this.isOp('(')) {
            const startPos = this.tok.pos;
            this.next();
            const params = [];
            while (!this.isOp(')')) {
              if (this.is('id')) params.push(this.next().v);
              else if (this.isOp('~')) { this.next(); params.push('~'); }
              else if (this.is(',')) this.next();
              else this.err('Invalid expression.');
            }
            this.next();
            const savedI = this.indexDepth; this.indexDepth = 0;
            const savedM = this.matrixDepth; this.matrixDepth = 0;
            const body = this.parseExpr();
            this.indexDepth = savedI; this.matrixDepth = savedM;
            const endPos = this.toks[this.i - 1].end;
            const src = '@(' + params.join(',') + ')' + this.src.slice(this.srcAfterParen(startPos), endPos).replace(/\s+/g, '');
            return { type: 'Anon', params, body, src };
          }
          if (this.is('id')) {
            let name = this.next().v;
            while (this.isOp('.') && this.peek().t === 'id') { this.next(); name += '.' + this.next().v; }
            return { type: 'FuncHandle', name };
          }
          this.err('Invalid expression.');
        }
        if (t.v === ':' ) { this.next(); return { type: 'Colon' }; }
        if (t.v === ')' || t.v === ']' || t.v === '}') this.err(INVALID_EXPR);
        if (t.v === '=') this.err("Incorrect use of '=' operator. To assign a value to a variable, use '='. To compare values for equality, use '=='.");
        this.err('Invalid use of operator.');
      case 'nl': case ';': case ',': case 'eof':
        this.err(t.t === 'eof' || t.t === 'nl' ? 'Invalid expression. Check for missing or extra characters.' : 'Invalid use of operator.');
    }
    this.err('Invalid expression.');
  }
  srcAfterParen(startPos) {
    // position right after the closing paren of the parameter list
    let depth = 0;
    for (let k = startPos; k < this.src.length; k++) {
      if (this.src[k] === '(') depth++;
      else if (this.src[k] === ')') { depth--; if (depth === 0) return k + 1; }
    }
    return startPos;
  }

  parseMatrix(open, close) {
    this.next();
    this.matrixDepth++;
    const savedI = this.indexDepth;
    // "end" inside matrix literal inside index stays valid
    const rows = [];
    let row = [];
    while (true) {
      const t = this.tok;
      if (t.t === 'op' && t.v === close) { this.next(); break; }
      if (t.t === ';') { this.next(); rows.push(row); row = []; continue; }
      if (t.t === ',') { this.next(); continue; }
      if (t.t === 'nl') { this.next(); continue; }
      if (t.t === 'eof') this.err(INVALID_EXPR);
      row.push(this.parseExpr());
      const nt = this.tok;
      if (!(nt.t === ',' || nt.t === ';' || nt.t === 'nl' || (nt.t === 'op' && nt.v === close))) this.err(INVALID_EXPR);
    }
    if (row.length || rows.length === 0) rows.push(row);
    this.matrixDepth--;
    this.indexDepth = savedI;
    return { type: open === '[' ? 'Matrix' : 'CellLit', rows: rows.filter((r, k) => r.length || k === rows.length - 1 && false || r.length) };
  }
}

function isLvalue(e) {
  if (e.type === 'Id') return true;
  if (e.type === 'Index' || e.type === 'Field') return isLvalue(e.e);
  return false;
}
