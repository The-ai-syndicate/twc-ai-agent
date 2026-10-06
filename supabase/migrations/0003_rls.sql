-- ============================================================================
-- TWC AI Assistant - 0003 Row Level Security
-- Model: the browser holds a Supabase Auth JWT for a verified client. We map
-- that auth user to a clients row via a `client_id` claim stored in app_metadata
-- (set server-side after OTP). Personal tables are readable only by the owner.
-- Reference tables are public-read (no personal data), write = service_role only.
--
-- IMPORTANT: server API routes use the service_role key and therefore BYPASS RLS.
-- Application-level authorization (tool executor) is the primary control; RLS is
-- defence in depth for any direct-from-browser access.
-- ============================================================================

-- Helper: the client_id bound to the current Supabase Auth user.
create or replace function current_client_id()
returns uuid language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'client_id', '')::uuid;
$$;

create or replace function is_staff()
returns boolean language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin','nurse','viewer'), false);
$$;

-- Enable RLS everywhere
alter table sites enable row level security;
alter table services enable row level security;
alter table site_services enable row level security;
alter table availability_slots enable row level security;
alter table clients enable row level security;
alter table appointments enable row level security;
alter table referrals enable row level security;
alter table reminders enable row level security;
alter table notices enable row level security;
alter table outreach_events enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table escalations enable row level security;
alter table documents enable row level security;
alter table kb_sources enable row level security;
alter table audit_log enable row level security;
alter table chat_sessions enable row level security;
alter table otp_requests enable row level security;
alter table consent_records enable row level security;
alter table analytics_events enable row level security;
alter table feedback enable row level security;

-- ---------------------------------------------------------------------------
-- Public reference tables: read for anon, write for staff/service_role only
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sites','services','site_services','availability_slots','notices','outreach_events','kb_sources']
  loop
    execute format('drop policy if exists %I_public_read on %I', t, t);
    execute format('create policy %I_public_read on %I for select using (true)', t, t);
    execute format('drop policy if exists %I_staff_write on %I', t, t);
    execute format($f$create policy %I_staff_write on %I for all using (is_staff()) with check (is_staff())$f$, t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- clients: a client reads/updates only their own row; staff read all
-- ---------------------------------------------------------------------------
drop policy if exists clients_self on clients;
create policy clients_self on clients for select using (id = current_client_id());
drop policy if exists clients_self_update on clients;
create policy clients_self_update on clients for update using (id = current_client_id()) with check (id = current_client_id());
drop policy if exists clients_staff on clients;
create policy clients_staff on clients for select using (is_staff());

-- ---------------------------------------------------------------------------
-- Personal tables: owner-only + staff read
-- ---------------------------------------------------------------------------
drop policy if exists appt_self on appointments;
create policy appt_self on appointments for select using (client_id = current_client_id());
drop policy if exists appt_staff on appointments;
create policy appt_staff on appointments for select using (is_staff());

drop policy if exists ref_self on referrals;
create policy ref_self on referrals for select using (client_id = current_client_id());
drop policy if exists ref_staff on referrals;
create policy ref_staff on referrals for select using (is_staff());

drop policy if exists rem_self on reminders;
create policy rem_self on reminders for select using (client_id = current_client_id());
drop policy if exists rem_staff on reminders;
create policy rem_staff on reminders for select using (is_staff());

drop policy if exists conv_self on conversations;
create policy conv_self on conversations for select using (client_id = current_client_id());
drop policy if exists conv_staff on conversations;
create policy conv_staff on conversations for select using (is_staff());

drop policy if exists msg_self on messages;
create policy msg_self on messages for select using (
  exists (select 1 from conversations c where c.id = messages.conversation_id and c.client_id = current_client_id())
);
drop policy if exists msg_staff on messages;
create policy msg_staff on messages for select using (is_staff());

drop policy if exists doc_self on documents;
create policy doc_self on documents for select using (client_id = current_client_id());
drop policy if exists doc_staff on documents;
create policy doc_staff on documents for select using (is_staff());

drop policy if exists consent_self on consent_records;
create policy consent_self on consent_records for select using (client_id = current_client_id());
drop policy if exists consent_staff on consent_records;
create policy consent_staff on consent_records for select using (is_staff());

-- ---------------------------------------------------------------------------
-- escalations: staff only (clients see their own via conversation)
-- ---------------------------------------------------------------------------
drop policy if exists esc_staff on escalations;
create policy esc_staff on escalations for all using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- audit_log / otp_requests / chat_sessions / analytics: staff read, no client
-- ---------------------------------------------------------------------------
drop policy if exists audit_staff on audit_log;
create policy audit_staff on audit_log for select using (is_staff());
drop policy if exists analytics_staff on analytics_events;
create policy analytics_staff on analytics_events for select using (is_staff());
drop policy if exists feedback_staff on feedback;
create policy feedback_staff on feedback for select using (is_staff());
-- chat_sessions, otp_requests: no policies => service_role only (RLS denies anon)
drop policy if exists sessions_staff on chat_sessions;
create policy sessions_staff on chat_sessions for select using (is_staff());
drop policy if exists otp_staff on otp_requests;
create policy otp_staff on otp_requests for select using (is_staff());
