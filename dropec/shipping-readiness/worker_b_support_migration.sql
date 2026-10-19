-- DRAFT ONLY: Supabase B (ubxkqbnzdtgfvphwohzm), never project A.
-- Not applied by this PR. No provider calls, no secrets, no activation or cron.
-- A verified official destination pin resolves ambiguous Babahoyo DANE codes.
create table if not exists dropec_private.shipping_verified_destinations (
  province text not null,
  city text not null,
  cod_dane text not null check (cod_dane ~ '^[0-9]{6,16}$'),
  observed_at timestamptz not null,
  valid_until timestamptz not null,
  verification_source text not null,
  provenance_reference text not null,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (province, city),
  check (valid_until > observed_at),
  check (valid_until <= observed_at + interval '24 hours')
);
create index if not exists shipping_verified_destinations_fresh_idx
  on dropec_private.shipping_verified_destinations(valid_until);

-- Each attempt has a random lease token hashed in the database and bound
-- to the unique GitHub Actions run ID and the checkout version at claim time.
-- A late/stolen/replayed callback cannot finalize a different claim.
create table if not exists dropec_private.shipping_worker_b_leases (
  job_id uuid primary key references dropec_private.bot_shipping_quote_jobs(id) on delete cascade,
  github_run_id text not null,
  token_sha256 text not null check (token_sha256 ~ '^[a-f0-9]{64}$'),
  attempt integer not null check (attempt > 0),
  checkout_version timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shipping_worker_b_leases_expires_idx
  on dropec_private.shipping_worker_b_leases(expires_at);

alter table dropec_private.shipping_verified_destinations enable row level security;
alter table dropec_private.shipping_worker_b_leases enable row level security;
revoke all on dropec_private.shipping_verified_destinations from public, anon, authenticated;
revoke all on dropec_private.shipping_worker_b_leases from public, anon, authenticated;
-- No rows intentionally inserted; verified destinations/origins remain empty.
