-- DropEC B staging ONLY: universal Premium references and non-destructive renders.
begin;
alter table public.dropec_premium_previews
 add column if not exists reference_mode text not null default 'legacy_overlay';
alter table public.dropec_premium_previews
 drop constraint if exists dropec_premium_previews_reference_mode_check;
alter table public.dropec_premium_previews
 add constraint dropec_premium_previews_reference_mode_check
 check (reference_mode in (
 'legacy_overlay','catalog_reference','promotional_reference',
 'low_resolution_reference','conceptual'
 ));

create table if not exists public.dropec_premium_preview_versions (
 id uuid primary key default gen_random_uuid(),
 preview_id uuid not null references public.dropec_premium_previews(id) on delete cascade,
 poster_path text not null,
 reference_mode text not null,
 archived_at timestamptz not null default now(),
 unique(preview_id,poster_path)
);
create index if not exists dropec_premium_preview_versions_lookup_idx
 on public.dropec_premium_preview_versions(preview_id,archived_at desc);
alter table public.dropec_premium_preview_versions enable row level security;
revoke all on public.dropec_premium_preview_versions from anon,authenticated;
grant select on public.dropec_premium_preview_versions to authenticated;
drop policy if exists dropec_premium_preview_versions_owner_select on public.dropec_premium_preview_versions;
create policy dropec_premium_preview_versions_owner_select
 on public.dropec_premium_preview_versions for select to authenticated
 using ((select auth.jwt()->>'email')='3diaz2000@gmail.com');
commit;