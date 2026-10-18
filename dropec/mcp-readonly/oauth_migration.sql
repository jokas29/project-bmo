-- DropEC, Supabase B ONLY. OAuth is OFF until separately authorized.
-- Do not apply this migration on Supabase A (also hosts NOSTALTV).
create table if not exists dropec_private.dropi_mcp_oauth_settings (
  singleton boolean primary key default true check (singleton),
  setup_enabled boolean not null default false,
  pinned_issuer_approved boolean not null default false,
  session_replacement_ack boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into dropec_private.dropi_mcp_oauth_settings(singleton)
values (true) on conflict (singleton) do nothing;

create table if not exists dropec_private.dropi_mcp_oauth_pending (
  state_sha256 text primary key check (length(state_sha256)=43),
  verifier_secret_id uuid not null,
  client_id text not null check (length(client_id) between 4 and 512),
  redirect_uri text not null check (redirect_uri = 'https://ubxkqbnzdtgfvphwohzm.supabase.co/functions/v1/dropec-dropi-oauth/callback'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists dropi_mcp_oauth_pending_expires_idx
  on dropec_private.dropi_mcp_oauth_pending(expires_at);

create table if not exists dropec_private.dropi_mcp_oauth_connection (
  singleton boolean primary key default true check (singleton),
  client_id text not null,
  access_secret_id uuid not null,
  refresh_secret_id uuid not null,
  token_type text not null default 'Bearer',
  scopes text not null default 'mcp',
  access_expires_at timestamptz not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep all three internal to the trusted server-side Postgres role.
alter table dropec_private.dropi_mcp_oauth_settings enable row level security;
alter table dropec_private.dropi_mcp_oauth_pending enable row level security;
alter table dropec_private.dropi_mcp_oauth_connection enable row level security;
revoke all on dropec_private.dropi_mcp_oauth_settings from public, anon, authenticated;
revoke all on dropec_private.dropi_mcp_oauth_pending from public, anon, authenticated;
revoke all on dropec_private.dropi_mcp_oauth_connection from public, anon, authenticated;

-- Internal API key never leaves Supabase Vault.
do $$
begin
  if not exists (select 1 from vault.secrets where name='dropec_mcp_oauth_setup_key') then
    perform vault.create_secret(encode(gen_random_bytes(32),'hex'),
                                'dropec_mcp_oauth_setup_key',
                                'DropEC MCP OAuth bootstrap key: Supabase B only');
  end if;
end $$;

-- No cron. No processing loop. No external actions. Setup remains OFF.
