-- =============================================================================
-- Phase 20.1 — Autopilot cron automation fields + manual fallback statuses.
-- Non-destructive: only adds nullable/default columns and widens status checks.
-- =============================================================================

alter table ai_campaign_runs add column if not exists is_autopilot_enabled boolean not null default true;
alter table ai_campaign_runs add column if not exists auto_started_at timestamptz;
alter table ai_campaign_runs add column if not exists last_auto_run_at timestamptz;
alter table ai_campaign_runs add column if not exists next_auto_run_at timestamptz;
alter table ai_campaign_runs add column if not exists automation_error text;
alter table ai_campaign_runs add column if not exists automation_attempts integer not null default 0;

create index if not exists idx_ai_campaign_runs_autopilot_enabled
  on ai_campaign_runs (is_autopilot_enabled, status, next_auto_run_at);

alter table sourcing_candidates drop constraint if exists sourcing_candidates_status_check;
alter table sourcing_candidates
  add constraint sourcing_candidates_status_check
  check (status in (
    'NEW',
    'NEEDS_LINK',
    'SOURCING',
    'PROVIDER_MISSING',
    'LINK_CONVERSION_FAILED',
    'MANUAL_REQUIRED',
    'LINK_READY',
    'IMPORTED',
    'REJECTED'
  ));

alter table post_creative_assets add column if not exists ai_campaign_run_id uuid references ai_campaign_runs (id) on delete set null;
create index if not exists idx_pca_campaign_run on post_creative_assets (ai_campaign_run_id);
