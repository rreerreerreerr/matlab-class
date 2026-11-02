// Student IDE: login, editor, command window, workspace, files, figures.
/* global CodeMirror */
import { EngineClient } from './engineClient.js';
import { FigureManager } from './figures.js';
import { createStore, isBinaryName } from './store.js';
import { ASSIGNMENTS, starterCode } from './assignments.js';
import { HELP_FA } from './helpfa.js';
import { Guard, emptyStats } from './guard.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const VALID_NAME = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;

const store = createStore(window.MATLAB_WEB_CONFIG || {});
const state = {
  profile: null,
  files: new Map(),        // name -> { data, saved: bool, savedAt }
  courseFiles: new Map(),  // name -> data
  notes: [],
  open: [],                // open editor tabs (names)
  active: null,
  cwd: '',                 // current folder ('' = MATLAB Drive root)
  docs: new Map(),         // name -> CodeMirror.Doc
  history: JSON.parse(localStorage.getItem('mw_hist') || '[]'),
  histPos: -1,
  busy: false,
  pendingInput: null,
};

// ======================= AUTH =======================
async function boot() {
  $('#authFoot').textContent = store.mode === 'local'
    ? 'حالت آزمایشی: Supabase هنوز تنظیم نشده و فایل‌ها فقط در همین مرورگر ذخیره می‌شوند.'
    : '';
  let session = null;
  try { session = await store.session(); } catch (e) { session = null; }
  if (session) {
    try { state.profile = await store.profile(); } catch (e) { state.profile = null; }
    if (state.profile && state.profile.role === 'teacher' && !/[?&]ide=1/.test(location.search)) { location.href = 'teacher.html'; return; }
    if (state.profile) return startIDE();
  }
  showAuth();
}
function showAuth() {
  $('#auth').hidden = false; $('#ide').hidden = true;
  $$('.auth-tabs button').forEach(b => b.onclick = () => {
    $$('.auth-tabs button').forEach(x => x.classList.toggle('on', x === b));
    $('#loginForm').hidden = b.dataset.tab !== 'login'; $('#registerForm').hidden = b.dataset.tab !== 'register';
    $('#authMsg').textContent = '';
  });
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    authBusy(true);
    try {
      await store.signIn({ studentId: f.sid.value, password: f.pw.value });
      state.profile = await store.profile();
      if (state.profile && state.profile.role === 'teacher') { location.href = 'teacher.html'; return; }
      $('#auth').hidden = true; startIDE();
    } catch (err) { authMsg(faError(err)); }
    authBusy(false);
  };
  $('#registerForm').onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    if (f.pw.value !== f.pw2.value) { authMsg('رمز عبور و تکرار آن یکسان نیستند.'); return; }
    authBusy(true);
    try {
      await store.signUp({ fullName: f.name.value.trim(), studentId: f.sid.value.trim(), password: f.pw.value });
      state.profile = await store.profile();
      $('#auth').hidden = true; startIDE();
    } catch (err) { authMsg(faError(err)); }
    authBusy(false);
  };
}
function authBusy(b) { $$('#auth button[type=submit]').forEach(x => (x.disabled = b)); }
function authMsg(t) { $('#authMsg').textContent = t; }
function faError(err) {
  const m = (err && (err.message || err.error_description)) || String(err);
  if (m === 'EMAIL_CONFIRM_ON') return 'حساب ساخته شد اما در تنظیمات Supabase گزینه «Confirm email» روشن است. استاد باید آن را خاموش کند.';
  if (/Invalid login credentials/i.test(m)) return 'شماره دانشجویی یا رمز عبور اشتباه است.';
  if (/already registered|already been registered|User already/i.test(m)) return 'این شماره دانشجویی قبلاً ثبت‌نام کرده است. از بخش «ورود» وارد شوید.';
  if (/Password should be at least/i.test(m)) return 'رمز عبور باید حداقل ۶ کاراکتر باشد.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'ارتباط با سرور برقرار نشد. اینترنت را بررسی کنید و دوباره تلاش کنید.';
  if (/rate limit/i.test(m)) return 'تعداد تلاش‌ها زیاد بوده است. چند دقیقه بعد دوباره امتحان کنید.';
  return 'خطا: ' + m;
}

// ======================= IDE =======================
let engine, figs, cm, guard;
async function startIDE() {
  $('#auth').hidden = true; $('#ide').hidden = false;
  const p = state.profile || {};
  $('#userBox').innerHTML = `<span dir="rtl">${esc(p.full_name || '')}</span> <small>(${esc(p.student_id || '')})</small> <button id="bLogout" class="link">Sign out</button>`;
  $('#bLogout').onclick = async () => { await flushSaves(); await store.signOut(); location.reload(); };

  guard = new Guard({
    enabled: !(p.role === 'teacher' || p.can_paste),
    sources: () => [...[...state.files.values()].map(f => f.data), ...state.courseFiles.values(), ...state.history],
    statsOf: () => { const f = state.active && state.files.get(state.active); return f ? (f.stats ||= emptyStats()) : null; },
    onChange: () => { if (state.active) scheduleSave(state.active); },
    notify: () => alertFa('چسباندن متن از بیرون سایت غیرفعال است. لطفاً کد را خودتان تایپ کنید. (این تلاش برای استاد ثبت می‌شود.)'),
  });
  figs = new FigureManager($('#figs'), { onClose: (id) => engine.run(`close(${id})`, 'command') });
  engine = new EngineClient({
    out: (t, k) => cmdWrite(t, k),
    clc: () => { $('#cmdOut').innerHTML = ''; },
    plot: (p2) => figs.update(p2),
    vars: (list) => renderWorkspace(list),
    input: (prompt) => cmdInput(prompt),
    waitKey: () => cmdWaitKey(),
    writeFile: (name, data) => { setFile(inCwd(name), data, true); },
    deleteFile: (name) => { removeFile(inCwd(name)); },
    saveFigure: async (id, name) => { const bytes = await figs.toPngBytes(id); setFile(inCwd(name), bytes, true); },
    busy: (b) => setBusy(b),
  });
  setupEditor();
  setupCommandWindow();
  setupToolstrip();
  setupSplitters();
  setupMobile();
  await loadFiles();
  cmdWrite(welcomeText(), 'dim');
  if (!engine.isolated) cmdWrite('Warning: this browser did not enable cross-origin isolation, so input() and pause cannot wait for you. Reload the page once; if it persists, use a recent Chrome, Edge or Firefox.\n', 'warn');
  const last = localStorage.getItem('mw_last_open_' + (p.student_id || ''));
  if (last && state.files.has(last)) openFile(last);
  else if (state.files.size) openFile([...state.files.keys()].find(n => n.endsWith('.m')) || null);
  $('#cmdIn').focus();
  window.addEventListener('beforeunload', (e) => { if ([...state.files.values()].some(f => !f.saved)) { flushSaves(); e.preventDefault(); e.returnValue = ''; } });
  setInterval(refreshNotes, 120000);
  new ResizeObserver(updateWidth).observe($('#cmd'));
}
function welcomeText() {
  return `MATLAB-compatible environment for the course “Special Topics 1 — MATLAB Programming”.
Type commands at the >> prompt, or open a file in the Editor and press Run (F5).
Your files are saved automatically. Type  help  for help.\n\n`;
}

// ---------------- files ----------------
async function loadFiles() {
  setStatus('Loading files…');
  try {
    const [files, course, notes] = await Promise.all([store.listFiles(), store.listCourseFiles(), store.myNotes()]);
    state.files.clear();
    for (const f of files) state.files.set(f.name, { data: f.data, saved: true, savedAt: f.updated_at, stats: { ...emptyStats(), ...(f.stats || {}) } });
    // local unsaved drafts (e.g. offline edits) win over server copy when newer
    for (const [name, d] of Object.entries(loadDrafts())) {
      const cur = state.files.get(name);
      if (!cur || (d.t > Date.parse(cur.savedAt || 0) && d.data !== cur.data)) { state.files.set(name, { data: d.data, saved: false, stats: cur?.stats || emptyStats() }); scheduleSave(name); }
    }
    state.courseFiles = new Map(course.map(c => [c.name, c.data]));
    state.courseMeta = new Map(course.map(c => [c.name, c]));
    state.notes = notes;
  } catch (e) {
    cmdWrite(`Could not load your files: ${e.message}\n`, 'err');
  }
  syncEngineFiles();
  renderFiles();
  setStatus('Ready');
}
async function refreshNotes() { try { state.notes = await store.myNotes(); renderFiles(); showNoteFor(state.active); } catch (e) { /* ignore */ } }
function syncEngineFiles() {
  const obj = {};
  for (const [n, d] of state.courseFiles) obj[n] = d;
  for (const [n, f] of state.files) if (dirOf(n) === state.cwd && !isKeep(n)) obj[baseOf(n)] = f.data;
  engine.setFiles(obj);
}
// ---- folders: a file key is 'name' (root) or 'Folder/name'; 'Folder/.keep' marks an empty folder ----
const dirOf = (k) => (k.includes('/') ? k.slice(0, k.indexOf('/')) : '');
const baseOf = (k) => k.slice(k.indexOf('/') + 1);
const isKeep = (k) => baseOf(k) === '.keep';
const inCwd = (name) => (state.cwd ? `${state.cwd}/${name}` : name);
function engineSet(key, data) { if (dirOf(key) === state.cwd && !isKeep(key)) engine.setFile(baseOf(key), data); }
function folders() { const s = new Set(); for (const k of state.files.keys()) if (dirOf(k)) s.add(dirOf(k)); return [...s].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())); }
function cd(folder) {
  state.cwd = folder;
  $('#crumbPath').innerHTML = folder ? `<a href="#" id="crumbRoot">MATLAB Drive</a> / ${esc(folder)} /` : 'MATLAB Drive /';
  const r = $('#crumbRoot'); if (r) r.onclick = (e) => { e.preventDefault(); cd(''); };
  syncEngineFiles(); renderFiles();
}
async function newFolder() {
  const n = await promptFa('نام پوشه جدید (فقط حروف انگلیسی، عدد و _ ؛ با حرف شروع شود):', 'NewFolder');
  if (!n) return;
  const clean = n.trim();
  if (!VALID_NAME.test(clean)) { await alertFa('نام پوشه نامعتبر است. مثلاً HW1 یا Quiz_05.'); return; }
  if (!folders().includes(clean)) setFile(`${clean}/.keep`, '', true);
  cd(clean);
}
async function deleteFolderPrompt(folder) {
  const keys = [...state.files.keys()].filter(k => dirOf(k) === folder);
  const n = keys.filter(k => !isKeep(k)).length;
  if (!(await confirmFa(`پوشه «${folder}»${n ? ` و ${n} فایل داخل آن` : ''} حذف شود؟ این کار برگشت‌پذیر نیست.`))) return;
  keys.forEach(removeFile);
  if (state.cwd === folder) cd('');
}
function renderFiles() {
  const tb = $('#fileList');
  const names = [...state.files.keys()].filter(k => dirOf(k) === state.cwd && !isKeep(k)).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const dirs = state.cwd ? [] : folders();
  const up = state.cwd ? '<tr data-up="1"><td><i class="fi fi-dir"></i>..</td></tr>' : '';
  tb.innerHTML = up + dirs.map(d => `<tr data-dir="${esc(d)}"><td><i class="fi fi-dir"></i>${esc(d)}</td></tr>`).join('') + names.map(n => {
    const f = state.files.get(n);
    const hasNote = state.notes.some(x => x.fileName === n);
    return `<tr data-name="${esc(n)}" class="${n === state.active ? 'sel' : ''}"><td><i class="fi ${fileIcon(n)}"></i>${esc(baseOf(n))}${f.saved ? '' : ' <span class="unsaved" title="Not saved yet">●</span>'}${hasNote ? ' <span class="note-dot" title="Teacher note">✉</span>' : ''}</td></tr>`;
  }).join('') || '<tr><td class="muted">No files yet — click “New Script”.</td></tr>';
  // folders open with a single tap (easier on phones)
  $$('#fileList tr[data-dir]').forEach(tr => {
    tr.onclick = () => cd(tr.dataset.dir);
    tr.oncontextmenu = (e) => { e.preventDefault(); showCtx(e, [['Open', () => cd(tr.dataset.dir)], ['Delete folder', () => deleteFolderPrompt(tr.dataset.dir)]]); };
  });
  $$('#fileList tr[data-up]').forEach(tr => (tr.onclick = () => cd('')));
  $$('#fileList tr[data-name]').forEach(tr => {
    tr.onclick = () => { $$('#fileList tr').forEach(x => x.classList.remove('sel')); tr.classList.add('sel'); fileDetails(tr.dataset.name); };
    tr.ondblclick = () => openOrLoad(tr.dataset.name);
    tr.oncontextmenu = (e) => { e.preventDefault(); fileMenu(e, tr.dataset.name); };
  });
  const cl = $('#courseList');
  cl.innerHTML = [...state.courseFiles.keys()].sort().map(n => `<li data-name="${esc(n)}" title="${esc((state.courseMeta.get(n) || {}).description || '')}"><i class="fi ${fileIcon(n)}"></i>${esc(n)} <span class="lock">🔒</span></li>`).join('') || '<li class="muted">—</li>';
  $$('#courseList li[data-name]').forEach(li => {
    li.ondblclick = () => { const n = li.dataset.name; if (n.endsWith('.m')) openReadOnly(n); else if (n.endsWith('.mat')) runCommand(`load('${n}')`); else fileDetails(n, true); };
    li.onclick = () => fileDetails(li.dataset.name, true);
    li.oncontextmenu = (e) => { e.preventDefault(); showCtx(e, [[`Load into workspace`, () => runCommand(`load('${li.dataset.name}')`), !li.dataset.name.endsWith('.mat')], ['Copy to my files', () => copyCourseFile(li.dataset.name)], ['Download', () => download(li.dataset.name, state.courseFiles.get(li.dataset.name))]]); };
  });
}
function fileIcon(n) { return n.endsWith('.m') ? 'fi-m' : n.endsWith('.mat') ? 'fi-mat' : /\.png|\.jpg/i.test(n) ? 'fi-img' : /\.(csv|xlsx?|txt)$/i.test(n) ? 'fi-data' : 'fi-other'; }
function fileDetails(name, course = false) {
  const data = course ? state.courseFiles.get(name) : state.files.get(name)?.data;
  const size = data == null ? 0 : typeof data === 'string' ? data.length : data.length;
  let html = `<b>${esc(name)}</b><br>${course ? 'Course file (read-only)' : 'Your file'} — ${size.toLocaleString()} bytes`;
  if (/\.png|\.jpe?g/i.test(name) && data && typeof data !== 'string') html += `<br><img class="thumb" src="${URL.createObjectURL(new Blob([data], { type: 'image/png' }))}" alt="">`;
  if (name.endsWith('.m') && typeof data === 'string') { const first = data.split('\n').find(l => l.trim().startsWith('%')); if (first) html += `<br><span class="muted">${esc(first.slice(0, 120))}</span>`; }
  $('#fileDetails').innerHTML = html;
}
function fileMenu(e, name) {
  const isM = name.endsWith('.m');
  showCtx(e, [
    ['Open', () => openOrLoad(name)],
    ['Run', () => runFile(name), !isM],
    ['Rename…', () => renameFilePrompt(name)],
    ['Download', () => download(name, state.files.get(name).data)],
    ['Delete', () => deleteFilePrompt(name)],
  ]);
}
function openOrLoad(name) {
  toggleDrawer(false);
  if (dirOf(name) !== state.cwd) cd(dirOf(name));
  showPanelMobile(name.endsWith('.mat') ? 'pCmd' : 'pEditor');
  if (name.endsWith('.m') || /\.(txt|csv)$/i.test(name)) openFile(name);
  else if (name.endsWith('.mat')) runCommand(`load('${baseOf(name)}')`);
  else fileDetails(name);
}
function showCtx(e, items) {
  const m = $('#ctxMenu');
  m.innerHTML = items.map(([t, , dis], i) => `<button data-i="${i}" ${dis ? 'disabled' : ''}>${esc(t)}</button>`).join('');
  m.hidden = false;
  m.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`; m.style.top = `${Math.min(e.clientY, window.innerHeight - items.length * 32 - 10)}px`;
  $$('button', m).forEach(b => (b.onclick = () => { m.hidden = true; items[+b.dataset.i][1](); }));
  setTimeout(() => document.addEventListener('click', () => (m.hidden = true), { once: true }), 0);
}
function download(name, data) {
  const blob = new Blob([data], { type: typeof data === 'string' ? 'text/plain;charset=utf-8' : 'application/octet-stream' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function copyCourseFile(name) {
  name = inCwd(name);
  if (state.files.has(name) && !(await confirmFa(`فایل ${name} در پوشه شما وجود دارد. جایگزین شود؟`))) return;
  setFile(name, state.courseFiles.get(baseOf(name)), true);
}

function setFile(name, data, save = false) {
  const cur = state.files.get(name);
  state.files.set(name, { data, saved: !save && cur ? cur.saved : !save, savedAt: cur?.savedAt, stats: cur?.stats || emptyStats() });
  engineSet(name, data);
  if (state.docs.has(name) && typeof data === 'string' && state.docs.get(name).getValue() !== data) state.docs.get(name).setValue(data);
  renderFiles();
  if (save) scheduleSave(name, 0);
}
function removeFile(name) {
  state.files.delete(name); engineSet(name, null); closeTab(name, true);
  store.deleteFile(name).catch(e => cmdWrite(`Could not delete ${name}: ${e.message}\n`, 'err'));
  dropDraft(name); renderFiles();
}

// ---- autosave ----
const saveTimers = new Map();
function loadDrafts() { try { return JSON.parse(localStorage.getItem(draftKey()) || '{}'); } catch (e) { return {}; } }
function draftKey() { return 'mw_drafts_' + (state.profile?.student_id || 'x'); }
function putDraft(name, data) { if (typeof data !== 'string') return; const d = loadDrafts(); d[name] = { data, t: Date.now() }; try { localStorage.setItem(draftKey(), JSON.stringify(d)); } catch (e) { /* */ } }
function dropDraft(name) { const d = loadDrafts(); delete d[name]; localStorage.setItem(draftKey(), JSON.stringify(d)); }
function scheduleSave(name, delay = 1500) {
  clearTimeout(saveTimers.get(name));
  saveTimers.set(name, setTimeout(() => saveNow(name), delay));
  saveState('Saving…');
}
async function saveNow(name) {
  saveTimers.delete(name);
  const f = state.files.get(name); if (!f) return;
  const data = f.data;
  try {
    const r = await store.saveFile(name, data, f.stats);
    const cur = state.files.get(name);
    if (cur && cur.data === data) { cur.saved = true; cur.savedAt = r && r.updated_at; dropDraft(name); }
    saveState(store.mode === 'local' ? 'Saved in this browser' : 'All changes saved');
  } catch (e) {
    saveState('Offline — saved in this browser, will retry', true);
    setTimeout(() => scheduleSave(name, 0), 15000);
  }
  renderFiles();
}
async function flushSaves() { const names = [...saveTimers.keys()]; for (const n of names) { clearTimeout(saveTimers.get(n)); await saveNow(n); } }
function saveState(t, warn = false) { const el = $('#saveState'); el.textContent = t; el.classList.toggle('warn', warn); }

// ---------------- editor ----------------
function setupEditor() {
  cm = CodeMirror($('#ebody'), {
    mode: 'octave', lineNumbers: true, indentUnit: 4, tabSize: 4, matchBrackets: true, autoCloseBrackets: "()[]{}''\"\"",
    inputStyle: 'textarea', // also on phones, so paste can be intercepted reliably
    styleActiveLine: true, theme: 'matlab', lineWrapping: false, viewportMargin: 30,
    extraKeys: {
      'Ctrl-S': () => saveActive(), 'Cmd-S': () => saveActive(),
      F5: () => runActive(), 'Ctrl-Enter': () => runSection(), 'Cmd-Enter': () => runSection(),
      F9: () => runSelection(), 'Ctrl-R': (c) => commentSel(c, true), 'Ctrl-T': (c) => commentSel(c, false),
      'Ctrl-/': (c) => c.toggleComment({ lineComment: '%' }), Tab: (c) => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('    ')),
      'Ctrl-I': (c) => c.execCommand('indentAuto'), 'Ctrl-F': 'findPersistent',
    },
  });
  guard.attachEditor(cm);
  cm.getWrapperElement().hidden = true;
  cm.on('change', (c, ch) => {
    if (!state.active || ch.origin === 'setValue') return;
    const f = state.files.get(state.active); if (!f) return;
    f.data = c.getValue(); f.saved = false;
    engineSet(state.active, f.data);
    putDraft(state.active, f.data);
    scheduleSave(state.active);
    markTab(state.active);
  });
  cm.on('cursorActivity', (c) => { const p = c.getCursor(); $('#cursorPos').textContent = `Ln ${p.line + 1}   Col ${p.ch + 1}`; });
  $('#bNewScript2').onclick = () => newScript();
}
function openFile(name) {
  if (!name) return;
  if (!state.open.includes(name)) state.open.push(name);
  if (!state.docs.has(name)) {
    const f = state.files.get(name);
    const doc = CodeMirror.Doc(typeof f?.data === 'string' ? f.data : '', 'octave');
    state.docs.set(name, doc);
  }
  state.active = name;
  cm.swapDoc(state.docs.get(name));
  cm.setOption('readOnly', false);
  cm.getWrapperElement().hidden = false; $('#emptyEditor').hidden = true;
  $('#edTitle').textContent = `/MATLAB Drive/${name}`;
  renderTabs(); renderFiles(); showNoteFor(name);
  localStorage.setItem('mw_last_open_' + (state.profile?.student_id || ''), name);
  setTimeout(() => cm.refresh(), 0);
  showPanelMobile('pEditor');
}
function openReadOnly(name) {
  toggleDrawer(false); showPanelMobile('pEditor');
  const key = '🔒' + name;
  if (!state.docs.has(key)) state.docs.set(key, CodeMirror.Doc(String(state.courseFiles.get(name) || ''), 'octave'));
  if (!state.open.includes(key)) state.open.push(key);
  state.active = key; cm.swapDoc(state.docs.get(key)); cm.setOption('readOnly', true);
  cm.getWrapperElement().hidden = false; $('#emptyEditor').hidden = true; renderTabs(); showNoteFor(null);
}
function renderTabs() {
  $('#etabs').innerHTML = state.open.map(n => `<div class="etab ${n === state.active ? 'on' : ''}" data-name="${esc(n)}" title="${esc(n)}"><span>${esc(n.startsWith('🔒') ? n : baseOf(n))}</span>${state.files.get(n) && !state.files.get(n).saved ? '<b class="dot">*</b>' : ''}<button title="Close">×</button></div>`).join('') + '<button class="etab-add" title="New script">+</button>';
  $$('#etabs .etab').forEach(t => {
    t.onclick = (e) => { if (e.target.tagName === 'BUTTON') closeTab(t.dataset.name); else t.dataset.name.startsWith('🔒') ? openReadOnly(t.dataset.name.slice(2)) : openFile(t.dataset.name); };
  });
  $('#etabs .etab-add').onclick = () => newScript();
}
function markTab(name) { const t = $(`#etabs .etab[data-name="${CSS.escape(name)}"]`); if (t && !t.querySelector('.dot')) { const b = document.createElement('b'); b.className = 'dot'; b.textContent = '*'; t.insertBefore(b, t.querySelector('button')); } }
function closeTab(name, silent) {
  const i = state.open.indexOf(name); if (i < 0) return;
  if (!silent && state.files.get(name) && !state.files.get(name).saved) saveNow(name);
  state.open.splice(i, 1); state.docs.delete(name);
  if (state.active === name) {
    const next = state.open[Math.max(0, i - 1)];
    if (next) next.startsWith('🔒') ? openReadOnly(next.slice(2)) : openFile(next);
    else { state.active = null; cm.getWrapperElement().hidden = true; $('#emptyEditor').hidden = false; $('#edTitle').textContent = 'untitled'; showNoteFor(null); }
  }
  renderTabs();
}
function showNoteFor(name) {
  const b = $('#noteBanner');
  const ns = state.notes.filter(n => n.fileName === name);
  if (!name || !ns.length) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = `<b>یادداشت استاد:</b> ${ns.map(n => `<div>${esc(n.body)} <small>(${new Date(n.created_at).toLocaleDateString('fa-IR')})</small></div>`).join('')}`;
}
async function newScript(kind = 'script') {
  const base = kind === 'function' ? 'myFunction' : 'untitled';
  let k = 1; let name = `${base}.m`;
  while (state.files.has(inCwd(name))) name = `${base}${++k}.m`;
  const n2 = await promptFa(kind === 'function' ? 'نام تابع (فقط حروف انگلیسی، عدد و _ ؛ با حرف شروع شود):' : 'نام فایل اسکریپت (فقط حروف انگلیسی، عدد و _ ؛ با حرف شروع شود):', name.replace(/\.m$/, ''));
  if (!n2) return;
  const clean = n2.trim().replace(/\.m$/, '');
  if (!VALID_NAME.test(clean)) { await alertFa('نام نامعتبر است. نام فایل باید با یک حرف انگلیسی شروع شود و فقط شامل حروف انگلیسی، عدد و _ باشد (مثل Quiz01 یا my_script).'); return; }
  const fname = inCwd(clean + '.m');
  if (state.files.has(fname)) { openFile(fname); return; }
  const content = kind === 'function' ? `function output = ${clean}(input)\n% ${clean}  Short description of the function\n\noutput = input;\nend\n` : '';
  setFile(fname, content, true); openFile(fname); cm.focus();
}
async function renameFilePrompt(name) {
  const isM = name.endsWith('.m');
  const n2 = await promptFa('نام جدید:', baseOf(name));
  if (!n2 || n2 === baseOf(name) || n2.includes('/')) return;
  const nn = (dirOf(name) ? dirOf(name) + '/' : '') + (isM && !n2.endsWith('.m') ? n2 + '.m' : n2);
  if (isM && !VALID_NAME.test(baseOf(nn).replace(/\.m$/, ''))) { await alertFa('نام نامعتبر است.'); return; }
  if (state.files.has(nn)) { await alertFa('فایلی با این نام وجود دارد.'); return; }
  try { await store.renameFile(name, nn); } catch (e) { await alertFa('تغییر نام انجام نشد: ' + e.message); return; }
  const f = state.files.get(name); state.files.delete(name); state.files.set(nn, f);
  engineSet(name, null); engineSet(nn, f.data);
  const i = state.open.indexOf(name); if (i >= 0) { state.open[i] = nn; state.docs.set(nn, state.docs.get(name)); state.docs.delete(name); if (state.active === name) state.active = nn; }
  renderTabs(); renderFiles();
}
async function deleteFilePrompt(name) { if (await confirmFa(`فایل «${name}» حذف شود؟ این کار برگشت‌پذیر نیست.`)) removeFile(name); }
function saveActive() { if (state.active && state.files.has(state.active)) { scheduleSave(state.active, 0); } }
function commentSel(c, add) {
  const from = c.getCursor('from').line, to = c.getCursor('to').line;
  c.operation(() => { for (let l = from; l <= to; l++) { const t = c.getLine(l); if (add) c.replaceRange('%' + t, { line: l, ch: 0 }, { line: l, ch: t.length }); else { const m = t.match(/^(\s*)%/); if (m) c.replaceRange(t.replace(/^(\s*)%\s?/, '$1'), { line: l, ch: 0 }, { line: l, ch: t.length }); } } });
}

// ---------------- running ----------------
function runActive() {
  if (!state.active) return;
  if (state.active.startsWith('🔒')) { const n = state.active.slice(2); return runCode(state.courseFiles.get(n), 'script', n.replace(/\.m$/, '')); }
  if (!state.active.endsWith('.m')) return;
  runFile(state.active);
}
function runFile(name) {
  const f = state.files.get(name); if (!f) return;
  saveActive();
  if (dirOf(name) !== state.cwd) { cd(dirOf(name)); cmdWrite(`cd ${state.cwd || '/MATLAB Drive'}\n`, 'dim'); }
  const base = baseOf(name).replace(/\.m$/, '');
  if (!VALID_NAME.test(base)) { cmdWrite(`Error: "${name}" is not a valid MATLAB file name. Rename it (letters, digits, underscores; must start with a letter).\n`, 'err'); return; }
  cmdEcho(base);
  runCode(f.data, 'script', base);
}
function runSection() {
  if (!state.active) return;
  const lines = cm.getValue().split('\n'); const cur = cm.getCursor().line;
  let s = cur; while (s > 0 && !/^\s*%%/.test(lines[s])) s--;
  let e = cur + 1; while (e < lines.length && !/^\s*%%/.test(lines[e])) e++;
  const code = lines.slice(s, e).join('\n');
  cmdEcho(`% Run section (lines ${s + 1}-${e})`);
  runCode(code, 'command');
}
function runSelection() {
  const sel = cm.getSelection() || cm.getLine(cm.getCursor().line);
  sel.split('\n').forEach(l => l.trim() && cmdEcho(l));
  runCode(sel, 'command');
}
function runCode(code, mode, name = '') { return engine.run(code, mode, name); }
function runCommand(code) { cmdEcho(code); pushHistory(code); return engine.run(code, 'command'); }
function setBusy(b) {
  state.busy = b;
  $('#bStop').disabled = !b; $('#bRun').disabled = b;
  setStatus(b ? 'Busy' : 'Ready');
  $('#prompt').style.visibility = b && !state.pendingInput ? 'hidden' : 'visible';
  $('#cmdLine').classList.toggle('busy', b && !state.pendingInput);
}
function setStatus(t) { $('#status').textContent = t; }

// ---------------- command window ----------------
let outBuf = '', outKind = null, outTimer = null;
function cmdWrite(text, kind = 'out') {
  // coalesce writes for speed
  if (outKind !== null && outKind !== kind) flushOut();
  outKind = kind; outBuf += text;
  if (!outTimer) outTimer = requestAnimationFrame(flushOut);
}
function flushOut() {
  if (outTimer) { cancelAnimationFrame(outTimer); outTimer = null; }
  if (!outBuf) { outKind = null; return; }
  const out = $('#cmdOut');
  const span = document.createElement('span'); span.className = 'k-' + outKind; span.textContent = outBuf;
  out.appendChild(span);
  // limit size
  while (out.childNodes.length > 4000) out.removeChild(out.firstChild);
  outBuf = ''; outKind = null;
  scrollCmd();
}
function scrollCmd() { const c = $('#cmd'); c.scrollTop = c.scrollHeight; }
function cmdEcho(code) { flushOut(); cmdWrite(code.split('\n').map((l, i) => (i ? '' : '>> ') + l).join('\n') + '\n', 'echo'); flushOut(); }
function pushHistory(code) {
  if (!code.trim()) return;
  if (state.history[state.history.length - 1] !== code) state.history.push(code);
  if (state.history.length > 300) state.history.shift();
  localStorage.setItem('mw_hist', JSON.stringify(state.history));
  state.histPos = -1;
}
function setupCommandWindow() {
  const inp = $('#cmdIn');
  guard.attachInput(inp);
  const autosize = () => { inp.style.height = 'auto'; inp.style.height = inp.scrollHeight + 'px'; };
  inp.addEventListener('input', autosize);
  inp.addEventListener('keydown', async (e) => {
    if (e.key === 'c' && e.ctrlKey && state.busy && inp.selectionStart === inp.selectionEnd) { e.preventDefault(); engine.interrupt(); return; }
    if (state.pendingInput) {
      if (e.key === 'Enter') { e.preventDefault(); const v = inp.value; inp.value = ''; autosize(); const r = state.pendingInput; state.pendingInput = null; $('#prompt').textContent = '>>'; cmdWrite(v + '\n', 'echo-in'); setBusy(true); r(v); }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (state.busy) return;
      const code = inp.value;
      if (/^\s*(for|while|if|switch|function|try)\b/.test(code) && !/\bend\s*;?\s*$/.test(code) && !code.includes('\n')) { inp.value += '\n'; autosize(); return; }
      inp.value = ''; autosize();
      runCommand(code);
    } else if (e.key === 'ArrowUp' && (inp.selectionStart === 0 || !inp.value.includes('\n'))) {
      e.preventDefault(); if (!state.history.length) return;
      const prefix = state.histPos === -1 ? inp.value : state.histPrefix;
      if (state.histPos === -1) state.histPrefix = prefix;
      let k = state.histPos === -1 ? state.history.length : state.histPos;
      do { k--; } while (k >= 0 && !state.history[k].startsWith(state.histPrefix || ''));
      if (k >= 0) { state.histPos = k; inp.value = state.history[k]; autosize(); }
    } else if (e.key === 'ArrowDown' && state.histPos !== -1) {
      e.preventDefault();
      let k = state.histPos; do { k++; } while (k < state.history.length && !state.history[k].startsWith(state.histPrefix || ''));
      if (k < state.history.length) { state.histPos = k; inp.value = state.history[k]; } else { state.histPos = -1; inp.value = state.histPrefix || ''; }
      autosize();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const pos = inp.selectionStart; const m = inp.value.slice(0, pos).match(/[A-Za-z_]\w*$/); if (!m) return;
      const list = await engine.complete(m[0]);
      if (list.length === 1) { inp.value = inp.value.slice(0, pos - m[0].length) + list[0] + inp.value.slice(pos); inp.selectionStart = inp.selectionEnd = pos - m[0].length + list[0].length; }
      else if (list.length > 1) { cmdWrite(list.join('   ') + '\n', 'dim'); }
    } else if (e.key === 'Escape') { inp.value = ''; autosize(); state.histPos = -1; }
    else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); $('#cmdOut').innerHTML = ''; }
  });
  $('#cmd').addEventListener('mouseup', () => { if (!window.getSelection().toString()) inp.focus(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F5' && !e.ctrlKey) { e.preventDefault(); if (!state.busy) runActive(); return; }
    if (e.key === 'c' && e.ctrlKey && state.busy && !window.getSelection().toString() && document.activeElement !== cm.getInputField()) { e.preventDefault(); engine.interrupt(); }
    if (state.waitKey) { const r = state.waitKey; state.waitKey = null; r(); }
  });
}
function cmdInput(prompt) {
  flushOut();
  return new Promise((resolve) => {
    cmdWrite(prompt, 'out'); flushOut();
    state.pendingInput = resolve;
    $('#prompt').textContent = ''; $('#prompt').style.visibility = 'visible'; $('#cmdLine').classList.remove('busy');
    setStatus('Waiting for input…');
    showPanelMobile('pCmd');
    $('#cmdIn').focus();
  });
}
function cmdWaitKey() {
  flushOut();
  setStatus('Paused: press any key to continue');
  return new Promise((resolve) => { state.waitKey = () => { setStatus('Busy'); resolve(); }; });
}
function updateWidth() {
  const c = $('#cmd'); const ch = 7.8;
  const w = Math.max(40, Math.floor((c.clientWidth - 30) / ch));
  if (engine && w !== state.lastWidth) { state.lastWidth = w; engine.setWidth(w); }
}

// ---------------- workspace ----------------
function renderWorkspace(list) {
  $('#wsList').innerHTML = list.map(v => `<tr data-name="${esc(v.name)}" title="${esc(v.name)}  ${esc(v.size)} ${esc(v.cls)}"><td><i class="vi vi-${v.cls === 'char' ? 'char' : v.cls === 'cell' ? 'cell' : v.cls === 'struct' ? 'struct' : v.cls === 'sym' ? 'sym' : v.cls === 'function_handle' ? 'fh' : 'num'}"></i>${esc(v.name)}</td><td>${esc(v.value)}</td><td class="opt">${esc(v.size)}</td><td class="opt">${esc(v.cls)}</td></tr>`).join('');
  $$('#wsList tr').forEach(tr => { tr.ondblclick = () => runCommand(tr.dataset.name); });
}

// ---------------- toolstrip ----------------
function setupToolstrip() {
  $$('.tst').forEach(b => b.onclick = () => { $$('.tst').forEach(x => x.classList.toggle('on', x === b)); $$('.strip').forEach(s => (s.hidden = s.dataset.strip !== b.dataset.strip)); });
  $('#bNewScript').onclick = () => newScript();
  $('#bNewFunc').onclick = () => newScript('function');
  $('#bNewFolder').onclick = () => newFolder();
  $('#bUpload').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = async (e) => {
    for (const file of e.target.files) {
      if (file.size > 15 * 1024 * 1024) { await alertFa(`فایل ${file.name} بزرگ‌تر از ۱۵ مگابایت است.`); continue; }
      const name = inCwd(file.name.replace(/\s+/g, '_'));
      const data = isBinaryName(name) ? new Uint8Array(await file.arrayBuffer()) : await file.text();
      setFile(name, data, true);
      if (guard.enabled && typeof data === 'string') { const f = state.files.get(name); f.stats.uploaded = (f.stats.uploaded || 0) + 1; }
      if (name.endsWith('.m')) openFile(name);
    }
    e.target.value = '';
  };
  $('#bClearWs').onclick = () => runCommand('clear');
  $('#bClc').onclick = () => { $('#cmdOut').innerHTML = ''; };
  $('#bCmdMenu').onclick = () => { $('#cmdOut').innerHTML = ''; };
  $('#bCloseFigs').onclick = () => runCommand('close all');
  $('#bHelp').onclick = () => showHelp();
  $('#bPassword').onclick = () => changePassword();
  $('#bSave').onclick = () => saveActive();
  $('#bDownload').onclick = () => { if (state.active && state.files.has(state.active)) download(state.active, state.files.get(state.active).data); };
  $('#bComment').onclick = () => commentSel(cm, true);
  $('#bUncomment').onclick = () => commentSel(cm, false);
  $('#bIndent').onclick = () => { cm.execCommand('selectAll'); cm.execCommand('indentAuto'); };
  $('#bRun').onclick = () => runActive();
  $('#bRunSection').onclick = () => runSection();
  $('#bStop').onclick = () => engine.interrupt();
  $('#bRefresh').onclick = () => loadFiles();
  $('#searchDoc').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.value.trim()) { runCommand(`help ${e.target.value.trim().split(/\s+/)[0]}`); e.target.value = ''; } });
  const strip = $('#assignStrip');
  strip.innerHTML = ASSIGNMENTS.map((a, i) => `<button class="as-btn ${/^HW/.test(a.file) ? 'hw' : ''}" data-i="${i}" title="${esc(a.text.slice(0, 200))}">${esc(a.title)}</button>`).join('');
  $$('.as-btn', strip).forEach(b => (b.onclick = () => openAssignment(ASSIGNMENTS[+b.dataset.i])));
}
async function openAssignment(a) {
  const name = a.file + '.m';
  if (!state.files.has(name)) setFile(name, starterCode(a), true);
  openFile(name);
  await alertFa(`<b>${esc(a.title)}</b><br><div class="as-text">${a.text.split('\n').map(l => `<div dir="auto">${esc(l) || '&nbsp;'}</div>`).join('')}</div><p class="muted">فایل <code dir="ltr">${esc(name)}</code> برای این تمرین باز شد. کد خود را زیر توضیحات بنویسید؛ همه‌چیز خودکار ذخیره می‌شود.</p>`, true);
}
async function changePassword() {
  if (store.mode === 'local') { await alertFa('در حالت آزمایشی رمز عبوری وجود ندارد.'); return; }
  const pw = await promptFa('رمز عبور جدید (حداقل ۶ کاراکتر):', '', 'password');
  if (!pw) return;
  if (pw.length < 6) { await alertFa('رمز عبور باید حداقل ۶ کاراکتر باشد.'); return; }
  try { await store.changePassword(pw); await alertFa('رمز عبور تغییر کرد.'); } catch (e) { await alertFa(faError(e)); }
}
function showHelp() { alertFa(HELP_FA, true); }

// ---------------- layout ----------------
function setupSplitters() {
  const hs = $('#hsplit'); const ed = $('#pEditor');
  let drag = false;
  hs.addEventListener('pointerdown', (e) => { drag = true; hs.setPointerCapture(e.pointerId); });
  hs.addEventListener('pointermove', (e) => { if (!drag) return; const top = ed.getBoundingClientRect().top; const h = Math.max(80, e.clientY - top); ed.style.flex = `0 0 ${h}px`; cm.refresh(); });
  hs.addEventListener('pointerup', () => { drag = false; });
}
const MOBILE = window.matchMedia('(max-width: 760px), (max-height: 500px) and (pointer: coarse)');
function setupMobile() {
  $$('#mobileTabs button').forEach(b => (b.onclick = () => (b.dataset.p === 'pFolder' ? toggleDrawer() : showPanelMobile(b.dataset.p))));
  $('#bDrawer').onclick = () => toggleDrawer();
  $('#drawerBack').onclick = () => toggleDrawer(false);
}
// Current Folder slides in from the side on phones
function toggleDrawer(open = !document.body.classList.contains('drawer-open')) {
  document.body.classList.toggle('drawer-open', open && MOBILE.matches);
}
function showPanelMobile(id) {
  if (!MOBILE.matches) return;
  toggleDrawer(false);
  $$('#mobileTabs button').forEach(b => b.classList.toggle('on', b.dataset.p === id));
  $('#desk').dataset.mobile = id;
  if (id === 'pEditor') setTimeout(() => cm.refresh(), 0);
}

// ---------------- modal dialogs (Persian) ----------------
function modal(html, buttons, focusSel) {
  return new Promise((resolve) => {
    const m = $('#modal'), c = $('#modalCard');
    c.innerHTML = `<div class="modal-body" dir="rtl">${html}</div><div class="modal-btns" dir="rtl">${buttons.map((b, i) => `<button data-i="${i}" class="${i === 0 ? 'primary' : ''}">${b[0]}</button>`).join('')}</div>`;
    m.hidden = false;
    const done = (v) => { m.hidden = true; resolve(v); };
    $$('.modal-btns button', c).forEach(b => (b.onclick = () => done(buttons[+b.dataset.i][1]())));
    c.onkeydown = (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); done(buttons[0][1]()); } if (e.key === 'Escape') done(null); };
    setTimeout(() => (focusSel ? $(focusSel, c) : $('.modal-btns button', c)).focus(), 0);
  });
}
function alertFa(html, raw = false) { return modal(raw ? html : `<p>${esc(html)}</p>`, [['باشه', () => true]]); }
function confirmFa(t) { return modal(`<p>${esc(t)}</p>`, [['بله', () => true], ['انصراف', () => false]]); }
function promptFa(t, def = '', type = 'text') {
  return modal(`<label>${esc(t)}<input id="mIn" type="${type}" dir="ltr" value="${esc(def)}"></label>`, [['تأیید', () => $('#mIn').value], ['انصراف', () => null]], '#mIn');
}

boot();
