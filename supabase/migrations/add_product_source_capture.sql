-- =============================================================================
-- Phase 17.7: User-side product image capture (bookmarklet).
-- Chạy trong Supabase SQL Editor. AN TOÀN.
-- =============================================================================

alter table products add column if not exists source_product_images jsonb default '[]'::jsonb;
alter table products add column if not exists source_capture_status text default 'PENDING';
alter table products add column if not exists source_capture_method text;
alter table products add column if not exists source_capture_note text;
alter table products add column if not exists source_captured_at timestamptz;

alter table products drop constraint if exists products_source_capture_status_check;
alter table products
  add constraint products_source_capture_status_check
  check (source_capture_status in ('PENDING', 'CAPTURED', 'FAILED'));
