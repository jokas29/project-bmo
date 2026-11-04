-- DropEC Creative Studio: staging-only cloud composer schema.
-- Applied in Supabase B (ubxkqbnzdtgfvphwohzm), NOT in commercial production.
-- Preserve approved/uploads; never reset existing private media.
begin;
alter table public.dropec_creative_slides
  add column if not exists render_attempts integer not null default 0,
  add column if not exists render_after timestamptz,
  add column if not exists render_error text,
  add column if not exists render_started_at timestamptz;
alter table public.dropec_creative_slides
  drop constraint if exists dropec_creative_slides_status_check;
alter table public.dropec_creative_slides
  add constraint dropec_creative_slides_status_check
  check (status = any(array['pending','rendering','uploaded','approved','rejected','error']));
create index if not exists dropec_creative_slides_render_queue_idx
  on public.dropec_creative_slides(status,render_after,slide_number)
  where status in ('pending','rendering');

alter table public.dropec_creative_jobs
  add column if not exists caption_draft text,
  add column if not exists hashtags text[] not null default array[]::text[],
  add column if not exists caption_reviewed boolean not null default false;

create table if not exists public.dropec_creative_automation_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  max_jobs_per_day integer not null default 3 check(max_jobs_per_day between 1 and 12),
  updated_at timestamptz not null default now()
);
alter table public.dropec_creative_automation_settings enable row level security;
drop policy if exists dropec_creative_automation_owner_read on public.dropec_creative_automation_settings;
create policy dropec_creative_automation_owner_read on public.dropec_creative_automation_settings
  for select to authenticated using ((select auth.jwt()->>'email')='3diaz2000@gmail.com');
drop policy if exists dropec_creative_automation_owner_edit on public.dropec_creative_automation_settings;
create policy dropec_creative_automation_owner_edit on public.dropec_creative_automation_settings
  for update to authenticated
  using ((select auth.jwt()->>'email')='3diaz2000@gmail.com')
  with check ((select auth.jwt()->>'email')='3diaz2000@gmail.com');
grant select,update on public.dropec_creative_automation_settings to authenticated;
insert into public.dropec_creative_automation_settings(singleton,enabled,max_jobs_per_day)
values(true,true,3) on conflict(singleton) do nothing;
create table if not exists public.dropec_creative_slide_versions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.dropec_creative_jobs(id) on delete cascade,
  slide_number smallint not null check(slide_number between 1 and 4),
  image_path text not null,
  previous_status text,
  review_notes text,
  archived_at timestamptz not null default now(),
  unique(job_id,slide_number,image_path)
);
create index if not exists dropec_creative_slide_versions_job_idx
 on public.dropec_creative_slide_versions(job_id,archived_at desc);
alter table public.dropec_creative_slide_versions enable row level security;
drop policy if exists dropec_creative_slide_versions_owner_read on public.dropec_creative_slide_versions;
create policy dropec_creative_slide_versions_owner_read
 on public.dropec_creative_slide_versions for select to authenticated
 using ((select auth.jwt()->>'email')='3diaz2000@gmail.com');
grant select on public.dropec_creative_slide_versions to authenticated;
commit;
