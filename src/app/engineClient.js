// Runs the MATLAB engine in a Web Worker and bridges blocking requests
// (input/pause/saveas) through a SharedArrayBuffer.

export class EngineClient {
  constructor(handlers) {
    this.h = handlers; // { out(text, kind), clc(), plot(payload), vars(list), input(prompt) -> Promise<string|null>, waitKey() -> Promise, writeFile(name,data), deleteFile(name), saveFigure(id,name) -> Promise, busy(bool) }
    this.queue = [];
    this.running = null;
    this.nextId = 1;
    this.completeCbs = new Map();
    this.start();
  }
  start() {
    this.isolated = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated;
    this.sab = this.isolated ? new SharedArrayBuffer(16 + (1 << 20)) : null;
    if (this.sab) { this.ctl = new Int32Array(this.sab, 0, 4); this.buf = new Uint8Array(this.sab, 16); }
    this.worker = new Worker(new URL('./engine-worker.js', import.meta.url));
    this.worker.onmessage = (e) => this.onMessage(e.data);
    this.worker.onerror = (e) => { this.h.out(`Engine error: ${e.message}\n`, 'err'); };
    this.worker.postMessage({ type: 'init', sab: this.sab, width: this.width || 100 });
    if (this.files) this.worker.postMessage({ type: 'files', files: this.files });
  }
  setWidth(w) { this.width = w; this.worker.postMessage({ type: 'width', width: w }); }
  setFiles(files) { this.files = files; this.worker.postMessage({ type: 'files', files }); }
  setFile(name, data) { if (this.files) { if (data == null) delete this.files[name]; else this.files[name] = data; } this.worker.postMessage({ type: 'setFile', name, data }); }

  run(code, mode = 'command', name = '') {
    return new Promise((resolve) => {
      this.queue.push({ id: this.nextId++, code, mode, name, resolve });
      this.pump();
    });
  }
  pump() {
    if (this.running || !this.queue.length) return;
    this.running = this.queue.shift();
    this.h.busy(true);
    this.worker.postMessage({ type: 'run', id: this.running.id, code: this.running.code, mode: this.running.mode, name: this.running.name, width: this.width });
  }
  respond(text) {
    if (!this.ctl) return;
    const bytes = new TextEncoder().encode(text ?? '');
    if (text === null) { Atomics.store(this.ctl, 0, 2); Atomics.notify(this.ctl, 0); return; }
    this.buf.set(bytes.subarray(0, this.buf.length));
    Atomics.store(this.ctl, 2, Math.min(bytes.length, this.buf.length));
    Atomics.store(this.ctl, 0, 1);
    Atomics.notify(this.ctl, 0);
  }
  interrupt() {
    if (!this.running) return;
    if (this.ctl) {
      Atomics.store(this.ctl, 1, 1);
      Atomics.notify(this.ctl, 3);
      if (this.pendingInput) { this.pendingInput = false; this.respond(null); }
      // hard stop if the engine does not respond (e.g. very long builtin)
      clearTimeout(this.killTimer);
      this.killTimer = setTimeout(() => { if (this.running) this.hardRestart(); }, 2500);
    } else this.hardRestart();
  }
  hardRestart() {
    this.worker.terminate();
    this.h.out('Operation terminated by user. (The workspace was cleared because the engine had to be restarted.)\n', 'err');
    const r = this.running; this.running = null;
    this.queue = [];
    this.start();
    this.h.busy(false);
    if (r) r.resolve(false);
    this.h.vars([]);
  }
  complete(prefix) {
    return new Promise((resolve) => { const id = this.nextId++; this.completeCbs.set(id, resolve); this.worker.postMessage({ type: 'complete', id, prefix }); });
  }
  async onMessage(m) {
    switch (m.type) {
      case 'out': this.h.out(m.text, m.kind); break;
      case 'clc': this.h.clc(); break;
      case 'plot': this.h.plot(m.payload); break;
      case 'vars': this.h.vars(m.list); break;
      case 'writeFile': this.h.writeFile(m.name, m.data); if (this.files) this.files[m.name] = m.data; break;
      case 'deleteFile': this.h.deleteFile(m.name); if (this.files) delete this.files[m.name]; break;
      case 'completions': { const cb = this.completeCbs.get(m.id); if (cb) { this.completeCbs.delete(m.id); cb(m.list); } break; }
      case 'input': {
        this.pendingInput = true;
        const text = await this.h.input(m.prompt);
        if (this.pendingInput) { this.pendingInput = false; this.respond(text); }
        break;
      }
      case 'waitKey': {
        this.pendingInput = true;
        await this.h.waitKey();
        if (this.pendingInput) { this.pendingInput = false; this.respond(''); }
        break;
      }
      case 'saveFigure': {
        this.pendingInput = true;
        try { await this.h.saveFigure(m.id, m.name); } catch (e) { this.h.out(`Warning: could not save figure: ${e.message}\n`, 'warn'); }
        if (this.pendingInput) { this.pendingInput = false; this.respond(''); }
        break;
      }
      case 'done': {
        clearTimeout(this.killTimer);
        const r = this.running; this.running = null;
        this.h.busy(!!this.queue.length);
        if (r) r.resolve(m.ok);
        this.pump();
        break;
      }
    }
  }
}
