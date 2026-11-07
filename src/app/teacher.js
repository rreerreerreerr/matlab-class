// Teacher panel: browse students' files, run their code, leave notes,
// manage shared course files, reset passwords, export everything as zip.
/* global CodeMirror, JSZip */
import { createStore, isBinaryName } from './store.js';
import { EngineClient } from './engineClient.js';
import { FigureManager } from './figures.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = (d) => (d ? new Date(d).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? (n / 1024).toFixed(1) + ' KB' : (n || 0) + ' B');

const store = createStore(window.MATLAB_WEB_CONFIG || {});
const st = { students: [], selected: null, files: [], meta: [], course: [] };
let engine, figs, runOut = null, inputCb = null;

async function boot() {
  if (store.mode !== 'supabase') { document.body.innerHTML = '<div class="tp-empty" style="margin:40px">پنل استاد فقط بعد از تنظیم Supabase در فایل config.js کار می‌کند.</div>'; return; }
  const session = await store.session();
  if (!session) { location.href = 'index.html'; return; }
  const p = await store.profile();
  if (!p || p.role !== 'teacher') { document.body.innerHTML = '<div class="tp-empty" style="margin:40px">این حساب، حساب استاد نیست. <a href="index.html">بازگشت</a></div>'; return; }
  $('#tName').textContent = p.full_name;
  $('#tLogout').onclick = async () => { await store.signOut(); location.href = 'index.html'; };
  $('#tStudentView').onclick = () => { location.href = 'index.html?ide=1'; };
  $$('.tp-nav button').forEach(b => (b.onclick = () => showView(b.dataset.view)));
  figs = new FigureManager($('#figs'));
  engine = new EngineClient({
    out: (t, k) => { if (runOut) { const s = document.createElement('span'); s.className = 'k-' + k; s.textContent = t; runOut.appendChild(s); runOut.scrollTop = runOut.scrollHeight; } },
    clc: () => { if (runOut) runOut.textContent = ''; },
    plot: (pl) => figs.update(pl), vars: () => {},
    input: (prompt) => askInput(prompt), waitKey: () => Promise.resolve(),
    writeFile: () => {}, deleteFile: () => {},
    saveFigure: () => Promise.resolve(), busy: () => {},
  });
  $('#stSearch').oninput = renderStudents;
  $('#asSearch').oninput = renderAssignList;
  $('#bZipAll').onclick = zipAll;
  $('#cfUpload').onclick = uploadCourseFiles;
  await Promise.all([loadStudents(), loadCourse()]);
}

function showView(v) {
  $$('.tp-nav button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $$('.tp-view').forEach(s => (s.hidden = s.dataset.view !== v));
  if (v === 'assign') loadAssign();
}

// ---------------- students ----------------
async function loadStudents() {
  try { st.students = await store.listStudents(); } catch (e) { $('#stList').innerHTML = `<li class="err">${esc(e.message)}</li>`; return; }
  renderStudents();
}
function renderStudents() {
  const q = $('#stSearch').value.trim().toLowerCase();
  const list = st.students.filter(s => !q || s.full_name.toLowerCase().includes(q) || s.student_id.toLowerCase().includes(q));
  $('#stCount').textContent = `${list.length} دانشجو`;
  $('#stList').innerHTML = list.map(s => `<li data-id="${s.id}" class="${st.selected === s.id ? 'on' : ''}"><b>${esc(s.full_name || '(بدون نام)')}</b><span dir="ltr">${esc(s.student_id)}</span><small>${s.file_count} فایل · ${s.last_activity ? 'آخرین فعالیت ' + fmtDate(s.last_activity) : 'بدون فعالیت'}</small></li>`).join('') || '<li class="muted">هنوز دانشجویی ثبت‌نام نکرده است.</li>';
  $$('#stList li[data-id]').forEach(li => (li.onclick = () => selectStudent(li.dataset.id)));
}
async function selectStudent(id) {
  st.selected = id; renderStudents();
  const s = st.students.find(x => x.id === id);
  const box = $('#stContent');
  box.innerHTML = `<div class="tp-loading">در حال بارگذاری…</div>`;
  let files;
  try { files = await store.studentFiles(id); } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  files = files.filter(f => !f.name.endsWith('/.keep'));
  st.files = files;
  box.innerHTML = `
    <div class="st-head"><div><h2>${esc(s.full_name)}</h2><span class="muted" dir="ltr">${esc(s.student_id)}</span> · <span class="muted">عضویت ${fmtDate(s.created_at)}</span></div>
      <div class="st-tools"><button id="bStZip" class="link">دانلود فایل‌ها (zip)</button><button id="bStPw" class="link">تغییر رمز دانشجو</button></div></div>
    <table class="tp-table"><thead><tr><th>نام فایل</th><th>اندازه</th><th>ساخته شده</th><th>آخرین ویرایش</th><th>نحوه نوشتن</th></tr></thead>
    <tbody>${files.map(f => `<tr data-id="${f.id}"><td dir="ltr" class="fname">${esc(f.name)}</td><td>${fmtSize(f.size)}</td><td>${fmtDate(f.created_at)}</td><td>${fmtDate(f.updated_at)}</td><td>${fmtStats(f, s)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">این دانشجو هنوز فایلی ندارد.</td></tr>'}</tbody></table>
    <div id="stViewer"></div>`;
  $$('#stContent tr[data-id]').forEach(tr => (tr.onclick = () => { $$('#stContent tr').forEach(x => x.classList.remove('on')); tr.classList.add('on'); openViewer($('#stViewer'), files.find(f => f.id === tr.dataset.id), files, s); }));
  $('#bStZip').onclick = () => zipFiles(`${s.student_id}_${s.full_name}`, files);
  $('#bStPw').onclick = () => resetPw(s);
}
async function resetPw(s) {
  const pw = await promptFa(`رمز عبور جدید برای ${s.full_name} (حداقل ۶ کاراکتر):`);
  if (!pw) return;
  if (pw.length < 6) { await alertFa('رمز عبور باید حداقل ۶ کاراکتر باشد.'); return; }
  try { await store.resetPassword(s.id, pw); await alertFa('رمز عبور تغییر کرد. آن را به دانشجو اطلاع دهید.'); } catch (e) { await alertFa('خطا: ' + e.message); }
}

// ---------------- typing / paste stats ----------------
function fmtStats(f, owner) {
  if (owner?.can_paste) return '<span class="muted">—</span>'; // exempt from paste lock and tracking
  const x = f.stats || {};
  if (f.is_binary || !(x.keys || x.pasteBlocked || x.bulk || x.uploaded)) return '<span class="muted">—</span>';
  const out = [];
  if (x.uploaded) out.push(`<span class="flag warn" title="این فایل از کامپیوتر دانشجو بارگذاری شده، نه تایپ شده">بارگذاری‌شده ×${x.uploaded}</span>`);
  if (x.pasteBlocked) out.push(`<span class="flag warn" title="تلاش برای چسباندن متن از بیرون سایت (جلوگیری شد)">${x.pasteBlocked} تلاش پیست</span>`);
  if (x.bulk) out.push(`<span class="flag bad" title="ورود ناگهانی چند خط کد که از داخل سایت نیامده">ورود یکجا ×${x.bulk} (تا ${x.bulkMax} خط)</span>`);
  const min = Math.round((x.activeMs || 0) / 60000);
  const lowTyping = !x.uploaded && f.size > 150 && (x.keys || 0) < f.size / 3;
  out.push(`<span class="flag ${lowTyping ? 'bad' : 'ok'}" title="تعداد کلیدهای زده‌شده و زمان فعال تایپ">${x.keys || 0} کلید · ${min < 1 ? 'کمتر از ۱' : min} دقیقه</span>`);
  return out.join(' ');
}

// ---------------- viewer ----------------
function openViewer(host, file, siblings, student) {
  host.innerHTML = '';
  const v = $('#viewerTpl').content.firstElementChild.cloneNode(true);
  host.appendChild(v);
  $('.v-name', v).textContent = file.name;
  $('.v-meta', v).textContent = `${student ? student.full_name + ' · ' : ''}آخرین ویرایش ${fmtDate(file.updated_at)}`;
  const isText = !file.is_binary;
  if (isText) {
    CodeMirror($('.v-code', v), { value: file.data, mode: 'octave', readOnly: true, lineNumbers: true, theme: 'matlab', viewportMargin: Infinity });
  } else if (/\.png$/i.test(file.name)) {
    $('.v-code', v).innerHTML = `<img class="v-img" alt="" src="${URL.createObjectURL(new Blob([file.data], { type: 'image/png' }))}">`;
  } else $('.v-code', v).innerHTML = `<div class="muted" style="padding:10px">فایل دودویی (${fmtSize(file.size)})</div>`;
  const runBtn = $('.v-run', v);
  runBtn.hidden = !file.name.endsWith('.m');
  runBtn.onclick = async () => {
    const wrap = $('.v-out-wrap', v); wrap.hidden = false; runOut = $('.v-out', v); runOut.textContent = '';
    figs.closeAll();
    const files = {};
    for (const c of st.course) files[c.name] = c.data;
    // the student's code runs inside its own folder, like MATLAB after cd
    const dir = (n) => (n.includes('/') ? n.slice(0, n.indexOf('/')) : '');
    for (const f of siblings) if (dir(f.name) === dir(file.name)) files[f.name.slice(f.name.indexOf('/') + 1)] = f.data;
    engine.setFiles(files);
    await engine.run('clear all; close all', 'command');
    const base = file.name.slice(file.name.indexOf('/') + 1).replace(/\.m$/, '');
    runOut.textContent = `>> ${base}\n`;
    runBtn.disabled = true;
    await engine.run(file.data, 'script', base);
    runBtn.disabled = false;
  };
  v.inputHost = $('.v-in', v);
  $('.v-dl', v).onclick = () => download(file.name, file.data);
  $('.v-del', v).onclick = async () => {
    if (!(await confirmFa(`فایل «${file.name}» از حساب ${student ? student.full_name : 'دانشجو'} برای همیشه حذف شود؟ یادداشت‌های این فایل هم پاک می‌شوند و این کار برگشت‌پذیر نیست.`))) return;
    try { await store.deleteStudentFile(file.id); } catch (e) { await alertFa('حذف انجام نشد: ' + e.message); return; }
    await loadStudents();
    if (host.id === 'stViewer') selectStudent(student.id);
    else { await loadAssign(); showAssign(file.name); }
  };
  loadNotes(v, file);
  $('.v-note-add', v).onclick = async () => {
    const t = $('.v-note-text', v).value.trim(); if (!t) return;
    try { await store.addNote(file.id, t); $('.v-note-text', v).value = ''; loadNotes(v, file); } catch (e) { alertFa('خطا: ' + e.message); }
  };
  v.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function loadNotes(v, file) {
  const ul = $('.v-note-list', v);
  try {
    const notes = await store.notesFor(file.id);
    ul.innerHTML = notes.map(n => `<li><div>${esc(n.body)}</div><small>${fmtDate(n.created_at)}</small> <button data-id="${n.id}" class="link">حذف</button></li>`).join('') || '<li class="muted">یادداشتی ثبت نشده است.</li>';
    $$('button[data-id]', ul).forEach(b => (b.onclick = async () => { await store.deleteNote(b.dataset.id); loadNotes(v, file); }));
  } catch (e) { ul.innerHTML = `<li class="err">${esc(e.message)}</li>`; }
}
function askInput(prompt) {
  return new Promise((resolve) => {
    const host = $$('.v-in').find(x => x.closest('.viewer') && runOut && x.closest('.viewer').contains(runOut));
    if (!host) { resolve(''); return; }
    host.hidden = false; $('.v-prompt', host).textContent = prompt;
    const inp = $('.v-input', host); inp.value = ''; inp.focus();
    inp.onkeydown = (e) => { if (e.key === 'Enter') { host.hidden = true; const s = document.createElement('span'); s.textContent = prompt + inp.value + '\n'; runOut.appendChild(s); resolve(inp.value); } };
  });
}

// ---------------- by assignment ----------------
async function loadAssign() {
  try { st.meta = (await store.allFilesMeta()).filter(f => !f.name.endsWith('/.keep')); } catch (e) { $('#asList').innerHTML = `<li class="err">${esc(e.message)}</li>`; return; }
  renderAssignList();
}
function renderAssignList() {
  const q = $('#asSearch').value.trim().toLowerCase();
  const counts = new Map();
  for (const f of st.meta) counts.set(f.name, (counts.get(f.name) || 0) + 1);
  const names = [...counts.keys()].filter(n => !q || n.toLowerCase().includes(q)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  $('#asList').innerHTML = names.map(n => `<li data-name="${esc(n)}"><b dir="ltr">${esc(n)}</b><small>${counts.get(n)} دانشجو</small></li>`).join('') || '<li class="muted">فایلی وجود ندارد.</li>';
  $$('#asList li[data-name]').forEach(li => (li.onclick = () => showAssign(li.dataset.name)));
}
async function showAssign(name) {
  $$('#asList li').forEach(li => li.classList.toggle('on', li.dataset.name === name));
  const rows = st.meta.filter(f => f.name === name);
  const byId = new Map(st.students.map(s => [s.id, s]));
  const done = new Set(rows.map(r => r.owner));
  const missing = st.students.filter(s => !done.has(s.id));
  const box = $('#asContent');
  box.innerHTML = `<h2 dir="ltr" style="text-align:right">${esc(name)}</h2>
    <table class="tp-table"><thead><tr><th>دانشجو</th><th>شماره</th><th>آخرین ویرایش</th><th>اندازه</th><th>نحوه نوشتن</th></tr></thead>
    <tbody>${rows.sort((a, b) => (byId.get(a.owner)?.full_name || '').localeCompare(byId.get(b.owner)?.full_name || '', 'fa')).map(r => `<tr data-id="${r.id}" data-owner="${r.owner}"><td>${esc(byId.get(r.owner)?.full_name || '؟')}</td><td dir="ltr">${esc(byId.get(r.owner)?.student_id || '')}</td><td>${fmtDate(r.updated_at)}</td><td>${fmtSize(r.size)}</td><td>${fmtStats(r, byId.get(r.owner))}</td></tr>`).join('')}</tbody></table>
    ${missing.length ? `<details class="missing"><summary>${missing.length} دانشجو این فایل را ندارند</summary><p>${missing.map(s => esc(s.full_name) + ` (<span dir="ltr">${esc(s.student_id)}</span>)`).join('، ')}</p></details>` : ''}
    <div id="asViewer"></div>`;
  $$('#asContent tr[data-id]').forEach(tr => (tr.onclick = async () => {
    $$('#asContent tr').forEach(x => x.classList.remove('on')); tr.classList.add('on');
    const files = await store.studentFiles(tr.dataset.owner);
    const f = files.find(x => x.id === tr.dataset.id);
    openViewer($('#asViewer'), f, files, byId.get(tr.dataset.owner));
  }));
}

// ---------------- course files ----------------
async function loadCourse() {
  st.course = await store.listCourseFiles();
  $('#cfList').innerHTML = st.course.map(c => `<tr><td dir="ltr">${esc(c.name)}</td><td>${fmtSize(typeof c.data === 'string' ? c.data.length : c.data.length)}</td><td>${esc(c.description)}</td><td>${fmtDate(c.updated_at)}</td><td><button class="link" data-del="${esc(c.name)}">حذف</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">هنوز فایلی بارگذاری نشده است.</td></tr>';
  $$('#cfList button[data-del]').forEach(b => (b.onclick = async () => { if (await confirmFa(`فایل ${b.dataset.del} حذف شود؟`)) { await store.deleteCourseFile(b.dataset.del); loadCourse(); } }));
}
async function uploadCourseFiles() {
  const files = $('#cfInput').files; if (!files.length) return;
  for (const file of files) {
    if (file.size > 15 * 1024 * 1024) { await alertFa(`${file.name} بزرگ‌تر از ۱۵ مگابایت است.`); continue; }
    const name = file.name.replace(/\s+/g, '_');
    const data = isBinaryName(name) ? new Uint8Array(await file.arrayBuffer()) : await file.text();
    try { await store.saveCourseFile(name, data, $('#cfDesc').value.trim()); } catch (e) { await alertFa('خطا: ' + e.message); }
  }
  $('#cfInput').value = ''; $('#cfDesc').value = '';
  loadCourse();
}

// ---------------- export ----------------
function download(name, data) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data])); a.download = name; a.click();
}
async function zipFiles(base, files) {
  const zip = new JSZip(); const folder = zip.folder(base);
  for (const f of files) folder.file(f.name, f.data);
  const blob = await zip.generateAsync({ type: 'blob' });
  download(`${base}.zip`, blob);
}
async function zipAll() {
  const btn = $('#bZipAll'); btn.disabled = true; btn.textContent = 'در حال آماده‌سازی…';
  try {
    const zip = new JSZip();
    for (const s of st.students) {
      const files = await store.studentFiles(s.id);
      const folder = zip.folder(`${s.student_id}_${(s.full_name || '').replace(/[\\/:*?"<>|]/g, '_')}`);
      for (const f of files) if (!f.name.endsWith('/.keep')) folder.file(f.name, f.data);
    }
    download(`all_students_${new Date().toISOString().slice(0, 10)}.zip`, await zip.generateAsync({ type: 'blob' }));
  } catch (e) { alertFa('خطا: ' + e.message); }
  btn.disabled = false; btn.textContent = 'دانلود همه کدها (zip)';
}

// ---------------- dialogs ----------------
function modal(html, buttons, focusSel) {
  return new Promise((resolve) => {
    const m = $('#modal'), c = $('#modalCard');
    c.innerHTML = `<div class="modal-body">${html}</div><div class="modal-btns">${buttons.map((b, i) => `<button data-i="${i}" class="${i === 0 ? 'primary' : ''}">${b[0]}</button>`).join('')}</div>`;
    m.hidden = false;
    const done = (v) => { m.hidden = true; resolve(v); };
    $$('.modal-btns button', c).forEach(b => (b.onclick = () => done(buttons[+b.dataset.i][1]())));
    c.onkeydown = (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') done(buttons[0][1]()); if (e.key === 'Escape') done(null); };
    setTimeout(() => (focusSel ? $(focusSel, c) : $('.modal-btns button', c)).focus(), 0);
  });
}
const alertFa = (t) => modal(`<p>${esc(t)}</p>`, [['باشه', () => true]]);
const confirmFa = (t) => modal(`<p>${esc(t)}</p>`, [['بله', () => true], ['انصراف', () => false]]);
const promptFa = (t) => modal(`<label>${esc(t)}<input id="mIn" dir="ltr"></label>`, [['تأیید', () => $('#mIn').value], ['انصراف', () => null]], '#mIn');

boot();
