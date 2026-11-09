// Persistence: Supabase (accounts, files, teacher notes, course files)
// with a local fallback ("demo mode") when no Supabase config is present.
/* global supabase */

export const EMAIL_DOMAIN = 'student.local';
export const idToEmail = (sid) => `${String(sid).trim().toLowerCase()}@${EMAIL_DOMAIN}`;

export function toBase64(bytes) {
  let s = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}
export function fromBase64(b64) {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const isBinaryName = (name) => /\.(mat|xlsx?|png|jpe?g|gif|bmp|zip|pdf)$/i.test(name);
const encode = (data) => (typeof data === 'string' ? { content: data, is_binary: false, size: data.length } : { content: toBase64(data), is_binary: true, size: data.length });
const decode = (row) => (row.is_binary ? fromBase64(row.content || '') : row.content || '');

export function createStore(config) {
  if (config && config.MOCK_TEACHER) return new MockTeacherStore();
  if (config && config.SUPABASE_URL && config.SUPABASE_ANON_KEY && !/YOUR_/.test(config.SUPABASE_URL)) return new SupabaseStore(config);
  return new LocalStore();
}

class SupabaseStore {
  constructor(cfg) {
    this.mode = 'supabase';
    this.sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  }
  async session() { const { data } = await this.sb.auth.getSession(); return data.session; }
  async profile() {
    const s = await this.session(); if (!s) return null;
    const { data, error } = await this.sb.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
    if (error) throw error;
    return data;
  }
  async signUp({ fullName, studentId, password }) {
    const { data, error } = await this.sb.auth.signUp({ email: idToEmail(studentId), password, options: { data: { full_name: fullName, student_id: String(studentId).trim() } } });
    if (error) throw error;
    if (!data.session) {
      // email confirmation is still on in Supabase settings
      throw new Error('EMAIL_CONFIRM_ON');
    }
    return data;
  }
  async signIn({ studentId, password }) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email: idToEmail(studentId), password });
    if (error) throw error;
    return data;
  }
  async signOut() { await this.sb.auth.signOut(); }
  async changePassword(pw) { const { error } = await this.sb.auth.updateUser({ password: pw }); if (error) throw error; }

  // ---- student files ----
  async listFiles() {
    const s = await this.session();
    const { data, error } = await this.sb.from('files').select('id,name,content,is_binary,size,updated_at,stats').eq('owner', s.user.id).order('name');
    if (error) throw error;
    return data.map(r => ({ id: r.id, name: r.name, data: decode(r), updated_at: r.updated_at, stats: r.stats }));
  }
  async saveFile(name, data, stats) {
    const s = await this.session();
    const row = { owner: s.user.id, name, ...encode(data), updated_at: new Date().toISOString() };
    if (stats) row.stats = stats;
    const { data: res, error } = await this.sb.from('files').upsert(row, { onConflict: 'owner,name' }).select('id,updated_at').single();
    if (error) throw error;
    return res;
  }
  async renameFile(oldName, newName) {
    const s = await this.session();
    const { error } = await this.sb.from('files').update({ name: newName, updated_at: new Date().toISOString() }).eq('owner', s.user.id).eq('name', oldName);
    if (error) throw error;
  }
  async deleteFile(name) {
    const s = await this.session();
    const { error } = await this.sb.from('files').delete().eq('owner', s.user.id).eq('name', name);
    if (error) throw error;
  }
  async myNotes() {
    const s = await this.session();
    const { data, error } = await this.sb.from('notes').select('id,body,created_at,file_id,files!inner(name,owner)').eq('files.owner', s.user.id).order('created_at', { ascending: false });
    if (error) return [];
    return data.map(n => ({ id: n.id, body: n.body, created_at: n.created_at, fileName: n.files.name }));
  }
  // ---- course files (shared, read-only for students) ----
  async listCourseFiles() {
    const { data, error } = await this.sb.from('course_files').select('name,content,is_binary,size,description,updated_at').order('name');
    if (error) return [];
    return data.map(r => ({ name: r.name, data: decode(r), description: r.description, updated_at: r.updated_at }));
  }
  async saveCourseFile(name, data, description = '') {
    const { error } = await this.sb.from('course_files').upsert({ name, ...encode(data), description, updated_at: new Date().toISOString() }, { onConflict: 'name' });
    if (error) throw error;
  }
  async deleteCourseFile(name) { const { error } = await this.sb.from('course_files').delete().eq('name', name); if (error) throw error; }

  // ---- teacher ----
  async listStudents() {
    const { data, error } = await this.sb.from('student_overview').select('*').order('full_name');
    if (error) throw error;
    const { data: free, error: e2 } = await this.sb.from('profiles').select('id').eq('can_paste', true);
    if (e2) throw e2;
    const exempt = new Set(free.map(p => p.id));
    return data.map(s => ({ ...s, can_paste: exempt.has(s.id) }));
  }
  async studentFiles(studentId) {
    const { data, error } = await this.sb.from('files').select('id,name,content,is_binary,size,created_at,updated_at,stats').eq('owner', studentId).order('name');
    if (error) throw error;
    return data.map(r => ({ ...r, data: decode(r) }));
  }
  async allFilesMeta() {
    const { data, error } = await this.sb.from('files').select('id,name,owner,size,updated_at,stats').order('name');
    if (error) throw error;
    return data;
  }
  async deleteStudentFile(id) {
    const { data, error } = await this.sb.from('files').delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data.length) throw new Error('فایل حذف نشد (اجازه حذف وجود ندارد یا فایل قبلاً حذف شده است).');
  }
  async fileById(id) { const { data, error } = await this.sb.from('files').select('*').eq('id', id).single(); if (error) throw error; return { ...data, data: decode(data) }; }
  async notesFor(fileId) { const { data, error } = await this.sb.from('notes').select('*').eq('file_id', fileId).order('created_at'); if (error) throw error; return data; }
  async addNote(fileId, body) { const s = await this.session(); const { error } = await this.sb.from('notes').insert({ file_id: fileId, teacher: s.user.id, body }); if (error) throw error; }
  async deleteNote(id) { const { error } = await this.sb.from('notes').delete().eq('id', id); if (error) throw error; }
  async resetPassword(studentUuid, newPassword) { const { error } = await this.sb.rpc('teacher_reset_password', { student: studentUuid, new_password: newPassword }); if (error) throw error; }
}

class LocalStore {
  constructor() { this.mode = 'local'; this.key = 'mw_local_v1'; }
  load() { try { return JSON.parse(localStorage.getItem(this.key)) || { files: {}, user: null }; } catch (e) { return { files: {}, user: null }; } }
  persist(st) { try { localStorage.setItem(this.key, JSON.stringify(st)); } catch (e) { /* quota */ } }
  async session() { return this.load().user ? { user: this.load().user } : null; }
  async profile() { const u = this.load().user; return u ? { id: 'local', full_name: u.full_name, student_id: u.student_id, role: 'student' } : null; }
  async signUp({ fullName, studentId }) { const st = this.load(); st.user = { id: 'local', full_name: fullName, student_id: studentId }; this.persist(st); }
  async signIn({ studentId }) { const st = this.load(); st.user = st.user || { id: 'local', full_name: 'Demo', student_id: studentId }; this.persist(st); }
  async signOut() { const st = this.load(); st.user = null; this.persist(st); }
  async changePassword() {}
  async listFiles() { const st = this.load(); return Object.entries(st.files).map(([name, r]) => ({ name, data: decode(r), updated_at: r.updated_at })).sort((a, b) => (a.name < b.name ? -1 : 1)); }
  async saveFile(name, data) { const st = this.load(); st.files[name] = { ...encode(data), updated_at: new Date().toISOString() }; this.persist(st); return { updated_at: st.files[name].updated_at }; }
  async renameFile(o, n) { const st = this.load(); st.files[n] = st.files[o]; delete st.files[o]; this.persist(st); }
  async deleteFile(name) { const st = this.load(); delete st.files[name]; this.persist(st); }
  async myNotes() { return []; }
  async listCourseFiles() { return []; }
}

// Development-only store with sample data, used to preview the teacher panel (config.MOCK_TEACHER = true).
class MockTeacherStore {
  constructor() {
    this.mode = 'supabase';
    const now = Date.now();
    this.students = [
      { id: 's1', full_name: 'سارا احمدی', student_id: '40011001', created_at: new Date(now - 9e8).toISOString() },
      { id: 's2', full_name: 'علی رضایی', student_id: '40011002', created_at: new Date(now - 8e8).toISOString() },
      { id: 's3', full_name: 'مریم کریمی', student_id: '40011003', created_at: new Date(now - 7e8).toISOString() },
    ];
    this.files = [
      { id: 'f1', owner: 's1', name: 'Quiz05.m', content: "%% Quiz 5\nA = [4 7 2; 1 5 9; 6 3 8];\nmx = max(A(:))\nmn = min(A(:))\ns = sum(A(:))\nm = mean(A(:))\n", is_binary: false },
      { id: 'f2', owner: 's1', name: 'Quiz12.m', content: "time = 0:1:9;\nheartRate = [72 74 78 85 92 105 112 108 96 88];\nplot(time,heartRate,'-or','LineWidth',2)\ntitle('Heart rate'), xlabel('Time (min)'), ylabel('bpm'), grid on, legend('HR')\n", is_binary: false },
      { id: 'f3', owner: 's2', stats: { pasteBlocked: 3, bulk: 1, bulkMax: 4 }, name: 'Quiz05.m', content: "A = [4 7 2; 1 5 9; 6 3 8];\nmax(A)\nsum(A)\n", is_binary: false },
      { id: 'f4', owner: 's2', name: 'Quiz11.m', content: "name = input('Name: ','s');\ng = input('Grades: ');\nfprintf('%s: %.2f\\n', name, mean(g));\n", is_binary: false },
    ].map((f, k) => ({ ...f, size: f.content.length, created_at: new Date(now - 5e8 + k * 1e7).toISOString(), updated_at: new Date(now - 1e8 + k * 1e7).toISOString() }));
    this.notes = [{ id: 'n1', file_id: 'f3', body: 'max(A) بیشترین مقدار هر ستون را می‌دهد؛ برای کل ماتریس از max(A(:)) استفاده کنید.', created_at: new Date(now - 5e7).toISOString() }];
    this.course = [];
  }
  async session() { return { user: { id: 't1' } }; }
  async profile() { return { id: 't1', full_name: 'استاد عابدزاده', student_id: 'teacher', role: 'teacher' }; }
  async signOut() {}
  async listStudents() { return this.students.map(s => { const fs = this.files.filter(f => f.owner === s.id); return { ...s, file_count: fs.length, last_activity: fs.length ? fs.map(f => f.updated_at).sort().pop() : null }; }); }
  async studentFiles(id) { return this.files.filter(f => f.owner === id).map(f => ({ ...f, data: f.content })); }
  async allFilesMeta() { return this.files.map(({ id, name, owner, size, updated_at, stats }) => ({ id, name, owner, size, updated_at, stats })); }
  async deleteStudentFile(id) { this.files = this.files.filter(f => f.id !== id); }
  async notesFor(fileId) { return this.notes.filter(n => n.file_id === fileId); }
  async addNote(fileId, body) { this.notes.push({ id: 'n' + Math.random(), file_id: fileId, body, created_at: new Date().toISOString() }); }
  async deleteNote(id) { this.notes = this.notes.filter(n => n.id !== id); }
  async resetPassword() {}
  async listCourseFiles() { return this.course; }
  async saveCourseFile(name, data, description) { this.course = this.course.filter(c => c.name !== name).concat([{ name, data, description, updated_at: new Date().toISOString() }]); }
  async deleteCourseFile(name) { this.course = this.course.filter(c => c.name !== name); }
}
