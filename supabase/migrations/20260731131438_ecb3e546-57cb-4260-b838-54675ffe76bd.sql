-- ========== COMPANIES ==========
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.companies to authenticated;
grant all on public.companies to service_role;
alter table public.companies enable row level security;

create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);
grant select, insert, update, delete on public.company_members to authenticated;
grant all on public.company_members to service_role;
alter table public.company_members enable row level security;

create or replace function public.is_company_member(_company_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.company_members cm
    where cm.company_id = _company_id and cm.user_id = auth.uid()
  );
$$;

drop policy if exists "companies_select_member" on public.companies;
create policy "companies_select_member" on public.companies
  for select to authenticated using (public.is_company_member(id));

drop policy if exists "company_members_select_own_company" on public.company_members;
create policy "company_members_select_own_company" on public.company_members
  for select to authenticated using (public.is_company_member(company_id));

-- ========== PROFILES: empresa ativa ==========
alter table public.profiles add column if not exists active_company_id uuid references public.companies(id) on delete set null;

-- ========== USER ROLES ==========
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  unique (user_id, company_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
drop policy if exists "user_roles_select_company" on public.user_roles;
create policy "user_roles_select_company" on public.user_roles
  for select to authenticated using (public.is_company_member(company_id));

-- ========== updated_at ==========
create or replace function public.update_updated_at_column()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

-- ========== CASES ==========
create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open',
  patient_id uuid references public.patients(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.cases to authenticated;
grant all on public.cases to service_role;
alter table public.cases enable row level security;
drop policy if exists "cases_all_company" on public.cases;
create policy "cases_all_company" on public.cases
  for all to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
drop trigger if exists trg_cases_updated_at on public.cases;
create trigger trg_cases_updated_at before update on public.cases
  for each row execute function public.update_updated_at_column();

-- ========== ENUMS ==========
do $$ begin create type public.event_type as enum ('hearing','meeting','deadline','other');
exception when duplicate_object then null; end $$;
do $$ begin create type public.task_status as enum ('todo','in_progress','done','cancelled');
exception when duplicate_object then null; end $$;
do $$ begin create type public.task_priority as enum ('low','medium','high','urgent');
exception when duplicate_object then null; end $$;

-- ========== TASKS (recriada) ==========
drop table if exists public.tasks cascade;
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  patient_id uuid references public.patients(id) on delete set null,
  doctor_id uuid references public.doctors(id) on delete set null,
  origin text,
  title text not null,
  description text,
  status public.task_status not null default 'todo',
  priority public.task_priority not null default 'medium',
  due_date timestamptz,
  completed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.tasks to authenticated;
grant all on public.tasks to service_role;
alter table public.tasks enable row level security;
create policy "tasks_select_company" on public.tasks for select to authenticated using (public.is_company_member(company_id));
create policy "tasks_insert_company" on public.tasks for insert to authenticated with check (public.is_company_member(company_id) and created_by = auth.uid());
create policy "tasks_update_company" on public.tasks for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
create policy "tasks_delete_company" on public.tasks for delete to authenticated using (public.is_company_member(company_id));
create trigger trg_tasks_updated_at before update on public.tasks for each row execute function public.update_updated_at_column();
create index if not exists idx_tasks_company_due on public.tasks (company_id, due_date);
create index if not exists idx_tasks_assigned on public.tasks (assigned_to);

-- ========== EVENTS ==========
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  patient_id uuid references public.patients(id) on delete set null,
  title text not null,
  description text,
  event_type public.event_type not null default 'meeting',
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.events to authenticated;
grant all on public.events to service_role;
alter table public.events enable row level security;
drop policy if exists "events_select_company" on public.events;
create policy "events_select_company" on public.events for select to authenticated using (public.is_company_member(company_id));
drop policy if exists "events_insert_company" on public.events;
create policy "events_insert_company" on public.events for insert to authenticated with check (public.is_company_member(company_id) and created_by = auth.uid());
drop policy if exists "events_update_company" on public.events;
create policy "events_update_company" on public.events for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
drop policy if exists "events_delete_company" on public.events;
create policy "events_delete_company" on public.events for delete to authenticated using (public.is_company_member(company_id));
drop trigger if exists trg_events_updated_at on public.events;
create trigger trg_events_updated_at before update on public.events for each row execute function public.update_updated_at_column();
create index if not exists idx_events_company_start on public.events (company_id, starts_at);

-- ========== DEADLINES ==========
create table if not exists public.deadlines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  publication_id uuid,
  case_id uuid references public.cases(id) on delete set null,
  assigned_to uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  due_date date not null,
  status text not null default 'pending',
  is_double_term boolean not null default false,
  last_alert_at timestamptz,
  last_alert_level text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.deadlines to authenticated;
grant all on public.deadlines to service_role;
alter table public.deadlines enable row level security;
drop policy if exists "deadlines_select_company" on public.deadlines;
create policy "deadlines_select_company" on public.deadlines for select to authenticated using (public.is_company_member(company_id));
drop policy if exists "deadlines_insert_company" on public.deadlines;
create policy "deadlines_insert_company" on public.deadlines for insert to authenticated with check (public.is_company_member(company_id) and created_by = auth.uid());
drop policy if exists "deadlines_update_company" on public.deadlines;
create policy "deadlines_update_company" on public.deadlines for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
drop policy if exists "deadlines_delete_company" on public.deadlines;
create policy "deadlines_delete_company" on public.deadlines for delete to authenticated using (public.is_company_member(company_id));
drop trigger if exists trg_deadlines_updated_at on public.deadlines;
create trigger trg_deadlines_updated_at before update on public.deadlines for each row execute function public.update_updated_at_column();
create index if not exists idx_deadlines_company_due on public.deadlines (company_id, due_date);

-- ========== EMPRESA PADRÃO + VÍNCULOS ==========
insert into public.companies (id, name)
select '00000000-0000-0000-0000-0000000c1111', 'ClinicMed'
where not exists (select 1 from public.companies);

insert into public.company_members (company_id, user_id)
select (select id from public.companies order by created_at limit 1), u.id
from auth.users u
on conflict (company_id, user_id) do nothing;

insert into public.user_roles (user_id, company_id, role)
select u.id, (select id from public.companies order by created_at limit 1), 'owner'
from auth.users u
on conflict do nothing;

update public.profiles set active_company_id = (select id from public.companies order by created_at limit 1)
where active_company_id is null;

create or replace function public.attach_default_company()
returns trigger language plpgsql security definer set search_path = public as $$
declare _company uuid;
begin
  select id into _company from public.companies order by created_at limit 1;
  if _company is null then return new; end if;
  insert into public.company_members (company_id, user_id) values (_company, new.id)
    on conflict (company_id, user_id) do nothing;
  insert into public.user_roles (user_id, company_id, role) values (new.id, _company, 'member')
    on conflict do nothing;
  return new;
end; $$;

drop trigger if exists trg_attach_default_company on auth.users;
create trigger trg_attach_default_company after insert on auth.users
  for each row execute function public.attach_default_company();

-- ========== REALTIME ==========
alter table public.tasks replica identity full;
alter table public.events replica identity full;
alter table public.deadlines replica identity full;
do $$ begin alter publication supabase_realtime add table public.tasks; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.events; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.deadlines; exception when duplicate_object then null; end $$;