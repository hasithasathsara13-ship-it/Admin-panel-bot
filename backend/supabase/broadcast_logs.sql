-- ==========================================
-- Broadcast Logs: Track bulk message sends
-- ==========================================

create table if not exists public.broadcast_logs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.businesses(id) on delete cascade,
  template_name text,
  custom_text text,
  recipients_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_broadcast_logs_shop_id on public.broadcast_logs(shop_id);

-- Service role bypasses RLS, so no policies needed for server-side logging.
alter table public.broadcast_logs enable row level security;

create policy "Users can view own broadcast logs"
  on public.broadcast_logs for select
  using (
    shop_id in (
      select id from public.businesses where owner_user_id = auth.uid()
    )
  );
