-- DropEC / Supabase B ONLY. Prelaunch: shipping pipeline deliberately OFF.
-- Readiness/heartbeat gates prevent new orphaned shipping-quote jobs.
-- Do NOT run on Supabase A (also hosts NOSTALTV). No cron or external call here.
create table if not exists dropec_private.shipping_pipeline_control (
  singleton boolean primary key default true check (singleton),
  worker_enabled boolean not null default false,
  worker_heartbeat_at timestamptz,
  provider_bridge_verified_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into dropec_private.shipping_pipeline_control(singleton,worker_enabled)
values (true,false) on conflict (singleton) do nothing;
alter table dropec_private.shipping_pipeline_control enable row level security;
revoke all on dropec_private.shipping_pipeline_control from public, anon, authenticated;
-- Future enablement requires a separately tested B worker, fresh catalog,
-- verified WooCommerce signature, authorized operations and operator consent.
