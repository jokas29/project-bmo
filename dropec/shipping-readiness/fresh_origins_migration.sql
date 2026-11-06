-- DropEC: shipping source-of-truth for selected, recently verified Dropi origins.
-- Supabase B ONLY; never copy the historical A catalog or credentials here.
-- EMPTY BY DEFAULT: no real-world warehouse may be invented or automatically accepted.
create table if not exists dropec_private.shipping_verified_origins (
  dropi_product_id bigint not null check (dropi_product_id > 0),
  warehouse_ref text not null check (char_length(warehouse_ref) between 1 and 120),
  origin_city jsonb not null,
  stock_available integer not null check (stock_available >= 0),
  observed_at timestamptz not null,
  valid_until timestamptz not null,
  verification_source text not null check (verification_source in
    ('dropi_official_mcp','dropi_official_account_verified')),
  provenance_reference text not null check (char_length(provenance_reference) between 6 and 160),
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (dropi_product_id, warehouse_ref),
  constraint shipping_origin_city_valid check (
    jsonb_typeof(origin_city) = 'object'
    and (origin_city ? 'cod_dane')
    and (origin_city->>'cod_dane') ~ '^[0-9]{6,20}$'
    and (origin_city ? 'id')
    and (origin_city->>'id') ~ '^[0-9]{1,12}$'
  ),
  constraint shipping_origin_fresh_window check (
    valid_until > observed_at and valid_until <= observed_at + interval '24 hours'
  )
);
create index if not exists shipping_verified_origins_fresh_idx
  on dropec_private.shipping_verified_origins(dropi_product_id, valid_until)
  where stock_available > 0;
alter table dropec_private.shipping_verified_origins enable row level security;
revoke all on dropec_private.shipping_verified_origins from public, anon, authenticated;
-- Deliberately no INSERT statements or ingest endpoints.
-- A future trusted ingestion path must independently confirm provider, stock,
-- city ID and city DANE, warehouse mapping and observation timestamp.
