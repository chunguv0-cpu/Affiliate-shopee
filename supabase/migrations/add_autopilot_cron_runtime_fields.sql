-- =============================================================================
-- Critical repair: real cron runtime tracking for AI Autopilot.
-- Non-destructive: add fields used to prove cron actually called the endpoint.
-- =============================================================================

alter table ai_campaign_runs add column if not exists last_cron_hit_at timestamptz;
alter table ai_campaign_runs add column if not exists last_cron_result jsonb default '{}'::jsonb;
alter table ai_campaign_runs add column if not exists cron_run_count integer not null default 0;

create index if not exists idx_ai_campaign_runs_last_cron_hit on ai_campaign_runs (last_cron_hit_at desc);
