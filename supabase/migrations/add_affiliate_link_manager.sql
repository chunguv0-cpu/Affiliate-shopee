-- =============================================================================
-- Migration: Affiliate Link Manager (Phase 11)
-- Thêm các cột quản lý link cho products. Chạy trong Supabase SQL Editor.
-- AN TOÀN: không xóa dữ liệu.
-- =============================================================================

alter table products add column if not exists original_url text;
alter table products add column if not exists sub_id text;
alter table products add column if not exists link_status text not null default 'NEED_CONVERT';
alter table products add column if not exists link_note text;

-- affiliate_link giờ có thể rỗng (sản phẩm có thể mới chỉ có original_url).
alter table products alter column affiliate_link drop not null;

-- Back-fill link_status cho các sản phẩm cũ dựa theo affiliate_link hiện có,
-- để link Shopee hợp lệ sẵn có tự thành READY (không bị chặn tạo bài).
update products set link_status = case
  when affiliate_link is null or btrim(affiliate_link) = '' then 'NEED_CONVERT'
  when affiliate_link !~* '^https?://' then 'INVALID'
  when affiliate_link ~* '(s\.shopee\.vn|shope\.ee)' then 'READY'
  else 'INVALID'
end;

-- Check constraint cho link_status (thêm nếu chưa có).
do $$
begin
  alter table products
    add constraint products_link_status_check
    check (link_status in ('NEED_CONVERT', 'READY', 'INVALID'));
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_products_link_status on products (link_status);
