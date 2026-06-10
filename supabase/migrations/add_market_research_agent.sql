-- =============================================================================
-- Migration: AI Market Research Agent (Phase 13.1)
-- Chạy trong Supabase SQL Editor. AN TOÀN: không xóa dữ liệu.
-- =============================================================================

create extension if not exists "pgcrypto";

create table if not exists market_research_runs (
  id              uuid primary key default gen_random_uuid(),
  goal            text,
  target_customer text,
  week_start      date,
  week_end        date,
  status          text not null default 'PENDING',
  provider        text,
  queries         jsonb default '[]'::jsonb,
  summary         text,
  insights        jsonb default '[]'::jsonb,
  raw_response    jsonb,
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint market_research_runs_status_check
    check (status in ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED'))
);

create index if not exists idx_mrr_created_at on market_research_runs (created_at desc);
create index if not exists idx_mrr_status     on market_research_runs (status);

drop trigger if exists trg_mrr_updated_at on market_research_runs;
create trigger trg_mrr_updated_at
  before update on market_research_runs
  for each row
  execute function update_updated_at_column();

create table if not exists market_research_sources (
  id               uuid primary key default gen_random_uuid(),
  research_run_id  uuid references market_research_runs (id) on delete cascade,
  query            text,
  title            text,
  url              text,
  snippet          text,
  content          text,
  source_type      text,
  relevance_score  numeric,
  created_at       timestamptz not null default now()
);

create index if not exists idx_mrs_run_id on market_research_sources (research_run_id);
create index if not exists idx_mrs_query  on market_research_sources (query);

-- Bổ sung cột cho ai_campaign_recommendations (Phase 13.1).
alter table ai_campaign_recommendations add column if not exists research_run_id uuid;
alter table ai_campaign_recommendations add column if not exists campaign_concept jsonb;
alter table ai_campaign_recommendations add column if not exists interaction_plan jsonb default '[]'::jsonb;
alter table ai_campaign_recommendations add column if not exists creative_directions jsonb default '[]'::jsonb;
alter table ai_campaign_recommendations add column if not exists market_research jsonb;
