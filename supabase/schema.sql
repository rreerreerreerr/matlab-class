-- =====================================================================
-- MATLAB Web — database schema for Supabase
-- Run this whole file once in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- profiles (one row per user) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  student_id  text not null unique,
  role        text not null default 'student' check (role in ('student', 'teacher')),
  can_paste   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------- student files ----------
create table if not exists public.files (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references public.profiles(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  content     text not null default '',
  is_binary   boolean not null default false,
  size        integer not null default 0 check (size <= 20000000),
  stats       jsonb not null default '{}'::jsonb,   -- typing / paste statistics
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner, name)
);
create index if not exists files_owner_idx on public.files(owner);
create index if not exists files_name_idx on public.files(name);

-- ---------- teacher notes on student files ----------
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  file_id     uuid not null references public.files(id) on delete cascade,
  teacher     uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 5000),
  created_at  timestamptz not null default now()
);
create index if not exists notes_file_idx on public.notes(file_id);

-- ---------- course files shared by the teacher (data sets, examples) ----------
create table if not exists public.course_files (
  name        text primary key check (char_length(name) between 1 and 120),
  content     text not null default '',
  is_binary   boolean not null default false,
  size        integer not null default 0,
  description text not null default '',
  updated_at  timestamptz not null default now()
);

-- ---------- helper: is the current user a teacher? ----------
create or replace function public.is_teacher() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher');
$$;

-- ---------- create profile automatically on sign-up ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, student_id, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'student_id', split_part(new.email, '@', 1)),
    'student'                       -- everyone signs up as a student
  );
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- students may not change their role, student id or paste permission ----------
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is null when run from the SQL editor (admin): allow everything there
  if auth.uid() is not null and not public.is_teacher() then
    new.role := old.role;
    new.student_id := old.student_id;
    new.can_paste := old.can_paste;
  end if;
  return new;
end $$;
drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before update on public.profiles
  for each row execute function public.protect_profile();

-- ---------- row level security ----------
alter table public.profiles     enable row level security;
alter table public.files        enable row level security;
alter table public.notes        enable row level security;
alter table public.course_files enable row level security;

drop policy if exists "profiles: read own or teacher" on public.profiles;
create policy "profiles: read own or teacher" on public.profiles
  for select using (id = auth.uid() or public.is_teacher());
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update using (id = auth.uid() or public.is_teacher());

drop policy if exists "files: owner all" on public.files;
create policy "files: owner all" on public.files
  for all using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "files: teacher read" on public.files;
create policy "files: teacher read" on public.files
  for select using (public.is_teacher());

drop policy if exists "notes: teacher all" on public.notes;
create policy "notes: teacher all" on public.notes
  for all using (public.is_teacher()) with check (public.is_teacher() and teacher = auth.uid());
drop policy if exists "notes: student reads own" on public.notes;
create policy "notes: student reads own" on public.notes
  for select using (exists (select 1 from public.files f where f.id = file_id and f.owner = auth.uid()));

drop policy if exists "course files: read" on public.course_files;
create policy "course files: read" on public.course_files
  for select using (auth.uid() is not null);
drop policy if exists "course files: teacher write" on public.course_files;
create policy "course files: teacher write" on public.course_files
  for all using (public.is_teacher()) with check (public.is_teacher());

-- ---------- teacher overview of students ----------
create or replace view public.student_overview with (security_invoker = true) as
  select p.id, p.full_name, p.student_id, p.created_at,
         count(f.id)::int as file_count,
         max(f.updated_at) as last_activity
  from public.profiles p
  left join public.files f on f.owner = p.id
  where p.role = 'student'
  group by p.id;

-- ---------- teacher resets a student's password ----------
create or replace function public.teacher_reset_password(student uuid, new_password text)
returns void language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if not public.is_teacher() then
    raise exception 'only the teacher can reset passwords';
  end if;
  if char_length(new_password) < 6 then
    raise exception 'password must be at least 6 characters';
  end if;
  update auth.users set encrypted_password = crypt(new_password, gen_salt('bf'))
  where id = student;
end $$;
revoke all on function public.teacher_reset_password(uuid, text) from public, anon;
grant execute on function public.teacher_reset_password(uuid, text) to authenticated;

-- =====================================================================
-- After the teacher has signed up on the website ONCE, make that account
-- the teacher by running (replace the number with the teacher's ID):
--
--   update public.profiles set role = 'teacher' where student_id = 'TEACHER_ID';
-- =====================================================================
