-- =============================================================================
-- Phase 17 (V2): Multi-Image Creative — pack >= 4 ảnh / bài.
-- Chạy trong Supabase SQL Editor. AN TOÀN, không phá bài cũ.
-- =============================================================================

-- A) Trường pack trên generated_posts.
alter table generated_posts add column if not exists creative_pack_status text default 'PENDING';
alter table generated_posts add column if not exists creative_pack_mode   text default 'AUTO';
alter table generated_posts add column if not exists creative_min_assets  integer default 4;
alter table generated_posts add column if not exists publish_mode         text default 'FEED';
alter table generated_posts add column if not exists creative_summary     text;
alter table generated_posts add column if not exists creative_error       text;

alter table generated_posts drop constraint if exists generated_posts_creative_pack_status_check;
alter table generated_posts
  add constraint generated_posts_creative_pack_status_check
  check (creative_pack_status in ('PENDING', 'READY', 'PARTIAL', 'FAILED'));

alter table generated_posts drop constraint if exists generated_posts_creative_pack_mode_check;
alter table generated_posts
  add constraint generated_posts_creative_pack_mode_check
  check (creative_pack_mode in ('AUTO', 'FOUND_ONLY', 'GENERATED_ONLY', 'MIXED'));

alter table generated_posts drop constraint if exists generated_posts_publish_mode_check;
alter table generated_posts
  add constraint generated_posts_publish_mode_check
  check (publish_mode in ('FEED', 'PHOTO_ALBUM', 'VIDEO'));

-- B) Bảng asset ảnh của bài.
create table if not exists post_creative_assets (
  id                uuid primary key default gen_random_uuid(),
  generated_post_id uuid not null references generated_posts (id) on delete cascade,
  asset_type        text default 'IMAGE',
  source_type       text not null,
  image_url         text,
  local_path        text,
  prompt            text,
  caption_overlay   text,
  sort_order        integer default 0,
  status            text default 'READY',
  width             integer,
  height            integer,
  metadata          jsonb default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint post_creative_assets_asset_type_check
    check (asset_type in ('IMAGE')),
  constraint post_creative_assets_source_type_check
    check (source_type in ('PRODUCT', 'FOUND', 'AI_GENERATED')),
  constraint post_creative_assets_status_check
    check (status in ('READY', 'FAILED'))
);

create index if not exists idx_pca_post        on post_creative_assets (generated_post_id);
create index if not exists idx_pca_sort_order   on post_creative_assets (sort_order);
create index if not exists idx_pca_source_type  on post_creative_assets (source_type);

drop trigger if exists trg_pca_updated_at on post_creative_assets;
create trigger trg_pca_updated_at
  before update on post_creative_assets
  for each row
  execute function update_updated_at_column();
