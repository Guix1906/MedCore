
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 1. DOCTORS
create table if not exists public.doctors (
  id uuid primary key default uuid_generate_v4(),
  auth_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text unique not null,
  specialty text,
  crm text,
  role text not null default 'medico' check (role in ('admin','medico','recepcionista','enfermeiro')),
  avatar_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.doctors to anon, authenticated;
grant all on public.doctors to service_role;
alter table public.doctors enable row level security;

-- 2. PATIENTS
create table if not exists public.patients (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  email text,
  phone text,
  cpf text unique,
  birth_date date,
  gender text check (gender in ('M','F','outro')),
  blood_type text,
  insurance text default 'Particular',
  insurance_number text,
  address text, city text, state text, zip_code text,
  emergency_contact_name text,
  emergency_contact_phone text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.patients to anon, authenticated;
grant all on public.patients to service_role;
alter table public.patients enable row level security;

-- 3. APPOINTMENTS
create table if not exists public.appointments (
  id uuid primary key default uuid_generate_v4(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  date date not null,
  start_time time not null,
  end_time time not null,
  type text not null default 'consulta' check (type in ('consulta','retorno','primeira_consulta','avaliacao','exame','procedimento','teleconsulta')),
  status text not null default 'agendado' check (status in ('agendado','confirmado','aguardando','em_atendimento','concluido','faltou','cancelado')),
  notes text,
  insurance text,
  online boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists appointments_date_idx on public.appointments(date);
create index if not exists appointments_doctor_id_idx on public.appointments(doctor_id);
create index if not exists appointments_patient_id_idx on public.appointments(patient_id);
grant select, insert, update, delete on public.appointments to anon, authenticated;
grant all on public.appointments to service_role;
alter table public.appointments enable row level security;

-- 4. MEDICAL RECORDS
create table if not exists public.medical_records (
  id uuid primary key default uuid_generate_v4(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid references public.doctors(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  clinical_history text, surgical_history text, family_history text,
  habits text, allergies text,
  complaint text, evolution text, diagnosis text, diagnosis_code text, conduct text,
  return_date date, return_notes text,
  started_at timestamptz, finished_at timestamptz, duration_seconds int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists medical_records_patient_idx on public.medical_records(patient_id);
grant select, insert, update, delete on public.medical_records to anon, authenticated;
grant all on public.medical_records to service_role;
alter table public.medical_records enable row level security;

-- 5. PRESCRIPTIONS
create table if not exists public.prescriptions (
  id uuid primary key default uuid_generate_v4(),
  medical_record_id uuid references public.medical_records(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid references public.doctors(id) on delete set null,
  medication text not null,
  dosage text, frequency text, duration text, instructions text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.prescriptions to anon, authenticated;
grant all on public.prescriptions to service_role;
alter table public.prescriptions enable row level security;

-- 6. PATIENT TAGS
create table if not exists public.patient_tags (
  id uuid primary key default uuid_generate_v4(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  label text not null,
  color text default '#0066D0',
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.patient_tags to anon, authenticated;
grant all on public.patient_tags to service_role;
alter table public.patient_tags enable row level security;

-- 7. TRANSACTIONS
create table if not exists public.transactions (
  id uuid primary key default uuid_generate_v4(),
  type text not null check (type in ('receita','despesa','transferencia')),
  amount numeric(12,2) not null,
  category text, description text,
  date date not null default current_date,
  status text not null default 'pendente' check (status in ('pendente','concluido','cancelado')),
  patient_id uuid references public.patients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  doctor_id uuid references public.doctors(id) on delete set null,
  payment_method text check (payment_method in ('dinheiro','cartao_credito','cartao_debito','pix','transferencia','convenio','boleto')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists transactions_date_idx on public.transactions(date);
create index if not exists transactions_type_idx on public.transactions(type);
grant select, insert, update, delete on public.transactions to anon, authenticated;
grant all on public.transactions to service_role;
alter table public.transactions enable row level security;

-- 8. INVENTORY ITEMS
create table if not exists public.inventory_items (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  code text unique,
  category text check (category in ('medicamento','epi','higiene','material_medico','equipamento','outro')),
  quantity int not null default 0,
  unit text default 'un',
  min_quantity int not null default 0,
  expiry_date date, supplier text,
  unit_cost numeric(10,2),
  location text, notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.inventory_items to anon, authenticated;
grant all on public.inventory_items to service_role;
alter table public.inventory_items enable row level security;

-- 9. INVENTORY MOVEMENTS
create table if not exists public.inventory_movements (
  id uuid primary key default uuid_generate_v4(),
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  type text not null check (type in ('entrada','saida','ajuste')),
  quantity int not null,
  reason text,
  doctor_id uuid references public.doctors(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists inventory_movements_item_idx on public.inventory_movements(item_id);
grant select, insert, update, delete on public.inventory_movements to anon, authenticated;
grant all on public.inventory_movements to service_role;
alter table public.inventory_movements enable row level security;

-- 10. NOTIFICATIONS
create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  doctor_id uuid references public.doctors(id) on delete cascade,
  type text not null check (type in ('agendamento','lembrete','estoque','financeiro','sistema')),
  title text not null,
  body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.notifications to anon, authenticated;
grant all on public.notifications to service_role;
alter table public.notifications enable row level security;

-- 11. WAITLIST
create table if not exists public.waitlist (
  id uuid primary key default uuid_generate_v4(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id uuid references public.doctors(id) on delete set null,
  requested_at date not null default current_date,
  preferred_period text check (preferred_period in ('manha','tarde','noite','qualquer')),
  notes text,
  status text not null default 'aguardando' check (status in ('aguardando','agendado','cancelado')),
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.waitlist to anon, authenticated;
grant all on public.waitlist to service_role;
alter table public.waitlist enable row level security;

-- Trigger updated_at
create or replace function public.update_updated_at()
returns trigger language plpgsql
set search_path = public
as $$
begin new.updated_at = now(); return new; end;
$$;

do $$
declare t text;
begin
  foreach t in array array['doctors','patients','appointments','medical_records','inventory_items','transactions'] loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.update_updated_at()', t, t);
  end loop;
end $$;

-- Políticas abertas (dev). RESTRINGIR quando autenticação for adicionada.
do $$
declare tb text;
begin
  foreach tb in array array['doctors','patients','appointments','medical_records','prescriptions','patient_tags','transactions','inventory_items','inventory_movements','notifications','waitlist'] loop
    execute format('drop policy if exists "allow_all_%1$s" on public.%1$I', tb);
    execute format('create policy "allow_all_%1$s" on public.%1$I for all to anon, authenticated using (true) with check (true)', tb);
  end loop;
end $$;

-- Dados iniciais
insert into public.doctors (name, email, specialty, crm, role) values
  ('Guilherme Teixeira', 'gt@medflow.com', 'Clínica Geral', 'CRM-12345', 'admin')
on conflict (email) do nothing;

insert into public.patients (name, email, phone, birth_date, gender, insurance) values
  ('Maria Santos',   'maria@email.com',   '(11) 99001-0001', '1988-03-15', 'F', 'Particular'),
  ('João Oliveira',  'joao@email.com',    '(11) 99001-0002', '1975-07-22', 'M', 'Unimed'),
  ('Ana Lima',       'ana@email.com',     '(11) 99001-0003', '1995-11-05', 'F', 'Particular'),
  ('Ricardo Costa',  'ricardo@email.com', '(11) 99001-0004', '1980-01-30', 'M', 'Bradesco Saúde'),
  ('Paula Ferreira', 'paula@email.com',   '(11) 99001-0005', '1990-08-18', 'F', 'Particular')
on conflict do nothing;

insert into public.inventory_items (name, code, category, quantity, min_quantity) values
  ('Dipirona 500mg',   'MED-001', 'medicamento',    48,  10),
  ('Luvas P (cx 100)', 'EPI-002', 'epi',             5,  20),
  ('Álcool 70% 1L',    'HIG-003', 'higiene',        24,   8),
  ('Seringa 5ml',      'MED-004', 'material_medico',120, 50),
  ('Gaze estéril',     'MED-005', 'material_medico',  8, 30)
on conflict (code) do nothing;
