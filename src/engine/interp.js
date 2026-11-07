// Tree-walking evaluator for MATLAB programs.
import { parse } from './parser.js';
import { ParseError } from './lexer.js';
import {
  MError, Tensor, Cell, Struct, FHandle, StrArr, num, cplx, str, empty, bool, className, toBool, toNumber,
  isChar, toStr, cloneValue, zeros,
} from './value.js';
import { binaryOp, unaryOp, transpose, compare } from './ops.js';
import { subsref, subsasgn, COLON } from './indexing.js';
import { display, fmtState } from './format.js';

class ControlFlow { constructor(kind) { this.kind = kind; } }
const BREAK = new ControlFlow('break'), CONTINUE = new ControlFlow('continue'), RETURN = new ControlFlow('return');

export class Workspace {
  constructor(name = 'base') { this.vars = new Map(); this.name = name; this.globals = new Set(); }
}

export class Interp {
  constructor(host) {
    this.host = host;            // { write(text, kind), input(prompt), readFile(name), writeFile(name,data), listFiles(), checkInterrupt(), plot(cmd) }
    this.base = new Workspace('base');
    this.globalVars = new Map();
    this.builtins = new Map();
    this.fileCache = new Map();  // name -> {src, ast}
    this.callDepth = 0;
    this.persistents = new Map();
    this.tic = Date.now();
    this.rngState = 42;
    this.lastWarning = '';
  }

  register(name, fn, opts = {}) { this.builtins.set(name, Object.assign({ fn, name }, opts)); }

  write(text, kind = 'out') { this.host.write(text, kind); }
  warn(msg) { this.lastWarning = msg; this.write(`Warning: ${msg}\n`, 'warn'); }

  // ---------------- entry points ----------------
  // run code typed in the command window
  runCommand(src) {
    let ast;
    try { ast = parse(src, ''); }
    catch (e) { this.reportParseError(e, src, null); return false; }
    if (ast.functions.length) {
      this.write('Error: Function definitions are not supported in this context. Functions can only be created as local or nested functions in code files.\n', 'err');
      return false;
    }
    const frame = { ws: this.base, file: null, fileName: null, functions: new Map() };
    try { this.execBlock(ast.body, frame); }
    catch (e) { this.reportError(e); return false; }
    return true;
  }

  // run a script file by name from the editor (Run button)
  runScriptFile(name, src) {
    let ast;
    try { ast = parse(src, name); }
    catch (e) { this.reportParseError(e, src, name + '.m'); return false; }
    if (ast.isFunctionFile) {
      const f = ast.functions[0];
      if (f.params.length > 0) {
        this.reportError(new MError('Not enough input arguments.', 'MATLAB:minrhs'), [{ name: f.name, line: f.body[0] ? f.body[0].line : f.line }], src);
        return false;
      }
      try { this.callUser(f, ast, [], 0); }
      catch (e) { this.reportError(e); return false; }
      return true;
    }
    this.fileCache.set(name, { src, ast });
    const frame = { ws: this.base, file: name, fileName: name, src, functions: new Map(ast.functions.map(f => [f.name, f])) };
    try { this.execBlock(ast.body, frame); }
    catch (e) { if (e === RETURN) return true; this.reportError(e); return false; }
    return true;
  }

  reportParseError(e, src, fileName) {
    if (!(e instanceof ParseError) && !(e instanceof MError)) { this.write(`Internal error: ${e && e.message}\n`, 'err'); console.error(e); return; }
    if (fileName) {
      this.write(`Error: File: ${fileName} Line: ${e.line} Column: ${e.col}\n${e.message}\n`, 'err');
    } else {
      const lines = src.split('\n');
      const ln = lines[(e.line || 1) - 1] || '';
      this.write(` ${ln}\n ${' '.repeat(Math.max(0, (e.col || 1) - 1))}↑\n`, 'err');
      this.write(`${e.message.startsWith('Error') ? '' : 'Error: '}${e.message}\n`, 'err');
    }
  }

  reportError(e) {
    if (e instanceof ControlFlow) return;
    if (!(e instanceof MError)) {
      if (e && e.name === 'RangeError' && /call stack/i.test(e.message)) {
        e = new MError('Maximum recursion limit of 500 reached.', 'MATLAB:recursionLimit');
      } else {
        this.write(`Internal error: ${e && e.message}\n`, 'err');
        console.error(e);
        return;
      }
    }
    let msg = '';
    if (e.fname && !e.noHeader) msg += `Error using ${e.fname}\n`;
    msg += e.message + '\n';
    if (e.mstack && e.mstack.length) {
      for (const fr of e.mstack) {
        msg += `\nError in ${fr.name} (line ${fr.line})\n${fr.src || ''}\n`;
      }
    }
    this.write(msg, 'err');
  }

  // ---------------- statements ----------------
  execBlock(stmts, frame) {
    for (let k = 0; k < stmts.length; k++) {
      const st = stmts[k];
      frame.curLine = st.line;
      try { this.execStmt(st, frame); }
      catch (e) {
        if (e instanceof MError && frame.fileName && !e._framed?.has(frame)) {
          e._framed = e._framed || new Set(); e._framed.add(frame);
          const srcLine = frame.src ? (frame.src.split('\n')[st.line - 1] || '').trim() : '';
          e.mstack.push({ name: frame.fileName, line: st.line, src: srcLine });
        }
        throw e;
      }
    }
  }

  execStmt(st, frame) {
    switch (st.type) {
      case 'Expr': return this.execExprStmt(st, frame);
      case 'Assign': return this.execAssign(st, frame);
      case 'Cmd': {
        const args = st.args.map(a => str(a));
        const v = this.callFunction(st.name, args, 0, frame, true);
        if (v.length && v[0] !== undefined) { this.setVar(frame, 'ans', v[0]); if (st.print) this.write(display('ans', v[0])); }
        return;
      }
      case 'If': {
        for (const c of st.clauses) {
          if (this.truth(this.eval(c.cond, frame), c.cond)) { this.execBlock(c.body, frame); return; }
        }
        if (st.elseBody) this.execBlock(st.elseBody, frame);
        return;
      }
      case 'For': return this.execFor(st, frame);
      case 'While': {
        while (true) {
          this.host.checkInterrupt();
          if (!this.truth(this.eval(st.cond, frame), st.cond)) break;
          try { this.execBlock(st.body, frame); }
          catch (e) { if (e === BREAK) break; if (e === CONTINUE) continue; throw e; }
        }
        return;
      }
      case 'Switch': {
        const v = this.eval(st.expr, frame);
        for (const c of st.cases) {
          const cv = this.eval(c.val, frame);
          if (this.switchMatch(v, cv)) { this.execBlock(c.body, frame); return; }
        }
        if (st.otherwise) this.execBlock(st.otherwise, frame);
        return;
      }
      case 'Try': {
        try { this.execBlock(st.body, frame); }
        catch (e) {
          if (e instanceof ControlFlow) throw e;
          if (!(e instanceof MError)) throw e;
          if (st.id) this.setVar(frame, st.id, this.makeException(e));
          this.execBlock(st.catchBody, frame);
        }
        return;
      }
      case 'Break': throw BREAK;
      case 'Continue': throw CONTINUE;
      case 'Return': throw RETURN;
      case 'Global': {
        for (const n of st.names) {
          frame.ws.globals.add(n);
          if (!this.globalVars.has(n)) this.globalVars.set(n, empty());
        }
        return;
      }
      case 'Persistent': {
        const key = (frame.fileName || '') + ':' + (frame.funcName || '');
        if (!this.persistents.has(key)) this.persistents.set(key, new Map());
        const store = this.persistents.get(key);
        frame.persist = store;
        for (const n of st.names) { if (!store.has(n)) store.set(n, empty()); frame.ws.persistNames = frame.ws.persistNames || new Set(); frame.ws.persistNames.add(n); frame.ws.persistStore = store; }
        return;
      }
    }
    throw new MError(`Unsupported statement ${st.type}`);
  }

  makeException(e) {
    const s = new Struct(1, 1, ['message', 'identifier', 'stack']);
    s.data[0].set('message', str(e.message));
    s.data[0].set('identifier', str(e.identifier || ''));
    s.data[0].set('stack', new Struct(0, 1, ['file', 'name', 'line'], []));
    s.isException = true;
    return s;
  }

  switchMatch(v, cv) {
    if (cv.type === 'cell') return cv.data.some(x => this.switchMatch(v, x));
    if (isChar(v) || v.type === 'string') {
      if (!(isChar(cv) || cv.type === 'string')) return false;
      return toStr(v) === toStr(cv);
    }
    if (v.type === 'num' && cv.type === 'num') {
      if (isChar(cv)) return false;
      if (v.numel === 0 || cv.numel === 0) return false;
      if (cv.numel !== 1 && v.numel === 1) return false;
      return v.re[0] === cv.re[0];
    }
    return false;
  }

  truth(v, node) {
    if (v.type === 'num' || v.type === 'sym' || v.type === 'string') return toBool(v);
    throw new MError(`Conversion to logical from ${className(v)} is not possible.`);
  }

  execFor(st, frame) {
    const e = st.expr;
    const name = st.varName;
    if (e.type === 'Range') {
      const a = this.scalarOf(this.eval(e.start, frame));
      const s = e.step ? this.scalarOf(this.eval(e.step, frame)) : 1;
      const b = this.scalarOf(this.eval(e.stop, frame));
      const n = colonCount(a, s, b);
      for (let k = 0; k < n; k++) {
        this.host.checkInterrupt();
        this.setVar(frame, name, num(a + k * s));
        try { this.execBlock(st.body, frame); }
        catch (err) { if (err === BREAK) break; if (err === CONTINUE) continue; throw err; }
      }
      return;
    }
    const v = this.eval(e, frame);
    const cols = v.numel === 0 ? 0 : v.cols;
    for (let j = 0; j < cols; j++) {
      this.host.checkInterrupt();
      let item;
      if (v.type === 'num') {
        if (v.rows === 1) item = new Tensor(1, 1, Float64Array.of(v.re[j]), v.im ? Float64Array.of(v.im[j]) : null, v.cls);
        else item = subsref(v, [COLON, num(j + 1)]);
      } else item = subsref(v, [COLON, num(j + 1)]);
      this.setVar(frame, name, item);
      try { this.execBlock(st.body, frame); }
      catch (err) { if (err === BREAK) break; if (err === CONTINUE) continue; throw err; }
    }
  }

  scalarOf(v) {
    if (v.type === 'sym') return toNumber(v);
    if (v.type !== 'num') throw new MError(`Undefined function 'colon' for input arguments of type '${className(v)}'.`);
    if (v.numel === 0) return NaN;
    return v.re[0];
  }

  execExprStmt(st, frame) {
    const e = st.expr;
    if (e.type === 'Id') {
      const v = this.lookupVar(frame, e.name);
      if (v !== undefined) { if (st.print) this.write(display(e.name, v)); return; }
      const outs = this.callFunction(e.name, [], 0, frame, true);
      if (outs.length && outs[0] !== undefined) { this.setVar(frame, 'ans', outs[0]); if (st.print) this.write(display('ans', outs[0])); }
      return;
    }
    let vals;
    if (e.type === 'Index' && e.e.type === 'Id' && this.lookupVar(frame, e.e.name) === undefined) {
      // function call statement: nargout = 0
      const args = this.evalArgs(e.args, frame, null);
      if (e.kind === '{}') throw new MError(`Unrecognized function or variable '${e.e.name}'.`, 'MATLAB:UndefinedFunction');
      vals = this.callFunction(e.e.name, args, 0, frame, true);
    } else if (e.type === 'Index' && e.kind === '()' ) {
      const base = this.evalMulti(e.e, frame, 1);
      if (base.length === 1 && base[0].type === 'fh') {
        vals = this.callHandle(base[0], this.evalArgs(e.args, frame, null), 0);
      } else vals = this.evalMulti(e, frame, 1);
    } else {
      vals = this.evalMulti(e, frame, 1);
    }
    if (!vals.length || vals[0] === undefined) return;
    // c{:} / s.f with multiple values displays each as ans; function calls only the first
    const csList = e.type === 'Field' || (e.type === 'Index' && e.kind === '{}');
    if (!csList) vals = vals.slice(0, 1);
    for (const v of vals) {
      this.setVar(frame, 'ans', v);
      if (st.print) this.write(display('ans', v));
    }
  }

  execAssign(st, frame) {
    const lhs = st.lhs;
    let values;
    if (lhs.length === 1 && !st.multi) {
      const vs = this.evalMulti(st.rhs, frame, 1);
      if (!vs.length || vs[0] === undefined) {
        if (st.rhs.type === 'Index' || st.rhs.type === 'Id') {
          const nm = st.rhs.type === 'Id' ? st.rhs.name : st.rhs.e.name;
          throw new MError(`Error using ${nm}\nToo many output arguments.`.replace(/^Error using .*\n/, ''), 'MATLAB:TooManyOutputs', nm);
        }
        throw new MError('Too many output arguments.');
      }
      values = [vs[0]];
    } else {
      const nout = lhs.length;
      values = this.evalMulti(st.rhs, frame, nout);
      if (values.length < nout) {
        // find first unassigned (non-tilde)
        const name = st.rhs.type === 'Index' && st.rhs.e.type === 'Id' ? st.rhs.e.name : st.rhs.type === 'Id' ? st.rhs.name : '';
        if (st.rhs.type === 'Index' && st.rhs.kind === '{}' || st.rhs.type === 'Field') throw new MError('Insufficient number of outputs from right hand side of equal sign to satisfy assignment.');
        throw new MError('Too many output arguments.', 'MATLAB:TooManyOutputs', name);
      }
    }
    for (let k = 0; k < lhs.length; k++) {
      if (lhs[k].type === 'Tilde') continue;
      let v = values[k];
      if (v === undefined) throw new MError('Too many output arguments.');
      this.assignTo(lhs[k], v, frame);
    }
    if (st.print) {
      for (const l of lhs) {
        if (l.type === 'Tilde') continue;
        const nm = rootName(l);
        this.write(display(nm, this.lookupVar(frame, nm)));
      }
    }
  }

  assignTo(lv, value, frame) {
    if (lv.type === 'Id') {
      if (value.type === 'cell' || value.type === 'struct') value = cloneValue(value);
      this.setVar(frame, lv.name, value);
      return;
    }
    const name = rootName(lv);
    const cur = this.lookupVar(frame, name);
    const nv = this.assignPath(cur, lv, value, frame);
    this.setVar(frame, name, nv);
  }

  // recursively build new value for nested lvalue like a.b(2).c{3} = v
  assignPath(cur, lv, value, frame, fromField = false) {
    if (lv.type === 'Id') return value;
    const parentNode = lv.e;
    const parent = this.getForAssign(parentNode, frame);
    let newParent;
    if (lv.type === 'Field') {
      const fname = lv.dyn ? toStr(this.eval(lv.dyn, frame)) : lv.name;
      newParent = setField(parent, fname, value);
    } else if (lv.kind === '()') {
      const base = parent === undefined ? defaultContainer(value) : parent;
      if (base.type === 'fh') throw new MError('Unable to perform assignment because brace indexing is not supported for variables of this type.');
      const args = this.evalArgs(lv.args, frame, base);
      if (base.type === 'sym' || value.type === 'sym') newParent = this.symAssign(base, args, value);
      else if (base.type === 'table') throw new MError('Use dot or brace indexing to assign into a table.');
      else if (fromField && base.type === 'struct' && value.type === 'struct') {
        // s(i).f = v may add field f to the whole struct array
        const [b2, v2] = unionFields(base, value);
        newParent = subsasgn(b2, args, v2);
      } else newParent = subsasgn(base, args, value);
    } else { // {}
      let base = parent === undefined ? new Cell(0, 0, []) : parent;
      if (base.type === 'num' && base.numel === 0) base = new Cell(0, 0, []);
      if (base.type === 'table') { newParent = this.tableBraceAssign(base, this.evalArgs(lv.args, frame, base), value); }
      else {
        if (base.type !== 'cell') throw new MError('Unable to perform assignment because brace indexing is not supported for variables of this type.');
        const args = this.evalArgs(lv.args, frame, base);
        newParent = subsasgn(base, args, new Cell(1, 1, [value]));
      }
    }
    return this.assignPath(undefined, parentNode, newParent, frame, lv.type === 'Field');
  }

  getForAssign(node, frame) {
    // current value of node or undefined if it does not exist yet
    if (node.type === 'Id') return this.lookupVar(frame, node.name);
    const parent = this.getForAssign(node.e, frame);
    if (parent === undefined) return undefined;
    if (node.type === 'Field') {
      const fname = node.dyn ? toStr(this.eval(node.dyn, frame)) : node.name;
      if (parent.type === 'struct') {
        if (parent.numel !== 1) throw new MError('Scalar structure required for this assignment.');
        if (!parent.fields.includes(fname)) return undefined;
        return parent.data[0].get(fname);
      }
      if (parent.type === 'table') { const k = parent.varNames.indexOf(fname); return k >= 0 ? parent.columns[k] : undefined; }
      if (parent.type === 'num' && parent.numel === 0) return undefined;
      throw new MError('Unable to perform assignment because dot indexing is not supported for variables of this type.');
    }
    const args = this.evalArgs(node.args, frame, parent);
    if (node.kind === '()') {
      try { return subsref(parent, args); } catch (e) { return undefined; }
    }
    if (parent.type !== 'cell') {
      if (parent.type === 'num' && parent.numel === 0) return undefined;
      throw new MError('Brace indexing is not supported for variables of this type.');
    }
    try { const c = subsref(parent, args); return c.numel === 1 ? c.data[0] : undefined; } catch (e) { return undefined; }
  }

  // ---------------- variables ----------------
  lookupVar(frame, name) {
    const ws = frame.ws;
    if (ws.globals.has(name)) return this.globalVars.get(name);
    if (ws.persistNames && ws.persistNames.has(name)) return ws.persistStore.get(name);
    return ws.vars.get(name);
  }
  setVar(frame, name, v) {
    const ws = frame.ws;
    if (ws.globals.has(name)) { this.globalVars.set(name, v); return; }
    if (ws.persistNames && ws.persistNames.has(name)) { ws.persistStore.set(name, v); return; }
    ws.vars.set(name, v);
    if (ws === this.base && this.host.varsChanged) this.host.varsChanged();
  }

  // ---------------- expressions ----------------
  eval(node, frame) {
    const r = this.evalMulti(node, frame, 1);
    if (!r.length || r[0] === undefined) {
      if (node.type === 'Index' && node.kind === '{}' || node.type === 'Field') {
        throw new MError('Insufficient number of outputs from right hand side of equal sign to satisfy assignment.');
      }
      let nm = node.type === 'Id' ? node.name : node.type === 'Index' && node.e.type === 'Id' ? node.e.name : '';
      throw new MError('Too many output arguments.', 'MATLAB:TooManyOutputs', nm);
    }
    return r[0];
  }

  // evaluate an expression that may produce a comma-separated list
  evalMulti(node, frame, nargout) {
    switch (node.type) {
      case 'Num': return [node.imag ? cplx(0, node.v) : num(node.v)];
      case 'Str': return [str(node.v)];
      case 'DStr': return [new StrArr(1, 1, [node.v])];
      case 'Paren': return [this.eval(node.e, frame)];
      case 'Id': {
        const v = this.lookupVar(frame, node.name);
        if (v !== undefined) return [v];
        return this.callFunction(node.name, [], nargout, frame);
      }
      case 'Bin': {
        const l = this.eval(node.l, frame), r = this.eval(node.r, frame);
        return [binaryOp(node.op, l, r)];
      }
      case 'Un': return [unaryOp(node.op, this.eval(node.e, frame))];
      case 'Post': return [transpose(this.eval(node.e, frame), node.op === "'")];
      case 'AndAnd': case 'OrOr': {
        const l = this.eval(node.l, frame);
        const lb = this.scLogical(l, node.type === 'AndAnd' ? '&&' : '||');
        if (node.type === 'AndAnd' && !lb) return [bool(false)];
        if (node.type === 'OrOr' && lb) return [bool(true)];
        const r = this.eval(node.r, frame);
        return [bool(this.scLogical(r, node.type === 'AndAnd' ? '&&' : '||'))];
      }
      case 'Range': return [this.evalRange(node, frame)];
      case 'Matrix': return [this.buildMatrix(node, frame)];
      case 'CellLit': return [this.buildCell(node, frame)];
      case 'Colon': return [str(':')];
      case 'End': {
        const ctx = this.endStack && this.endStack[this.endStack.length - 1];
        if (!ctx) throw new MError("'end' is not valid in this context.");
        const v = ctx.value;
        if (ctx.nargs === 1) return [num(v.numel)];
        if (ctx.pos === 0) return [num(v.rows)];
        if (ctx.pos === 1) return [num(ctx.nargs === 2 ? v.cols : v.cols)];
        return [num(1)];
      }
      case 'Anon': {
        // capture referenced variables
        const env = new Map();
        collectIds(node.body, (name) => {
          if (node.params.includes(name)) return;
          const v = this.lookupVar(frame, name);
          if (v !== undefined) env.set(name, v);
        });
        return [new FHandle({ params: node.params, body: node.body, env, src: node.src })];
      }
      case 'FuncHandle': {
        const fh = new FHandle({ name: node.name, src: '@' + node.name });
        fh.frameFunctions = frame.functions;
        return [fh];
      }
      case 'Index': return this.evalIndex(node, frame, nargout);
      case 'Field': return this.evalField(node, frame);
    }
    throw new MError(`Unsupported expression ${node.type}`);
  }

  scLogical(v, op) {
    if (v.type === 'num') {
      if (v.numel !== 1) throw new MError(`Operands to the ${op} operator must be convertible to logical scalar values. Use the ANY or ALL functions to reduce operands to logical scalar values.`, 'MATLAB:nonLogicalConditional');
      if (Number.isNaN(v.re[0])) throw new MError("NaN's cannot be converted to logicals.");
      return v.re[0] !== 0;
    }
    if (v.type === 'sym') return toNumber(v) !== 0;
    throw new MError(`Invalid data type. Operand must be a logical scalar value.`);
  }

  evalRange(node, frame) {
    const sv = this.eval(node.start, frame), ev = this.eval(node.stop, frame);
    const tv = node.step ? this.eval(node.step, frame) : null;
    if (sv.type !== 'num' || ev.type !== 'num' || (tv && tv.type !== 'num')) {
      const bad = [sv, ev, tv].find(x => x && x.type !== 'num');
      throw new MError(`Undefined function 'colon' for input arguments of type '${className(bad)}'.`);
    }
    if (sv.numel === 0 || ev.numel === 0 || (tv && tv.numel === 0)) return zeros(1, 0);
    const a = sv.re[0], b = ev.re[0], s = tv ? tv.re[0] : 1;
    const n = colonCount(a, s, b);
    const re = new Float64Array(n);
    for (let k = 0; k < n; k++) re[k] = a + k * s;
    // MATLAB computes the tail symmetrically to land exactly on the end value
    if (n > 1 && Math.abs(a + (n - 1) * s - b) < Math.abs(s) * 1e-10) re[n - 1] = b;
    const cls = sv.cls === 'char' && ev.cls === 'char' ? 'char' : ['single', ...['int8','uint8','int16','uint16','int32','uint32','int64','uint64']].includes(sv.cls) ? sv.cls : 'double';
    return new Tensor(1, n, re, null, cls);
  }

  buildMatrix(node, frame) {
    const rowVals = [];
    for (const row of node.rows) {
      const items = [];
      for (const e of row) for (const v of this.evalMulti(e, frame, 1)) items.push(v);
      rowVals.push(items);
    }
    return this.concat(rowVals);
  }
  buildCell(node, frame) {
    const rowVals = [];
    for (const row of node.rows) {
      const items = [];
      for (const e of row) for (const v of this.evalMulti(e, frame, 1)) items.push(v.type === 'cell' ? v : new Cell(1, 1, [v]));
      rowVals.push(items);
    }
    if (!rowVals.length || rowVals.every(r => !r.length)) return new Cell(0, 0, []);
    return this.concat(rowVals);
  }

  // horzcat/vertcat with MATLAB class rules
  concat(rowVals) {
    const rows = [];
    for (const items of rowVals) {
      if (!items.length) continue;
      rows.push(this.hcat(items));
    }
    if (!rows.length) return empty();
    if (rows.length === 1) return rows[0];
    return this.vcat(rows);
  }
  hcat(items) { return catValues(items, 2, this); }
  vcat(items) { return catValues(items, 1, this); }

  evalField(node, frame) {
    const bases = this.evalMulti(node.e, frame, 1);
    if (bases.length !== 1) throw new MError('Dot indexing is not supported for variables of this type.');
    const base = bases[0];
    const fname = node.dyn ? toStr(this.eval(node.dyn, frame)) : node.name;
    if (base.type === 'struct') {
      if (!base.fields.includes(fname)) throw new MError(`Unrecognized field name "${fname}".`, 'MATLAB:nonExistentField');
      return base.data.map(m => m.get(fname));
    }
    if (base.type === 'table') {
      const k = base.varNames.indexOf(fname);
      if (fname === 'Properties') { const s = new Struct(1, 1, ['VariableNames']); s.data[0].set('VariableNames', new Cell(1, base.varNames.length, base.varNames.map(str))); return [s]; }
      if (k < 0) throw new MError(`Unrecognized table variable name '${fname}'.`);
      return [base.columns[k]];
    }
    if (base.type === 'fig') { return [base.props.get(fname) || empty()]; }
    throw new MError('Dot indexing is not supported for variables of this type.', 'MATLAB:dotRefNotSupported');
  }

  evalIndex(node, frame, nargout) {
    // function call?
    if (node.e.type === 'Id') {
      const name = node.e.name;
      const v = this.lookupVar(frame, name);
      if (v === undefined) {
        if (node.kind === '{}') throw new MError(`Unrecognized function or variable '${name}'.`, 'MATLAB:UndefinedFunction');
        const args = this.evalArgs(node.args, frame, null);
        return this.callFunction(name, args, nargout, frame);
      }
      return this.indexValue(v, node, frame, nargout);
    }
    const bases = this.evalMulti(node.e, frame, 1);
    if (bases.length !== 1) throw new MError('Expected one output from a curly brace or dot indexing expression, but there were ' + bases.length + ' results.');
    return this.indexValue(bases[0], node, frame, nargout);
  }

  indexValue(v, node, frame, nargout) {
    if (v.type === 'fh' && node.kind === '()') {
      const args = this.evalArgs(node.args, frame, null);
      return this.callHandle(v, args, nargout);
    }
    const args = this.evalArgs(node.args, frame, v);
    if (node.kind === '{}') {
      if (v.type === 'table') return [this.tableBrace(v, args)];
      if (v.type !== 'cell') throw new MError('Brace indexing is not supported for variables of this type.', 'MATLAB:cellRefFromNonCell');
      const c = subsref(v, args);
      return c.data.slice();
    }
    if (v.type === 'sym') return [this.symIndex(v, args)];
    if (v.type === 'table') return [this.tableParen(v, args)];
    if (v.type === 'fh') throw new MError('Array indices must be positive integers or logical values.');
    return [subsref(v, args)];
  }

  evalArgs(argNodes, frame, baseForEnd) {
    const out = [];
    for (let p = 0; p < argNodes.length; p++) {
      const a = argNodes[p];
      if (a.type === 'Colon' && baseForEnd) { out.push(COLON); continue; }
      if (a.type === 'Colon') { out.push(str(':')); continue; }
      if (baseForEnd) {
        this.endStack = this.endStack || [];
        this.endStack.push({ value: baseForEnd, pos: p, nargs: argNodes.length });
        try { for (const v of this.evalMulti(a, frame, 1)) out.push(v); }
        finally { this.endStack.pop(); }
      } else {
        for (const v of this.evalMulti(a, frame, 1)) out.push(v);
      }
    }
    return out;
  }

  // ---------------- calls ----------------
  callHandle(fh, args, nargout) {
    if (fh.params) {
      if (args.length > fh.params.length && !fh.params.includes('varargin')) throw new MError('Too many input arguments.', 'MATLAB:TooManyInputs', fh.src);
      const ws = new Workspace('anon');
      for (const [k, v] of fh.env) ws.vars.set(k, v);
      fh.params.forEach((p, i) => { if (i < args.length && p !== '~') ws.vars.set(p, args[i]); });
      const frame = { ws, fileName: null, functions: fh.frameFunctions || new Map() };
      this.callDepth++;
      if (this.callDepth > 500) { this.callDepth--; throw new MError('Maximum recursion limit of 500 reached.'); }
      try { return this.evalMulti(fh.body, frame, Math.max(1, nargout)); }
      finally { this.callDepth--; }
    }
    return this.callFunction(fh.name, args, nargout, { ws: this.base, functions: fh.frameFunctions || new Map() });
  }

  // look up function by name; returns {kind, ...}
  resolveFunction(name, frame) {
    if (frame && frame.functions && frame.functions.has(name)) return { kind: 'local', def: frame.functions.get(name), file: frame.fileAst };
    const file = this.loadUserFile(name);
    if (file) return file;
    if (this.builtins.has(name)) return { kind: 'builtin', def: this.builtins.get(name) };
    return null;
  }

  loadUserFile(name) {
    const src = this.host.readText ? this.host.readText(name + '.m') : null;
    if (src == null) return null;
    let cached = this.fileCache.get(name);
    if (!cached || cached.src !== src) {
      let ast;
      try { ast = parse(src, name); }
      catch (e) {
        if (e instanceof ParseError || e instanceof MError) {
          const err = new MError(`Error: File: ${name}.m Line: ${e.line} Column: ${e.col}\n${e.message}`);
          err.noHeader = true;
          throw err;
        }
        throw e;
      }
      cached = { src, ast };
      this.fileCache.set(name, cached);
    }
    const ast = cached.ast;
    if (ast.isFunctionFile) return { kind: 'user', def: ast.functions[0], ast, src };
    return { kind: 'script', ast, src };
  }

  callFunction(name, args, nargout, frame, isStatement = false) {
    const r = this.resolveFunction(name, frame);
    if (!r) {
      if (args.length && name === 'e') {}
      throw new MError(`Unrecognized function or variable '${name}'.`, 'MATLAB:UndefinedFunction');
    }
    if (r.kind === 'builtin') return this.callBuiltin(r.def, args, nargout, frame, isStatement);
    if (r.kind === 'script') {
      if (args.length) throw new MError(`Attempt to execute SCRIPT ${name} as a function:\n${name}.m`, 'MATLAB:scriptNotAFunction');
      const f2 = { ws: this.base, file: name, fileName: name, src: r.src, functions: new Map(r.ast.functions.map(f => [f.name, f])) };
      try { this.execBlock(r.ast.body, f2); }
      catch (e) { if (e !== RETURN) throw e; }
      return [];
    }
    const src = r.kind === 'user' ? r.src : (frame && frame.src);
    const ast = r.kind === 'user' ? r.ast : (frame && frame.fileAst) || null;
    const fileName = r.kind === 'user' ? name : frame && frame.fileName;
    return this.callUser(r.def, ast, args, nargout, src, fileName, frame);
  }

  callBuiltin(def, args, nargout, frame, isStatement) {
    if (def.maxArgs !== undefined && args.length > def.maxArgs) throw new MError('Too many input arguments.', 'MATLAB:TooManyInputs', def.name);
    if (def.minArgs !== undefined && args.length < def.minArgs) throw new MError('Not enough input arguments.', 'MATLAB:minrhs', def.name);
    if (def.maxOut !== undefined && nargout > def.maxOut) throw new MError('Too many output arguments.', 'MATLAB:TooManyOutputs', def.name);
    let res;
    try { res = def.fn(args, nargout, { interp: this, frame, isStatement }); }
    catch (e) {
      if (e instanceof MError && !e.fname && !e.noHeader && !e.fromUser && !e.mstack.length) e.fname = def.name;
      throw e;
    }
    if (res === undefined || res === null) return [];
    return Array.isArray(res) ? res : [res];
  }

  callUser(def, ast, args, nargout, src, fileName, callerFrame) {
    const name = def.name;
    const hasVarargin = def.params[def.params.length - 1] === 'varargin';
    const fixedParams = hasVarargin ? def.params.slice(0, -1) : def.params;
    if (!hasVarargin && args.length > def.params.length) throw new MError('Too many input arguments.', 'MATLAB:TooManyInputs', name);
    const hasVarargout = def.outs[def.outs.length - 1] === 'varargout';
    if (!hasVarargout && nargout > Math.max(def.outs.length, 0) && !(nargout === 1 && def.outs.length === 0 && false)) {
      throw new MError('Too many output arguments.', 'MATLAB:TooManyOutputs', name);
    }
    const ws = new Workspace(name);
    fixedParams.forEach((p, i) => { if (i < args.length && p !== '~') ws.vars.set(p, args[i]); });
    if (hasVarargin) ws.vars.set('varargin', new Cell(1, Math.max(0, args.length - fixedParams.length), args.slice(fixedParams.length)));
    ws.nargin = args.length; ws.nargout = nargout;
    const functions = ast ? new Map(ast.functions.map(f => [f.name, f])) : (callerFrame ? callerFrame.functions : new Map());
    const frame = { ws, file: fileName, fileName: name === fileName || !fileName ? name : `${fileName}>${name}`, src, functions, fileAst: ast, funcName: name };
    this.callDepth++;
    if (this.callDepth > 500) { this.callDepth--; throw new MError('Maximum recursion limit of 500 reached. Use set(0,\'RecursionLimit\',N) to change the limit. Be aware that exceeding your available stack space can crash MATLAB and/or your computer.', 'MATLAB:recursionLimit'); }
    try { this.execBlock(def.body, frame); }
    catch (e) {
      if (e !== RETURN) {
        if (e instanceof MError) e.fromUser = true;
        throw e;
      }
    }
    finally { this.callDepth--; }
    const outs = [];
    const want = Math.max(1, nargout);
    for (let k = 0; k < def.outs.length && outs.length < want; k++) {
      const o = def.outs[k];
      if (o === 'varargout') {
        const vo = ws.vars.get('varargout');
        if (vo && vo.type === 'cell') for (const x of vo.data) { if (outs.length < want) outs.push(x); }
        continue;
      }
      const v = ws.vars.get(o);
      if (v === undefined) {
        if (k < nargout || (k === 0 && nargout === 1)) {
          const err = new MError(`Output argument "${o}" (and possibly others) not assigned a value in the execution with "${name}" function.`, 'MATLAB:unassignedOutputs');
          err.fname = name;
          throw err;
        }
        break;
      }
      outs.push(v);
    }
    return outs;
  }

  // evaluate a string as an expression (used by input, eval, str2num)
  evalString(code, frame = { ws: this.base, functions: new Map() }, nout = 1) {
    const ast = parse(code, '');
    if (ast.body.length !== 1 || ast.body[0].type !== 'Expr') {
      if (ast.body.length === 1 && ast.body[0].type === 'Cmd') {
        const st = ast.body[0];
        return this.callFunction(st.name, st.args.map(a => str(a)), nout, frame)[0];
      }
      throw new MError('Error: Invalid expression.');
    }
    const vals = this.evalMulti(ast.body[0].expr, frame, nout);
    if (nout > 1) return vals;
    if (!vals.length) throw new MError('Too many output arguments.');
    return vals[0];
  }
  execString(code, frame = { ws: this.base, functions: new Map() }) {
    const ast = parse(code, '');
    this.execBlock(ast.body, frame);
  }
  flushPlots() { if (this.plot && this.plot.flush) this.plot.flush(); }

  // ---- hooks for sym/table (filled by builtins modules) ----
  symAssign(base, args, value) { throw new MError('Symbolic assignment not supported.'); }
  symIndex(v, args) { throw new MError('Symbolic indexing not supported.'); }
  tableBrace(t, args) { throw new MError('Table brace indexing not supported.'); }
  tableParen(t, args) { throw new MError('Table indexing not supported.'); }
  tableBraceAssign(t, args, v) { throw new MError('Table assignment not supported.'); }
}

// -------------- helpers --------------
export function colonCount(a, s, b) {
  if (s === 0 || Number.isNaN(a) || Number.isNaN(s) || Number.isNaN(b)) return 0;
  if ((s > 0 && a > b) || (s < 0 && a < b)) return 0;
  const n = Math.floor((b - a) / s + 1e-10) + 1;
  if (!Number.isFinite(n)) throw new MError('Maximum variable size allowed by the program is exceeded.');
  if (n > 2e8) throw new MError('Requested array exceeds the maximum possible variable size.');
  return n;
}

function rootName(lv) { return lv.type === 'Id' ? lv.name : rootName(lv.e); }

function collectIds(node, cb) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'Id') cb(node.name);
  if (node.type === 'Anon') { /* nested anon: collect too */ }
  for (const k in node) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach(x => (Array.isArray(x) ? x.forEach(y => collectIds(y, cb)) : collectIds(x, cb)));
    else if (v && typeof v === 'object' && v.type) collectIds(v, cb);
  }
}

function defaultContainer(value) {
  if (value.type === 'cell') return new Cell(0, 0, []);
  if (value.type === 'struct') return new Struct(0, 0, value.fields, []);
  if (value.type === 'string') return new StrArr(0, 0, []);
  if (value.type === 'num') return new Tensor(0, 0, new Float64Array(0), null, value.cls);
  return empty();
}

function unionFields(a, b) {
  const all = a.fields.slice();
  for (const f of b.fields) if (!all.includes(f)) all.push(f);
  const fix = (S) => new Struct(S.rows, S.cols, all, S.data.map(m => { const nm = new Map(); for (const f of all) nm.set(f, m.has(f) ? m.get(f) : empty()); return nm; }));
  return [fix(a), fix(b)];
}
function setField(parent, fname, value) {
  if (parent === undefined || (parent.type === 'num' && parent.numel === 0)) {
    const s = new Struct(1, 1, [fname]);
    s.data[0].set(fname, value);
    return s;
  }
  if (parent.type === 'table') {
    const k = parent.varNames.indexOf(fname);
    const names = parent.varNames.slice(), cols = parent.columns.slice();
    if (value.numel !== parent.rows && parent.rows !== 0) throw new MError(`To assign to or create a variable in a table, the number of rows must match the height of the table.`);
    const col = value.rows === 1 && value.cols > 1 ? transpose(value, false) : value;
    if (k >= 0) cols[k] = col; else { names.push(fname); cols.push(col); }
    const T = new parent.constructor(names, cols, parent.rows || value.numel);
    return T;
  }
  if (parent.type !== 'struct') {
    throw new MError(`Unable to perform assignment because dot indexing is not supported for variables of this type.`);
  }
  if (parent.numel !== 1) throw new MError('Scalar structure required for this assignment.');
  const fields = parent.fields.includes(fname) ? parent.fields : [...parent.fields, fname];
  const data = parent.data.map(m => new Map(m));
  data[0].set(fname, value);
  for (let k = 1; k < data.length; k++) if (!data[k].has(fname)) data[k].set(fname, empty());
  return new Struct(parent.rows, parent.cols, fields, data);
}

// concatenation along dim (1 = vertical, 2 = horizontal)
export function catValues(items, dim, interp) {
  const fname = dim === 2 ? 'horzcat' : 'vertcat';
  // drop [] (0x0) items
  let vals = items.filter(v => !(v.type === 'num' && v.rows === 0 && v.cols === 0 && v.cls !== 'char') || false);
  if (!vals.length) {
    const ch = items.find(v => v.type === 'num' && v.cls === 'char');
    return ch ? str('') : items.length ? items[0] : empty();
  }
  if (vals.some(v => v.type === 'sym')) return interp.symCat(vals, dim);
  const types = new Set(vals.map(v => v.type));
  if (types.has('string')) {
    vals = vals.map(v => v.type === 'string' ? v : v.type === 'num' && v.cls === 'char' ? new StrArr(1, 1, [String.fromCharCode(...v.re)]) : v.type === 'num' ? new StrArr(v.rows, v.cols, Array.from(v.re, String)) : v);
  } else if (types.has('cell')) {
    vals = vals.map(v => v.type === 'cell' ? v : new Cell(1, 1, [v]));
  } else if (types.has('struct')) {
    if ([...types].some(t => t !== 'struct')) throw new MError('Concatenation of struct with other types is not supported.');
  } else if (types.has('fh')) {
    throw new MError('Nonscalar arrays of function handles are not allowed; use cell arrays instead.');
  } else if (types.has('table')) {
    if (vals.length === 1) return vals[0];
    return interp.tableCat(vals, dim);
  }
  // drop empties of size 0 in cat dimension
  vals = vals.filter(v => v.numel > 0 || (dim === 2 ? v.rows > 0 && v.cols > 0 : v.cols > 0 && v.rows > 0));
  if (!vals.length) return items[0];
  if (vals.length === 1) return vals[0];
  const first = vals[0];
  if (dim === 2) {
    const R = first.rows;
    for (const v of vals) if (v.rows !== R) throw new MError('Dimensions of arrays being concatenated are not consistent.', 'MATLAB:catenate:dimensionMismatch', fname);
  } else {
    const C = first.cols;
    for (const v of vals) if (v.cols !== C) throw new MError('Dimensions of arrays being concatenated are not consistent.', 'MATLAB:catenate:dimensionMismatch', fname);
  }
  const R = dim === 2 ? first.rows : vals.reduce((s, v) => s + v.rows, 0);
  const C = dim === 2 ? vals.reduce((s, v) => s + v.cols, 0) : first.cols;
  const kind = first.type;
  if (kind === 'num') {
    // class precedence: int > single > double; char with numbers -> char; logical with double -> double
    let cls = 'double';
    const clss = vals.map(v => v.cls);
    const intc = clss.find(c => /int/.test(c));
    if (intc) cls = intc;
    else if (clss.includes('single')) cls = 'single';
    else if (clss.includes('char')) cls = 'char';
    else if (clss.every(c => c === 'logical')) cls = 'logical';
    const re = new Float64Array(R * C);
    const anyIm = vals.some(v => v.im);
    const im = anyIm ? new Float64Array(R * C) : null;
    let off = 0;
    for (const v of vals) {
      if (dim === 2) {
        re.set(v.re, off * R); if (im && v.im) im.set(v.im, off * R);
        off += v.cols;
      } else {
        for (let j = 0; j < C; j++) for (let i = 0; i < v.rows; i++) { re[j * R + off + i] = v.re[j * v.rows + i]; if (im && v.im) im[j * R + off + i] = v.im[j * v.rows + i]; }
        off += v.rows;
      }
    }
    if (cls === 'char') for (let k = 0; k < re.length; k++) { if (re[k] < 0 || !Number.isInteger(re[k])) re[k] = Math.max(0, Math.round(re[k])); }
    else if (cls !== 'double') { const sat = (x) => { const v0 = Math.round(x); return v0; }; if (/int/.test(cls)) for (let k = 0; k < re.length; k++) re[k] = sat(re[k]); }
    return new Tensor(R, C, re, im, cls);
  }
  const data = new Array(R * C);
  let off = 0;
  for (const v of vals) {
    if (dim === 2) { for (let k = 0; k < v.numel; k++) data[off * R + k] = v.data[k]; off += v.cols; }
    else { for (let j = 0; j < C; j++) for (let i = 0; i < v.rows; i++) data[j * R + off + i] = v.data[j * v.rows + i]; off += v.rows; }
  }
  if (kind === 'cell') return new Cell(R, C, data);
  if (kind === 'string') return new StrArr(R, C, data);
  if (kind === 'struct') {
    const fields = first.fields;
    for (const v of vals) if (v.fields.length !== fields.length || !v.fields.every(f => fields.includes(f))) throw new MError('Concatenation of structs requires the same field names.');
    return new Struct(R, C, fields, data);
  }
  throw new MError(`Concatenation of ${kind} is not supported.`, '', fname);
}
