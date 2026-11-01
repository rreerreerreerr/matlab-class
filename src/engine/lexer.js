// MATLAB lexer. Context-sensitive: handles transpose vs. quote, whitespace
// separated elements inside [] and {}, comments, continuation and command syntax.
import { MError } from './value.js';

export const KEYWORDS = new Set(['if', 'elseif', 'else', 'end', 'for', 'parfor', 'while', 'switch', 'case',
  'otherwise', 'try', 'catch', 'break', 'continue', 'return', 'function', 'global', 'persistent']);

// identifiers that are commonly used with command syntax
const COMMAND_WORDS = new Set(['format', 'hold', 'grid', 'clear', 'clc', 'close', 'syms', 'help', 'doc', 'axis',
  'clearvars', 'more', 'warning', 'load', 'save', 'figure', 'cd', 'ls', 'dir', 'type', 'which', 'lookfor', 'what',
  'who', 'whos', 'edit', 'echo', 'diary', 'box', 'pkg', 'disp', 'clf', 'rotate3d', 'shg', 'drawnow', 'beep',
  'tic', 'toc', 'home', 'exist', 'colormap', 'shading', 'run', 'delete', 'mkdir', 'rmdir', 'path', 'addpath']);

export class ParseError extends MError {
  constructor(msg, line, col) { super(msg); this.line = line; this.col = col; this.isParse = true; }
}

const isIdStart = (c) => /[A-Za-z_]/.test(c);
const isIdChar = (c) => /[A-Za-z0-9_]/.test(c);
const isDigit = (c) => c >= '0' && c <= '9';

export function lex(src) {
  const toks = [];
  let i = 0, line = 1, lineStart = 0;
  const brackets = []; // stack of '[', '{', '('
  const n = src.length;
  const push = (t, v, start, extra = {}) => {
    const tok = { t, v, line, col: start - lineStart + 1, pos: start, end: i, ...extra };
    toks.push(tok);
    return tok;
  };
  const last = () => toks[toks.length - 1];
  const inMatrix = () => brackets.length && brackets[brackets.length - 1] !== '(';
  const atStmtStart = () => {
    const l = last();
    return !l || l.t === 'nl' || l.t === ';' || (l.t === ',' && brackets.length === 0) ||
      (l.t === 'kw' && ['else', 'try', 'otherwise', 'end'].includes(l.v) && brackets.length === 0);
  };
  const valueEnd = (tok) => tok && (tok.t === 'num' || tok.t === 'id' || tok.t === 'str' || tok.t === 'dstr' ||
    (tok.t === 'op' && [')', ']', '}', "'", ".'"].includes(tok.v)) || (tok.t === 'kw' && tok.v === 'end' && brackets.length > 0));

  while (i < n) {
    const c = src[i];
    // ---- whitespace
    if (c === ' ' || c === '\t' || c === '\r') {
      let j = i; while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\r')) j++;
      // inside [] or {}: whitespace may separate elements
      if (inMatrix() && valueEnd(last())) {
        const d = src[j], d2 = src[j + 1];
        let sep = false;
        if (d !== undefined && d !== '\n' && d !== ',' && d !== ';' && d !== ']' && d !== '}' && d !== '%' && !(d === '.' && src[j + 1] === '.' && src[j + 2] === '.')) {
          if (d === '+' || d === '-') {
            // "[1 -2]" -> two elements;  "[1 - 2]" -> one element
            sep = d2 !== ' ' && d2 !== '\t' && d2 !== '=' ;
          } else if (d === '~') {
            sep = d2 !== '=';
          } else if (d === "'" || d === '"') {
            sep = true;
          } else if (d === '(' || d === '[' || d === '{' || d === '@' || isIdStart(d) || isDigit(d) || (d === '.' && isDigit(d2))) {
            sep = true;
          }
        }
        if (sep) { i = j; push(',', ',', i, { virtual: true }); continue; }
      }
      i = j;
      if (toks.length) toks[toks.length - 1].spaceAfter = true;
      continue;
    }
    // ---- continuation
    if (c === '.' && src.startsWith('...', i)) {
      while (i < n && src[i] !== '\n') i++;
      if (i < n) { i++; line++; lineStart = i; }
      continue;
    }
    // ---- comments
    if (c === '%' || (c === '#' && false)) {
      // block comment: line containing only %{
      const lineText = src.slice(lineStart, src.indexOf('\n', i) === -1 ? n : src.indexOf('\n', i));
      if (lineText.trim() === '%{' ) {
        let depth = 0, k = lineStart;
        while (k < n) {
          let e = src.indexOf('\n', k); if (e === -1) e = n;
          const lt = src.slice(k, e).trim();
          if (lt === '%{') depth++;
          else if (lt === '%}') { depth--; if (depth === 0) { k = e; break; } }
          if (e < n) { line++; }
          k = e + 1;
        }
        i = k; lineStart = src.lastIndexOf('\n', i - 1) + 1;
        continue;
      }
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    // ---- newline
    if (c === '\n') {
      if (inMatrix()) {
        const l = last();
        if (l && l.t !== ';' && !(l.t === 'op' && (l.v === '[' || l.v === '{'))) push(';', ';', i, { virtual: true });
      } else if (brackets.length === 0) {
        push('nl', '\n', i);
      }
      i++; line++; lineStart = i;
      continue;
    }
    const start = i;
    // ---- command syntax
    if (isIdStart(c) && atStmtStart() && brackets.length === 0) {
      let j = i; while (j < n && isIdChar(src[j])) j++;
      const word = src.slice(i, j);
      if (!KEYWORDS.has(word)) {
        let k = j; while (k < n && (src[k] === ' ' || src[k] === '\t')) k++;
        const d = src[k];
        const hasSpace = k > j;
        let isCmd = false;
        if (hasSpace && d !== undefined && d !== '\n' && d !== ';' && d !== ',' && d !== '%') {
          if (isIdStart(d) || isDigit(d) || d === "'" || (d === '-' && isIdStart(src[k + 1] || ''))) {
            // make sure it's not "a = b" or "a(1)" style
            let m = k; while (m < n && isIdChar(src[m])) m++;
            let p = m; while (p < n && (src[p] === ' ' || src[p] === '\t')) p++;
            const after = src[p];
            if (d === "'" || d === '-' || word === 'syms') isCmd = true;
            else if (after === '=' && src[p + 1] !== '=') isCmd = false;
            else if (after === '(' && p === m) isCmd = false;
            else if (COMMAND_WORDS.has(word)) isCmd = true;
            else {
              // generic word followed by plain words only -> command syntax
              const rest = src.slice(k, (src.indexOf('\n', k) + 1 || n + 1) - 1).split('%')[0];
              isCmd = /^[A-Za-z0-9_\-.\s]*;?\s*$/.test(rest) && !/^(\S+)\s*[=(]/.test(rest);
            }
          }
        }
        if (isCmd) {
          // gather arguments until ; , newline or %
          const args = [];
          let p = k;
          while (p < n && src[p] !== '\n' && src[p] !== ';' && src[p] !== ',' && src[p] !== '%') {
            if (src[p] === ' ' || src[p] === '\t') { p++; continue; }
            if (src[p] === "'") {
              let s = ''; p++;
              while (p < n && src[p] !== '\n') {
                if (src[p] === "'") { if (src[p + 1] === "'") { s += "'"; p += 2; continue; } p++; break; }
                s += src[p++];
              }
              args.push(s);
            } else {
              let s = '';
              while (p < n && !/[\s;,%]/.test(src[p])) s += src[p++];
              args.push(s);
            }
          }
          i = p;
          push('cmd', word, start, { args });
          continue;
        }
      }
    }
    // ---- identifiers / keywords
    if (isIdStart(c)) {
      while (i < n && isIdChar(src[i])) i++;
      const w = src.slice(start, i);
      if (KEYWORDS.has(w)) {
        // inside brackets "end" means last index
        push('kw', w, start);
      } else push('id', w, start);
      continue;
    }
    // ---- numbers
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] || ''))) {
      // hex 0x?? not supported
      while (i < n && isDigit(src[i])) i++;
      if (src[i] === '.' && !(src[i + 1] === '*' || src[i + 1] === '/' || src[i + 1] === '\\' || src[i + 1] === '^' || src[i + 1] === "'")) {
        i++; while (i < n && isDigit(src[i])) i++;
      }
      if ((src[i] === 'e' || src[i] === 'E' || src[i] === 'd' || src[i] === 'D') &&
        (isDigit(src[i + 1] || '') || ((src[i + 1] === '+' || src[i + 1] === '-') && isDigit(src[i + 2] || '')))) {
        i += 2; while (i < n && isDigit(src[i])) i++;
      }
      let text = src.slice(start, i).replace(/[dD]/, 'e');
      let imag = false;
      if ((src[i] === 'i' || src[i] === 'j') && !isIdChar(src[i + 1] || '')) { imag = true; i++; }
      if (isIdStart(src[i] || '') ) {
        throw new ParseError('Invalid expression. Check for missing multiplication operator, missing or unbalanced delimiters, or other syntax error. To construct matrices, use brackets instead of parentheses.', line, i - lineStart + 1);
      }
      push('num', parseFloat(text), start, { imag, text });
      continue;
    }
    // ---- strings / transpose
    if (c === "'") {
      const l = last();
      const prevAdj = l && l.end === i && !l.spaceAfter;
      if (valueEnd(l) && (prevAdj || !inMatrix())) {
        i++; push('op', "'", start); continue;
      }
      i++;
      let s = '';
      while (true) {
        if (i >= n || src[i] === '\n') throw new ParseError('Character vector is not terminated properly.', line, start - lineStart + 1);
        if (src[i] === "'") { if (src[i + 1] === "'") { s += "'"; i += 2; continue; } i++; break; }
        s += src[i++];
      }
      push('str', s, start);
      continue;
    }
    if (c === '"') {
      i++;
      let s = '';
      while (true) {
        if (i >= n || src[i] === '\n') throw new ParseError('String is not terminated properly.', line, start - lineStart + 1);
        if (src[i] === '"') { if (src[i + 1] === '"') { s += '"'; i += 2; continue; } i++; break; }
        s += src[i++];
      }
      push('dstr', s, start);
      continue;
    }
    // ---- operators
    const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
    if (two === ".'") { i += 2; push('op', ".'", start); continue; }
    if (['.*', './', '.\\', '.^', '==', '~=', '!=', '<=', '>=', '&&', '||'].includes(two)) {
      i += 2; push('op', two === '!=' ? '~=' : two, start); continue;
    }
    if ('+-*/\\^<>&|~!=:,;()[]{}.@'.includes(c)) {
      i++;
      if (c === '(' || c === '[' || c === '{') { brackets.push(c); (brackets.pos = brackets.pos || []).push([line, start - lineStart + 1]); }
      if (c === ')' || c === ']' || c === '}') {
        // remove trailing virtual separators before closing bracket
        while (toks.length && toks[toks.length - 1].virtual) toks.pop();
        const open = brackets.pop(); if (brackets.pos) brackets.pos.pop();
        const want = { ')': '(', ']': '[', '}': '{' }[c];
        if (open !== want) throw new ParseError('Invalid expression. When calling a function or indexing a variable, use parentheses. Otherwise, check for mismatched delimiters.', line, start - lineStart + 1);
      }
      if (c === ',' ) { push(',', ',', start); continue; }
      if (c === ';') {
        if (inMatrix() && last() && last().t === ';' && last().virtual) { last().virtual = false; continue; }
        push(';', ';', start); continue;
      }
      push('op', c === '!' ? '~' : c, start);
      continue;
    }
    throw new ParseError(`Invalid text character. Check for unsupported symbol, invisible character, or pasting of non-ASCII characters.`, line, start - lineStart + 1);
  }
  if (brackets.length) {
    const b = brackets[brackets.length - 1];
    const [bl, bc] = brackets.pos[brackets.pos.length - 1];
    line = bl; lineStart = 0;
    throw new ParseError('Invalid expression. When calling a function or indexing a variable, use parentheses. Otherwise, check for mismatched delimiters.', bl, bc);
    throw new ParseError(b === '(' ? 'Invalid expression. When calling a function or indexing a variable, use parentheses. Otherwise, check for mismatched delimiters.'
      : b === '[' ? 'Invalid expression. When calling a function or indexing a variable, use parentheses. Otherwise, check for mismatched delimiters.'
        : 'Invalid expression. When calling a function or indexing a variable, use parentheses. Otherwise, check for mismatched delimiters.', line, 1);
  }
  push('nl', '\n', i);
  push('eof', null, i);
  return toks;
}
