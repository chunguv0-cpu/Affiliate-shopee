-- =============================================================================
-- Foundation: AI Job Queue & Step Runner — chia việc AI nặng thành các bước nhỏ.
-- Chạy trong Supabase SQL Editor. AN TOÀN.
-- =============================================================================

create table if not exists ai_jobs (
  id                  uuid primary key default gen_random_uuid(),
  job_type            text not null,
  status              text not null default 'PENDING',
  step                text,
  progress_current    int not null default 0,
  progress_total      int not null default 0,
  related_product_id  uuid references products (id) on delete set null,
  related_post_id     uuid references generated_posts (id) on delete set null,
  input               jsonb default '{}'::jsonb,
  output              jsonb default '{}'::jsonb,
  error_message       text,
  attempts            int not null default 0,
  max_attempts        int not null default 3,
  locked_at           timestamptz,
  started_at          timestamptz,
  finished_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint ai_jobs_status_check
    check (status in ('PENDING', 'RUNNING', 'WAITING_RETRY', 'SUCCESS', 'FAILED'))
);

create index if not exists idx_ai_jobs_status      on ai_jobs (status);
create index if not exists idx_ai_jobs_job_type    on ai_jobs (job_type);
create index if not exists idx_ai_jobs_product     on ai_jobs (related_product_id);
create index if not exists idx_ai_jobs_post        on ai_jobs (related_post_id);
create index if not exists idx_ai_jobs_created_at  on ai_jobs (created_at desc);

drop trigger if exists trg_ai_jobs_updated_at on ai_jobs;
create trigger trg_ai_jobs_updated_at
  before update on ai_jobs
  for each row
  execute function update_updated_at_column();
