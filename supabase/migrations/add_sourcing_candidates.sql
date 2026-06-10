-- =============================================================================
-- Phase 14: Sourcing Workflow — bảng theo dõi sản phẩm AI gợi ý cần tìm link.
-- Chạy trong Supabase SQL Editor. AN TOÀN, không xóa dữ liệu.
-- =============================================================================

create table if not exists sourcing_candidates (
  id                        uuid primary key default gen_random_uuid(),
  recommendation_id         uuid references ai_campaign_recommendations (id) on delete set null,
  suggested_product         text not null,
  category                  text,
  reason                    text,
  target_customer           text,
  pain_point                text,
  suggested_search_keywords jsonb default '[]'::jsonb,
  content_angle             text,
  first_post_hook           text,
  cta                       text,
  priority                  text,
  confidence                text,
  status                    text not null default 'NEW',
  affiliate_link            text,
  sub_id                    text,
  notes                     text,
  product_id                uuid references products (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint sourcing_candidates_status_check
    check (status in ('NEW', 'SOURCING', 'LINK_READY', 'IMPORTED', 'REJECTED'))
);

create index if not exists idx_sourcing_status        on sourcing_candidates (status);
create index if not exists idx_sourcing_priority      on sourcing_candidates (priority);
create index if not exists idx_sourcing_recommendation on sourcing_candidates (recommendation_id);
create index if not exists idx_sourcing_product       on sourcing_candidates (product_id);
create index if not exists idx_sourcing_created_at    on sourcing_candidates (created_at desc);

drop trigger if exists trg_sourcing_updated_at on sourcing_candidates;
create trigger trg_sourcing_updated_at
  before update on sourcing_candidates
  for each row
  execute function update_updated_at_column();
