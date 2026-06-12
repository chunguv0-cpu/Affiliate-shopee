-- =============================================================================
-- Performance + Ops phase — campaign/job locking, idempotency, creative cache.
-- NON-DESTRUCTIVE: only adds columns/tables. Run in Supabase SQL Editor.
-- =============================================================================

-- 1) Campaign-level lock (fair parallel cron, no overlapping processing).
alter table ai_campaign_runs add column if not exists locked_at timestamptz;
alter table ai_campaign_runs add column if not exists locked_by text;
alter table ai_campaign_runs add column if not exists lock_expires_at timestamptz;
create index if not exists idx_ai_campaign_runs_lock on ai_campaign_runs (lock_expires_at);

-- 2) AI job lock + idempotency (no duplicate image generation).
alter table ai_jobs add column if not exists locked_by text;
alter table ai_jobs add column if not exists lock_expires_at timestamptz;
alter table ai_jobs add column if not exists idempotency_key text;
create index if not exists idx_ai_jobs_lock on ai_jobs (lock_expires_at);

-- 3) Creative image cache by prompt_hash (skip V98 when a compatible image exists).
create table if not exists creative_asset_cache (
  id                     uuid primary key default gen_random_uuid(),
  prompt_hash            text not null,
  image_url              text not null,
  provider               text,
  model                  text,
  product_id             uuid,
  visual_reference_hash  text,
  creative_template      text,
  slot_type              text,
  created_at             timestamptz not null default now(),
  last_used_at           timestamptz,
  use_count              integer not null default 0
);
create index if not exists idx_creative_cache_prompt_hash on creative_asset_cache (prompt_hash);
create index if not exists idx_creative_cache_product on creative_asset_cache (product_id);
