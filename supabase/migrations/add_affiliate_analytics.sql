-- =============================================================================
-- Migration: Analytics báo cáo Affiliate (Phase 12)
-- Chạy trong Supabase SQL Editor. AN TOÀN: không xóa dữ liệu.
-- =============================================================================

create extension if not exists "pgcrypto";

create table if not exists affiliate_reports (
  id             uuid primary key default gen_random_uuid(),
  report_date    date,
  sub_id         text,
  affiliate_link text,
  product_name   text,
  clicks         int default 0,
  orders         int default 0,
  commission     numeric default 0,
  revenue        numeric default 0,
  status         text,
  raw_row        jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists idx_affiliate_reports_sub_id        on affiliate_reports (sub_id);
create index if not exists idx_affiliate_reports_affiliate_link on affiliate_reports (affiliate_link);
create index if not exists idx_affiliate_reports_report_date    on affiliate_reports (report_date);
create index if not exists idx_affiliate_reports_created_at      on affiliate_reports (created_at desc);
