-- =============================================================================
-- Migration: thêm trạng thái 'PUBLISHING' cho generated_posts.status
-- Chạy trong Supabase SQL Editor.
-- AN TOÀN: không xóa dữ liệu, không ảnh hưởng bảng khác.
-- =============================================================================

-- 1) Xóa check constraint cũ trên cột status (dù tên là gì) bằng DO block.
do $$
declare
  c_name text;
begin
  select con.conname
    into c_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'generated_posts'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%status%'
  limit 1;

  if c_name is not null then
    execute format(
      'alter table public.generated_posts drop constraint %I',
      c_name
    );
  end if;
end $$;

-- 2) Tạo lại check constraint mới có thêm 'PUBLISHING'.
alter table public.generated_posts
  add constraint generated_posts_status_check
  check (
    status in (
      'DRAFT',
      'READY',
      'REJECTED',
      'PUBLISHED',
      'FAILED',
      'SKIPPED',
      'PUBLISHING'
    )
  );
