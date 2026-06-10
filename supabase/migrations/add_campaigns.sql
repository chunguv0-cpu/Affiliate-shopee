-- =============================================================================
-- Migration: thêm bảng campaigns + cột campaign_id cho generated_posts (Phase 10)
-- Chạy trong Supabase SQL Editor. AN TOÀN: không xóa dữ liệu cũ.
-- =============================================================================

create extension if not exists "pgcrypto";

-- 1) Bảng campaigns
create table if not exists campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  status      text not null default 'DRAFT',
  start_at    timestamptz,
  end_at      timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint campaigns_status_check
    check (status in ('DRAFT', 'ACTIVE', 'COMPLETED', 'PAUSED'))
);

create index if not exists idx_campaigns_status     on campaigns (status);
create index if not exists idx_campaigns_created_at  on campaigns (created_at desc);

-- Trigger updated_at (dùng lại function update_updated_at_column đã có).
drop trigger if exists trg_campaigns_updated_at on campaigns;
create trigger trg_campaigns_updated_at
  before update on campaigns
  for each row
  execute function update_updated_at_column();

-- 2) Thêm cột campaign_id vào generated_posts (set null khi xóa campaign).
alter table generated_posts
  add column if not exists campaign_id uuid references campaigns (id) on delete set null;

create index if not exists idx_generated_posts_campaign_id on generated_posts (campaign_id);
