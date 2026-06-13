-- =============================================================================
-- HOTFIX: Product-link validation + image API usage log.
-- Chạy trong Supabase SQL Editor. AN TOÀN — chỉ ADD COLUMN / CREATE TABLE IF NOT EXISTS.
-- KHÔNG xóa dữ liệu, KHÔNG phá sản phẩm/bài cũ.
--
-- Mục tiêu:
--  1) Phân biệt "link ok" với "sản phẩm còn sống" -> không đánh dấu Sẵn sàng cho SP chết.
--  2) Ghi log mỗi lần gọi API ảnh (V98 Image Key) để biết có bị gọi sai chỗ không.
-- =============================================================================

-- 1) Cột life-state + validation cho products (KHÔNG đụng link_status cũ).
alter table products add column if not exists product_status text not null default 'UNKNOWN';
alter table products add column if not exists validation_status text;     -- VALID | DEAD | UNVERIFIED | VALIDATION_FAILED | MISSING_IMAGE
alter table products add column if not exists validation_error text;
alter table products add column if not exists last_validated_at timestamptz;
alter table products add column if not exists resolved_url text;
alter table products add column if not exists shop_id text;
alter table products add column if not exists item_id text;

-- product_status hợp lệ: ACTIVE còn sống, còn lại là các trạng thái chết/không xác định.
alter table products drop constraint if exists products_product_status_check;
alter table products
  add constraint products_product_status_check
  check (product_status in (
    'ACTIVE', 'DELETED', 'NOT_FOUND', 'UNAVAILABLE', 'REGION_BLOCKED', 'INVALID_URL', 'UNKNOWN'
  ));

create index if not exists idx_products_product_status on products (product_status);

-- 2) Bảng log usage API ảnh (KHÔNG bao giờ lưu API key/secret/cookie).
create table if not exists api_usage_logs (
  id uuid primary key default gen_random_uuid(),
  provider text,            -- vd v98_image, openai, grok_gateway, mock
  model text,
  key_type text,            -- vd image | prompt
  call_type text,           -- vd image_generation | image_generation_blocked
  endpoint text,
  context jsonb default '{}'::jsonb,  -- { source, job_type, job_step } — KHÔNG chứa secret
  success boolean default false,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_api_usage_logs_created_at on api_usage_logs (created_at desc);
create index if not exists idx_api_usage_logs_call_type on api_usage_logs (call_type);
create index if not exists idx_api_usage_logs_provider on api_usage_logs (provider);
