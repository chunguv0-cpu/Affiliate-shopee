-- Cron-safe creative worker retry metadata.
-- Non-destructive: keeps existing ai_jobs rows and existing retry behavior.

alter table ai_jobs add column if not exists next_retry_at timestamptz;
alter table ai_jobs add column if not exists last_error text;

create index if not exists idx_ai_jobs_next_retry_at on ai_jobs (next_retry_at);
