export type ProductStatus = "NEW" | "ACTIVE" | "PAUSED" | "ARCHIVED";

export type Product = {
  id: string;
  product_name: string;
  affiliate_link: string;
  price_note: string | null;
  target_customer: string | null;
  product_angle: string | null;
  image_url: string | null;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
};

/** Danh sách trạng thái sản phẩm hợp lệ (dùng để validate). */
export const PRODUCT_STATUSES: ProductStatus[] = [
  "NEW",
  "ACTIVE",
  "PAUSED",
  "ARCHIVED",
];

/** Nhãn tiếng Việt cho từng trạng thái. */
export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  NEW: "Mới",
  ACTIVE: "Đang chạy",
  PAUSED: "Tạm dừng",
  ARCHIVED: "Lưu trữ",
};

export type GeneratedPostStatus =
  | "DRAFT"
  | "READY"
  | "REJECTED"
  | "PUBLISHED"
  | "FAILED"
  | "SKIPPED"
  | "PUBLISHING";

export type GeneratedPost = {
  id: string;
  product_id: string;
  caption: string | null;
  hook: string | null;
  ai_score: number | null;
  safety_notes: string | null;
  should_publish: boolean;
  scheduled_at: string | null;
  status: GeneratedPostStatus;
  facebook_post_id: string | null;
  facebook_post_url: string | null;
  published_at: string | null;
  error_log: string | null;
  created_at: string;
  updated_at: string;
  products?: {
    product_name: string;
    affiliate_link: string;
  } | null;
};

/** Nhãn tiếng Việt cho trạng thái bài đăng AI. */
export const GENERATED_POST_STATUS_LABELS: Record<GeneratedPostStatus, string> = {
  DRAFT: "Nháp",
  READY: "Sẵn sàng",
  REJECTED: "Bị từ chối",
  PUBLISHED: "Đã đăng",
  FAILED: "Lỗi",
  SKIPPED: "Bỏ qua",
  PUBLISHING: "Đang đăng",
};

/** Một dòng nhật ký trong bảng posting_logs. */
export type PostingLog = {
  id: string;
  generated_post_id: string | null;
  action: string | null;
  status: string | null;
  message: string | null;
  raw_response: unknown;
  created_at: string;
};
