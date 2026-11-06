// Paste lock and typing statistics for students.
// - text copied inside the site (own files, course files, command window) may be pasted again;
//   anything else is blocked and counted
// - large insertions that did not come from the site are counted as "bulk"
// - key presses and active typing time are recorded per file
// Stats travel with each file to the database so the teacher panel can show them.

const BULK_LINES = 3, BULK_CHARS = 80, IME_LIMIT = 40, IDLE_CAP = 60000;
const norm = (t) => String(t || '').replace(/\r\n?/g, '\n').trim();

export function emptyStats() { return { keys: 0, activeMs: 0, pasteBlocked: 0, bulk: 0, bulkMax: 0 }; }

export class Guard {
  constructor({ enabled, sources, statsOf, onChange, notify }) {
    this.enabled = enabled;      // false for the teacher and exempt students
    this.sources = sources;      // () => iterable of strings the student may paste from
    this.statsOf = statsOf;      // () => stats object of the active file (or null)
    this.onChange = onChange;    // () => called after stats change
    this.notify = notify;        // (msg) => user-visible warning
    this.clip = '';              // last text copied inside the site
    this.lastEdit = 0;
    document.addEventListener('copy', () => this.remember(String(window.getSelection() || '')));
    document.addEventListener('cut', () => this.remember(String(window.getSelection() || '')));
  }
  remember(t) { if (t) this.clip = norm(t); }
  isInternal(text) {
    const t = norm(text);
    if (!t) return true;
    if (this.clip && (t === this.clip || this.clip.includes(t))) return true;
    for (const s of this.sources()) if (typeof s === 'string' && s.replace(/\r\n?/g, '\n').includes(t)) return true;
    return false;
  }
  bump(field, n = 1) {
    const st = this.statsOf(); if (!st) return;
    st[field] = (st[field] || 0) + n;
    this.onChange();
  }
  blocked() {
    this.bump('pasteBlocked');
    this.notify('Paste from outside MATLAB Web is disabled. Type your code yourself.');
  }

  attachEditor(cm) {
    cm.on('copy', (c) => this.remember(c.getSelection()));
    cm.on('cut', (c) => this.remember(c.getSelection()));
    cm.on('keydown', () => this.typed());
    cm.on('beforeChange', (c, ch) => {
      if (!this.enabled) return;
      const text = ch.text.join('\n');
      const pasteLike = ch.origin === 'paste' || ch.origin === 'drop' ||
        (ch.origin === '+input' && (text.length >= IME_LIMIT || (ch.text.length > 1 && text.trim().length >= 10)));
      if (pasteLike && !this.isInternal(text)) { ch.cancel(); this.blocked(); }
    });
    // phones: stop the paste before CodeMirror sees it (capture phase on its hidden input)
    this.attachInput(cm.getInputField(), true);
    cm.on('change', (c, ch) => {
      if (!this.enabled) return;
      if (ch.origin === 'setValue' || ch.origin === 'undo' || ch.origin === 'redo') return;
      const text = ch.text.join('\n');
      if ((ch.text.length >= BULK_LINES || text.length >= BULK_CHARS) && !this.isInternal(text)) {
        const st = this.statsOf(); if (!st) return;
        st.bulk = (st.bulk || 0) + 1;
        st.bulkMax = Math.max(st.bulkMax || 0, ch.text.length);
        this.onChange();
      }
    });
  }

  attachInput(el, editorField = false) {
    const stop = (e) => { e.preventDefault(); e.stopImmediatePropagation(); this.blocked(); };
    if (!editorField) {
      el.addEventListener('copy', () => this.remember(el.value.slice(el.selectionStart, el.selectionEnd)));
      el.addEventListener('cut', () => this.remember(el.value.slice(el.selectionStart, el.selectionEnd)));
      el.addEventListener('keydown', () => this.typed());
    }
    el.addEventListener('paste', (e) => {
      if (this.enabled && !this.isInternal(e.clipboardData && e.clipboardData.getData('text'))) stop(e);
    }, true);
    el.addEventListener('drop', (e) => {
      if (this.enabled && !this.isInternal(e.dataTransfer && e.dataTransfer.getData('text'))) stop(e);
    }, true);
    // mobile keyboards may insert clipboard text without a paste event
    el.addEventListener('beforeinput', (e) => {
      if (!this.enabled) return;
      const big = /^insertFrom(Paste|Drop)/.test(e.inputType) || ((e.inputType === 'insertText' || e.inputType === 'insertReplacementText') && (e.data || '').length >= IME_LIMIT);
      const data = e.data ?? (e.dataTransfer && e.dataTransfer.getData('text'));
      if (big && data != null && !this.isInternal(data)) stop(e);
    }, true);
  }

  typed() {
    if (!this.enabled) return;
    const st = this.statsOf(); if (!st) return;
    const now = Date.now();
    st.keys = (st.keys || 0) + 1;
    if (this.lastEdit) st.activeMs = (st.activeMs || 0) + Math.min(now - this.lastEdit, IDLE_CAP);
    this.lastEdit = now;
  }
}
