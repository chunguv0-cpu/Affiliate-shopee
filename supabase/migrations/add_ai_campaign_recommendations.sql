-- =============================================================================
-- Migration: AI Weekly Campaign Recommendations (Phase 13)
-- Chạy trong Supabase SQL Editor. AN TOÀN: không xóa dữ liệu.
-- =============================================================================

create extension if not exists "pgcrypto";

create table if not exists ai_campaign_recommendations (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null,
  goal                  text,
  week_start            date,
  week_end              date,
  status                text not null default 'DRAFT',
  summary               text,
  strategy              text,
  recommended_products  jsonb default '[]'::jsonb,
  recommended_schedule  jsonb default '[]'::jsonb,
  content_angles        jsonb default '[]'::jsonb,
  engagement_hooks      jsonb default '[]'::jsonb,
  risks                 jsonb default '[]'::jsonb,
  ai_reasoning_summary  text,
  raw_ai_response       jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint ai_campaign_recommendations_status_check
    check (status in ('DRAFT', 'APPROVED', 'REJECTED', 'CONVERTED_TO_CAMPAIGN'))
);

create index if not exists idx_ai_recs_status     on ai_campaign_recommendations (status);
create index if not exists idx_ai_recs_created_at  on ai_campaign_recommendations (created_at desc);

drop trigger if exists trg_ai_recs_updated_at on ai_campaign_recommendations;
create trigger trg_ai_recs_updated_at
  before update on ai_campaign_recommendations
  for each row
  execute function update_updated_at_column();
