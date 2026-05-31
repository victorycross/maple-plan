-- Maple Plan — Supabase schema snapshot (as of 2026-05-31)
-- Project: zydizhncvgyzewondmzr (ca-central-1)
--
-- This is a consolidated view of all tables, RLS policies, and storage
-- buckets currently in production. Apply against a fresh Supabase project
-- to recreate the schema. For incremental changes, use Supabase migrations.

-- ===== households =====
create table public.households (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  name text,
  province text default 'Ontario',
  has_spouse boolean default false,
  retirement_age int default 65,
  end_age int default 95,
  return_rate numeric default 0.06,
  inflation numeric default 0.025,
  monthly_expenses numeric default 5000,                       -- legacy single-field
  monthly_expenses_essential numeric default 0,
  monthly_expenses_discretionary numeric default 0,
  monthly_expenses_work_related numeric default 0,
  retirement_lifestyle_factor numeric default 0.80,
  emergency_fund numeric default 0,
  home_value numeric default 0,
  mortgage_balance numeric default 0,                          -- legacy single-field
  other_debt numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ===== persons =====
create table public.persons (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  role text not null check (role in ('primary','spouse')),
  first_name text,
  age int default 55,
  years_in_canada int default 35,
  income numeric default 0,
  cpp_pct_of_max numeric default 0.85,
  cpp_start_age int default 65,
  oas_start_age int default 65,
  other_pension_annual numeric default 0,
  created_at timestamptz default now(),
  unique (household_id, role)
);

-- ===== accounts =====
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id) on delete cascade,
  type text not null check (type in (
    'RRSP_1','RRSP_2','SPOUSAL_RRSP','TFSA','FHSA','DPSP','DCPP','NON_REG','RESP','LIRA','LIF','RRIF'
  )),
  label text,
  institution text,
  balance numeric default 0,
  annual_contribution numeric default 0,
  notes text,
  created_at timestamptz default now()
);
create index idx_accounts_person on public.accounts(person_id);

-- ===== mortgages =====
create table public.mortgages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  label text default 'Primary mortgage',
  property_type text default 'primary_residence'
    check (property_type in ('primary_residence','rental','second_home','other')),
  account_number text,
  institution text,
  initial_balance numeric default 0,
  current_balance numeric default 0,
  rate numeric default 0,
  rate_type text default 'variable' check (rate_type in ('fixed','variable')),
  term_years int default 5,
  amortization_years int default 25,
  payment_frequency text default 'monthly'
    check (payment_frequency in ('monthly','semi-monthly','bi-weekly','bi-weekly-accelerated','weekly','weekly-accelerated')),
  payment_amount numeric default 0,
  payments_remaining int default 0,
  next_payment_date date,
  maturity_date date,
  start_date date,
  amortization_end_date date,
  prepayment_lump_pct numeric default 0.15,
  prepayment_increase_pct numeric default 0.15,
  double_payment_allowed boolean default true,
  cashback_received numeric default 0,
  notes text,
  created_at timestamptz default now()
);
create index idx_mortgages_household on public.mortgages(household_id);

-- ===== estate_checklist =====
create table public.estate_checklist (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  item_key text not null,
  is_complete boolean default false,
  completed_date date,
  notes text,
  unique (household_id, item_key)
);

-- ===== documents =====
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  category text not null,
  filename text not null,
  storage_path text not null,
  size_bytes bigint,
  mime_type text,
  description text,
  uploaded_at timestamptz default now()
);
create index idx_documents_household on public.documents(household_id);

-- ===== transactions =====
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  import_run_id uuid,
  date date not null,
  merchant text,
  category text,
  account_label text,
  account_mask text,
  original_statement text,
  notes text,
  amount numeric not null,                  -- signed: negative=outflow, positive=inflow
  tags text[],
  owner text,
  is_transfer boolean default false,
  source text default 'monarch',
  imported_at timestamptz default now()
);
create index idx_transactions_household_date on public.transactions(household_id, date desc);
create index idx_transactions_category on public.transactions(household_id, category);

-- ===== import_runs =====
create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  filename text,
  source text default 'monarch',
  rows_imported int default 0,
  rows_skipped int default 0,
  date_range_start date,
  date_range_end date,
  errors jsonb,
  created_at timestamptz default now()
);
create index idx_import_runs_household on public.import_runs(household_id, created_at desc);

-- ===== category_mappings (table exists; UI not yet built) =====
create table public.category_mappings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  category text not null,
  bucket text check (bucket in ('essential','discretionary','work_related','exclude','income')),
  updated_at timestamptz default now(),
  unique (household_id, category)
);

-- ===== Row-Level Security =====
alter table public.households enable row level security;
alter table public.persons enable row level security;
alter table public.accounts enable row level security;
alter table public.mortgages enable row level security;
alter table public.estate_checklist enable row level security;
alter table public.documents enable row level security;
alter table public.transactions enable row level security;
alter table public.import_runs enable row level security;
alter table public.category_mappings enable row level security;

create policy "own household"   on public.households for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own persons"     on public.persons for all
  using (exists (select 1 from public.households h where h.id = household_id and h.user_id = auth.uid()))
  with check (exists (select 1 from public.households h where h.id = household_id and h.user_id = auth.uid()));
create policy "own accounts"    on public.accounts for all
  using (exists (select 1 from public.persons p join public.households h on p.household_id = h.id where p.id = person_id and h.user_id = auth.uid()))
  with check (exists (select 1 from public.persons p join public.households h on p.household_id = h.id where p.id = person_id and h.user_id = auth.uid()));
create policy "own mortgages"   on public.mortgages for all
  using (exists (select 1 from public.households h where h.id = household_id and h.user_id = auth.uid()))
  with check (exists (select 1 from public.households h where h.id = household_id and h.user_id = auth.uid()));
create policy "own estate"      on public.estate_checklist for all
  using (exists (select 1 from public.households h where h.id = household_id and h.user_id = auth.uid()))
  with check (exists (select 1 from public.households h where h.id = household_id and h.user_id = auth.uid()));
create policy "own documents"   on public.documents for all
  using (exists (select 1 from public.households h where h.id = household_id and h.user_id = auth.uid()))
  with check (exists (select 1 from public.households h where h.id = household_id and h.user_id = auth.uid()));
create policy "own transactions" on public.transactions for all
  using (exists (select 1 from public.households h where h.id = household_id and h.user_id = auth.uid()))
  with check (exists (select 1 from public.households h where h.id = household_id and h.user_id = auth.uid()));
create policy "own import_runs" on public.import_runs for all
  using (exists (select 1 from public.households h where h.id = household_id and h.user_id = auth.uid()))
  with check (exists (select 1 from public.households h where h.id = household_id and h.user_id = auth.uid()));
create policy "own category_mappings" on public.category_mappings for all
  using (exists (select 1 from public.households h where h.id = household_id and h.user_id = auth.uid()))
  with check (exists (select 1 from public.households h where h.id = household_id and h.user_id = auth.uid()));

-- ===== Storage =====
insert into storage.buckets (id, name, public) values ('documents','documents', false)
  on conflict (id) do nothing;

create policy "users read own docs" on storage.objects for select to authenticated using (
  bucket_id = 'documents' and exists (
    select 1 from public.households h where h.user_id = auth.uid() and (storage.foldername(name))[1] = h.id::text
  )
);
create policy "users write own docs" on storage.objects for insert to authenticated with check (
  bucket_id = 'documents' and exists (
    select 1 from public.households h where h.user_id = auth.uid() and (storage.foldername(name))[1] = h.id::text
  )
);
create policy "users delete own docs" on storage.objects for delete to authenticated using (
  bucket_id = 'documents' and exists (
    select 1 from public.households h where h.user_id = auth.uid() and (storage.foldername(name))[1] = h.id::text
  )
);
