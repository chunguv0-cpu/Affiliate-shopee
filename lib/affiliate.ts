import type { LinkStatus } from "@/lib/types";

/**
 * Helper quản lý link affiliate (Phase 11) — thuần, dùng được cả client & server.
 */

/** Kiểm tra link có phải affiliate Shopee hợp lệ (s.shopee.vn / shope.ee). */
export function isShopeeAffiliateLink(url: string): boolean {
  return /(?:s\.shopee\.vn|shope\.ee)/i.test(url);
}

/**
 * Suy ra link_status từ affiliate_link theo quy tắc:
 * - rỗng              -> NEED_CONVERT
 * - không http(s)     -> INVALID
 * - chứa domain affiliate Shopee -> READY
 * - còn lại           -> INVALID
 */
export function deriveLinkStatus(affiliateLink: string | null | undefined): LinkStatus {
  const link = affiliateLink?.trim();
  if (!link) return "NEED_CONVERT";
  if (!/^https?:\/\//i.test(link)) return "INVALID";
  if (isShopeeAffiliateLink(link)) return "READY";
  return "INVALID";
}

/** Chuyển tên sản phẩm thành slug (bỏ dấu tiếng Việt). */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // bỏ dấu thanh (combining marks)
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // ký tự khác -> gạch ngang
    .replace(/^-+|-+$/g, "") // bỏ gạch đầu/cuối
    .slice(0, 40) || "sp";
}

/** Định dạng ngày yyyyMMdd theo giờ Việt Nam (ICT +07:00). */
function yyyymmddICT(): string {
  const ict = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const y = ict.getUTCFullYear();
  const m = String(ict.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ict.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** Sinh sub_id mặc định: fb_page_{slug}_{yyyyMMdd}. */
export function generateSubId(productName: string): string {
  return `fb_page_${slugify(productName)}_${yyyymmddICT()}`;
}
