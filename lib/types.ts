export type ProductStatus = "NEW" | "ACTIVE" | "PAUSED" | "ARCHIVED";

/** Trạng thái link affiliate (Phase 11). */
export type LinkStatus = "NEED_CONVERT" | "READY" | "INVALID";

export type Product = {
  id: string;
  product_name: string;
  original_url: string | null;
  affiliate_link: string | null;
  sub_id: string | null;
  link_status: LinkStatus;
  link_note: string | null;
  price_note: string | null;
  target_customer: string | null;
  product_angle: string | null;
  image_url: string | null;
  status: ProductStatus;
  created_at: string;
  updated_at: string;
};

/** Nhãn tiếng Việt cho trạng thái link. */
export const LINK_STATUS_LABELS: Record<LinkStatus, string> = {
  NEED_CONVERT: "Cần chuyển link",
  READY: "Sẵn sàng",
  INVALID: "Link lỗi",
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
  campaign_id: string | null;
  content_angle_variant: string | null;
  created_at: string;
  updated_at: string;
  products?: {
    product_name: string;
    affiliate_link: string;
  } | null;
  campaigns?: {
    name: string;
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

export type CampaignStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "PAUSED";

export type Campaign = {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  start_at: string | null;
  end_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Nhãn tiếng Việt cho trạng thái chiến dịch. */
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: "Nháp",
  ACTIVE: "Đang chạy",
  COMPLETED: "Hoàn tất",
  PAUSED: "Tạm dừng",
};

/** Khung giờ đăng mặc định cho chiến dịch (giờ Việt Nam, ICT +07:00). */
export const CAMPAIGN_DEFAULT_TIME_SLOTS = ["08:00", "11:30", "15:00", "20:30"];

/** Các góc viết (content angle) để 1 sản phẩm tạo nhiều bài khác nhau. */
export const CONTENT_ANGLE_VARIANTS = [
  "Deal nhanh",
  "Review thật",
  "Mua dự trữ",
  "Combo kéo traffic",
  "Story cá nhân",
];

/** Một dòng báo cáo hiệu quả affiliate (Phase 12). */
export type AffiliateReport = {
  id: string;
  report_date: string | null;
  sub_id: string | null;
  affiliate_link: string | null;
  product_name: string | null;
  clicks: number;
  orders: number;
  commission: number;
  revenue: number;
  status: string | null;
  raw_row: unknown;
  created_at: string;
};

export type RecommendationStatus =
  | "DRAFT"
  | "APPROVED"
  | "REJECTED"
  | "CONVERTED_TO_CAMPAIGN";

export const RECOMMENDATION_STATUS_LABELS: Record<RecommendationStatus, string> = {
  DRAFT: "Nháp",
  APPROVED: "Đã duyệt",
  REJECTED: "Từ chối",
  CONVERTED_TO_CAMPAIGN: "Đã tạo chiến dịch",
};

/** Một bản ghi gợi ý chiến dịch tuần do AI tạo (Phase 13). */
export type AICampaignRecommendation = {
  id: string;
  title: string;
  goal: string | null;
  week_start: string | null;
  week_end: string | null;
  status: RecommendationStatus;
  summary: string | null;
  strategy: string | null;
  recommended_products: unknown;
  recommended_schedule: unknown;
  content_angles: unknown;
  engagement_hooks: unknown;
  risks: unknown;
  ai_reasoning_summary: string | null;
  raw_ai_response: unknown;
  research_run_id: string | null;
  campaign_concept: unknown;
  interaction_plan: unknown;
  creative_directions: unknown;
  suggested_new_products: unknown;
  market_research: unknown;
  executive_summary?: string | null;
  market_diagnosis?: unknown;
  internal_data_diagnosis?: unknown;
  goal_strategy?: unknown;
  product_decision_table?: unknown;
  products_to_source?: unknown;
  weekly_execution_plan?: unknown;
  engagement_system?: unknown;
  creative_brief?: unknown;
  measurement_plan?: unknown;
  next_actions?: unknown;
  quality_warnings?: unknown;
  created_at: string;
  updated_at: string;
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
