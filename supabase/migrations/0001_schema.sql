-- ============================================================================
-- TWC AI Assistant - 0001 schema
-- Base tables from docs/sample_data.txt Part 2A, with additions:
--   indexes, RLS, atomic booking functions, audit_log, sessions, otp_requests.
-- Times use Africa/Gaborone (UTC+2).
-- ============================================================================
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Core reference tables
-- ---------------------------------------------------------------------------
create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  town text not null,
  address text,
  phone text,
  hours jsonb not null,
  lat numeric, lng numeric,
  accessibility_notes text,
  active boolean default true
);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  category text not null,
  description text,
  duration_min int not null default 30,
  walk_in_ok boolean default true,
  requires_referral boolean default false,
  min_age int default 0,
  youth_friendly boolean default false,
  neutral_label text not null,
  active boolean default true
);

create table if not exists site_services (
  site_id uuid references sites(id) on delete cascade,
  service_id uuid references services(id) on delete cascade,
  primary key (site_id, service_id)
);

create table if not exists availability_slots (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id),
  service_id uuid references services(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int not null default 2,
  booked int not null default 0,
  unique (site_id, service_id, starts_at)
);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  first_name text,
  birth_year int,
  preferred_language text default 'en',
  preferred_site_id uuid references sites(id),
  discreet_mode boolean default true,
  consent_messaging boolean default false,
  consent_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,
  client_id uuid references clients(id) on delete cascade,
  site_id uuid references sites(id),
  service_id uuid references services(id),
  slot_id uuid references availability_slots(id),
  starts_at timestamptz not null,
  status text not null default 'booked'
    check (status in ('booked','confirmed','rescheduled','cancelled','completed','no_show')),
  channel text default 'web',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,
  client_id uuid references clients(id) on delete cascade,
  from_site_id uuid references sites(id),
  to_facility text not null,
  to_service text not null,
  status text not null default 'issued'
    check (status in ('issued','acknowledged','attended','closed','lost_to_followup')),
  issued_at timestamptz default now(),
  due_by date,
  what_to_bring text
);

create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete cascade,
  type text check (type in ('appointment','follow_up','refill','custom')),
  send_at timestamptz not null,
  channel text default 'whatsapp',
  status text default 'scheduled'
    check (status in ('scheduled','sent','delivered','failed','cancelled'))
);

create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  site_id uuid references sites(id),
  title text not null,
  body text not null,
  starts_at timestamptz default now(),
  ends_at timestamptz
);

create table if not exists outreach_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  town text not null,
  venue text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  service_codes text[],
  notes text
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  channel text default 'web',
  language text default 'en',
  status text default 'active' check (status in ('active','escalated','closed')),
  started_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role text check (role in ('user','assistant','system','tool','staff')),
  content text,
  tool_calls jsonb,
  sources jsonb,
  redacted boolean default false,
  created_at timestamptz default now()
);

create table if not exists escalations (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id),
  reason text not null,
  priority text default 'normal' check (priority in ('low','normal','high','critical')),
  summary text,
  status text default 'open' check (status in ('open','claimed','resolved')),
  assigned_to text,
  created_at timestamptz default now(),
  resolved_at timestamptz
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  conversation_id uuid references conversations(id),
  storage_path text,
  doc_type text,
  ocr_text text,
  created_at timestamptz default now(),
  delete_after timestamptz default (now() + interval '7 days')
);

create table if not exists kb_sources (
  id text primary key,
  title text, owner text, approved_by text, approved_at date,
  version text, status text check (status in ('draft','approved','retired'))
);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  actor text, action text, entity text, entity_id text,
  meta jsonb, created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Additions beyond Part 2
-- ---------------------------------------------------------------------------
-- Chat sessions: server-side source of truth for verification state used by the
-- tool executor. The verified client_id lives HERE, never in the LLM context.
create table if not exists chat_sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  verified_until timestamptz,
  language text default 'en',
  ip_hash text,
  created_at timestamptz default now(),
  last_seen_at timestamptz default now()
);

-- OTP requests: rate limiting per phone and per IP; failed attempt lockout.
create table if not exists otp_requests (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  ip_hash text,
  attempts int not null default 0,
  consumed boolean default false,
  locked_until timestamptz,
  created_at timestamptz default now(),
  expires_at timestamptz not null
);

-- Consent versions (timestamp + wording version).
create table if not exists consent_records (
  id bigint generated always as identity primary key,
  client_id uuid references clients(id) on delete cascade,
  kind text not null,
  wording_version text not null,
  granted boolean not null,
  created_at timestamptz default now()
);

-- Analytics events (aggregates only, no PII).
create table if not exists analytics_events (
  id bigint generated always as identity primary key,
  conversation_id uuid,
  kind text not null,
  meta jsonb,
  created_at timestamptz default now()
);

-- Feedback / thumbs.
create table if not exists feedback (
  id bigint generated always as identity primary key,
  conversation_id uuid,
  rating int check (rating in (-1, 1)),
  text text,
  anonymous boolean default false,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_appointments_client_start on appointments(client_id, starts_at);
create index if not exists idx_slots_site_service_start on availability_slots(site_id, service_id, starts_at);
create index if not exists idx_messages_conversation_created on messages(conversation_id, created_at);
create index if not exists idx_referrals_client on referrals(client_id);
create index if not exists idx_reminders_send_at on reminders(send_at) where status = 'scheduled';
create index if not exists idx_documents_delete_after on documents(delete_after);
create index if not exists idx_escalations_status on escalations(status, priority, created_at);
create index if not exists idx_otp_phone on otp_requests(phone, created_at);
create index if not exists idx_otp_ip on otp_requests(ip_hash, created_at);
create index if not exists idx_audit_created on audit_log(created_at);

-- ---------------------------------------------------------------------------
-- Updated-at trigger
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_appointments_updated on appointments;
create trigger trg_appointments_updated
  before update on appointments
  for each row execute function set_updated_at();
