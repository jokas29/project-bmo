-- DropEC Premium Creative Pilot (Supabase B ONLY: ubxkqbnzdtgfvphwohzm).
-- Isolated AI scene previews; never modifies the four production/review slides.
-- Explicit staging-only migration; no social publisher, sales or WooCommerce writes.
begin;
create table if not exists public.dropec_premium_previews (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.dropec_creative_jobs(id) on delete cascade,
  variant smallint not null check (variant between 1 and 3),
  status text not null default 'queued'
    check (status in ('queued','processing','ready','error','needs_source')),
  prompt text not null,
  poster_path text,
  render_attempts smallint not null default 0 check (render_attempts between 0 and 5),
  render_after timestamptz,
  render_started_at timestamptz,
  render_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id,variant),
  constraint poster_ready_has_path check ((status = 'ready') = (poster_path is not null))
);
create index if not exists dropec_premium_preview_queue_idx
  on public.dropec_premium_previews(status,render_after,created_at)
  where status in ('queued','processing');

alter table public.dropec_premium_previews enable row level security;
revoke all on table public.dropec_premium_previews from anon,authenticated;
grant select on table public.dropec_premium_previews to authenticated;

drop policy if exists dropec_premium_previews_owner_read on public.dropec_premium_previews;
create policy dropec_premium_previews_owner_read
  on public.dropec_premium_previews for select to authenticated
  using (
    (select auth.jwt()->>'email')='3diaz2000@gmail.com'
  );
-- Only the authenticated Edge Function's service credential may INSERT/PATCH.
-- A SELECT policy alone does not permit a browser to queue/approve anything.
commit;