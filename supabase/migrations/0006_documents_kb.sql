-- 0006: reconcile schema with app code.
--   * clients: nullable phone + phone_hash + locale/demo
--   * otp_requests: align columns used by lib/auth/otp.ts
--   * documents: add mime/size/status
--   * kb_documents + kb_chunks: admin-uploaded knowledge sources (Voyage -> Pinecone)
--   * feedback.rating nullable
-- Idempotent: safe to re-run.

-- ---------- clients ----------
alter table if exists public.clients
  alter column phone drop not null;

alter table if exists public.clients
  add column if not exists phone_hash text,
  add column if not exists demo boolean not null default false;

create unique index if not exists clients_phone_hash_uidx
  on public.clients (phone_hash)
  where phone_hash is not null;

-- ---------- otp_requests ----------
alter table if exists public.otp_requests
  add column if not exists phone_hash text,
  add column if not exists code_hash text,
  add column if not exists ip_hash text,
  add column if not exists attempts int not null default 0,
  add column if not exists consumed boolean not null default false,
  add column if not exists locked_until timestamptz,
  add column if not exists expires_at timestamptz;

create index if not exists otp_requests_phone_hash_idx
  on public.otp_requests (phone_hash, created_at desc);
create index if not exists otp_requests_ip_hash_idx
  on public.otp_requests (ip_hash, created_at desc);

-- ---------- documents ----------
alter table if exists public.documents
  add column if not exists mime_type text,
  add column if not exists size_bytes bigint,
  add column if not exists status text not null default 'stored';

-- ---------- feedback ----------
alter table if exists public.feedback
  alter column rating drop not null;

-- ---------- kb_documents (admin-uploaded source files) ----------
create table if not exists public.kb_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  filename text,
  mime_type text,
  size_bytes bigint,
  source_type text not null default 'upload',   -- upload | paste
  category text,
  audience text,
  status text not null default 'draft',         -- draft | processing | indexed | failed | approved | retired
  language text not null default 'en',
  owner text,
  approver text,
  version int not null default 1,
  char_count int not null default 0,
  chunk_count int not null default 0,
  dim int,
  error text,
  indexed_at timestamptz,
  uploaded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- kb_chunks (embedded into Pinecone) ----------
create table if not exists public.kb_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.kb_documents(id) on delete cascade,
  chunk_index int not null,
  text text not null,
  lang text not null default 'en',
  category text,
  audience text,
  status text not null default 'draft',
  embedding_model text,                          -- e.g. voyage-law-2
  dim int,
  pinecone_id text,
  created_at timestamptz not null default now()
);
create index if not exists kb_chunks_document_idx
  on public.kb_chunks (document_id, chunk_index);

-- ---------- RLS ----------
alter table if exists public.kb_documents enable row level security;
alter table if exists public.kb_chunks enable row level security;

-- Public may read APPROVED KB sources (no personal data); admin writes via service role.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='kb_documents' and policyname='kb_documents_public_read'
  ) then
    create policy kb_documents_public_read on public.kb_documents
      for select using (status = 'approved');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='kb_chunks' and policyname='kb_chunks_public_read'
  ) then
    create policy kb_chunks_public_read on public.kb_chunks
      for select using (status = 'approved');
  end if;
end $$;
