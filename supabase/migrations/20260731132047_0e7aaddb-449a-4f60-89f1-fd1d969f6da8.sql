drop view if exists public.global_search_view;
create view public.global_search_view
with (security_invoker = true) as
  select 'patient'::text as kind, p.id, p.name as label, coalesce(p.phone, p.email) as extra, p.created_at
    from public.patients p
  union all
  select 'appointment', a.id, coalesce(pa.name, 'Consulta'), a.type, a.created_at
    from public.appointments a left join public.patients pa on pa.id = a.patient_id
  union all
  select 'treatment', t.id, t.title, t.status, t.created_at
    from public.treatments t
  union all
  select 'transaction', tr.id, coalesce(tr.description, tr.category, 'Transação'), tr.category, tr.created_at
    from public.transactions tr
  union all
  select 'medical_record', m.id, coalesce(pm.name, 'Prontuário'), m.diagnosis, m.created_at
    from public.medical_records m left join public.patients pm on pm.id = m.patient_id
  union all
  select 'task', tk.id, tk.title, tk.description, tk.created_at
    from public.tasks tk;

grant select on public.global_search_view to authenticated;