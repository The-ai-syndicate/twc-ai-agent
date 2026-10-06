-- ============================================================================
-- TWC AI Assistant - 0005 retention
-- Deletes documents past delete_after (storage objects are removed by the
-- Edge Function / scheduled job that calls this and then unlinks the object),
-- closes stale conversations, and prunes old OTP rows.
-- Scheduled via pg_cron if available; otherwise run by /api/cron/retention.
-- ============================================================================
create or replace function run_retention()
returns jsonb language plpgsql security definer as $$
declare
  v_docs int;
  v_convs int;
  v_otp int;
  v_paths text[];
begin
  -- Capture storage paths of documents due for deletion so the caller can
  -- remove the objects from the private bucket.
  select array_agg(storage_path) into v_paths
    from documents where delete_after < now() and storage_path is not null;

  delete from documents where delete_after < now();
  get diagnostics v_docs = row_count;

  -- Retention window is configurable; default 90 days handled by the app.
  update conversations set status = 'closed'
    where status = 'active' and started_at < now() - interval '90 days';
  get diagnostics v_convs = row_count;

  delete from otp_requests where created_at < now() - interval '1 day';
  get diagnostics v_otp = row_count;

  insert into audit_log (actor, action, entity, entity_id, meta)
  values ('system','retention.run','system',null,
          jsonb_build_object('documents_deleted', v_docs, 'conversations_closed', v_convs, 'otp_purged', v_otp));

  return jsonb_build_object('documents_deleted', v_docs, 'conversations_closed', v_convs, 'otp_purged', v_otp, 'storage_paths', v_paths);
end $$;

grant execute on function run_retention() to service_role;

-- Try to schedule with pg_cron (available on Supabase; harmless if absent).
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('twc-retention-daily', '15 2 * * *', 'select run_retention();');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled: %', sqlerrm;
end $cron$;
