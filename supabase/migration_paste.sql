-- Paste lock + typing stats (run once after schema.sql)
alter table public.profiles add column if not exists can_paste boolean not null default false;
alter table public.files    add column if not exists stats jsonb not null default '{}'::jsonb;

-- students may not change their role, student id or paste permission
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_teacher() then
    new.role := old.role;
    new.student_id := old.student_id;
    new.can_paste := old.can_paste;
  end if;
  return new;
end $$;

-- To let one student paste freely:
--   update public.profiles set can_paste = true where student_id = 'STUDENT_ID';
