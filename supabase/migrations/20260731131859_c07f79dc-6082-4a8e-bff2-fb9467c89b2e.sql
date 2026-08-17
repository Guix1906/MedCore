create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  entity_label text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant select, insert on public.activity_logs to authenticated;
grant all on public.activity_logs to service_role;
alter table public.activity_logs enable row level security;
drop policy if exists "activity_logs_select_company" on public.activity_logs;
create policy "activity_logs_select_company" on public.activity_logs
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists "activity_logs_insert_company" on public.activity_logs;
create policy "activity_logs_insert_company" on public.activity_logs
  for insert to authenticated with check (public.is_company_member(company_id) and user_id = auth.uid());
create index if not exists idx_activity_logs_company_created on public.activity_logs (company_id, created_at desc);