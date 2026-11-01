// Engine entry: creates an interpreter with all builtins installed.
import { Interp } from './interp.js';
import { installCore } from './builtins/core.js';
import { installStrings } from './builtins/strings.js';
import { installLang } from './builtins/lang.js';
import { installNumeric } from './builtins/numeric.js';
import { installFiles } from './builtins/files.js';
import { installPlot } from './builtins/plot.js';
import { installSym } from './builtins/sym.js';
import { toRows, leastSquares, setWarnHook } from './ops.js';
import { subsref, subsasgn } from './indexing.js';

export function createEngine(host) {
  const I = new Interp(host);
  I.toRowsArr = toRows;
  I.leastSquares = leastSquares;
  I.subsrefRaw = subsref;
  I.subsasgnRaw = subsasgn;
  setWarnHook((m) => I.warn(m));
  installCore(I);
  installStrings(I);
  installLang(I);
  installNumeric(I);
  installFiles(I);
  installPlot(I);
  installSym(I);
  return I;
}
export { fmtState } from './format.js';
