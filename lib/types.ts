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

// ===========================================================================
// Phase 14 — Sourcing Workflow
// ===========================================================================
export type SourcingStatus = "NEW" | "SOURCING" | "LINK_READY" | "IMPORTED" | "REJECTED";

export const SOURCING_STATUS_LABELS: Record<SourcingStatus, string> = {
  NEW: "Mới",
  SOURCING: "Đang tìm",
  LINK_READY: "Đã có link",
  IMPORTED: "Đã import",
  REJECTED: "Bỏ qua",
};

export type SourcingCandidate = {
  id: string;
  recommendation_id: string | null;
  suggested_product: string;
  category: string | null;
  reason: string | null;
  target_customer: string | null;
  pain_point: string | null;
  suggested_search_keywords: unknown;
  content_angle: string | null;
  first_post_hook: string | null;
  cta: string | null;
  priority: string | null;
  confidence: string | null;
  status: SourcingStatus;
  affiliate_link: string | null;
  sub_id: string | null;
  notes: string | null;
  product_id: string | null;
  created_at: string;
  updated_at: string;
};

// ===========================================================================
// Foundation — AI Job Queue
// ===========================================================================
export type AiJobStatus = "PENDING" | "RUNNING" | "WAITING_RETRY" | "SUCCESS" | "FAILED";

export const AI_JOB_STATUS_LABELS: Record<AiJobStatus, string> = {
  PENDING: "Chờ chạy",
  RUNNING: "Đang chạy",
  WAITING_RETRY: "Chờ thử lại",
  SUCCESS: "Hoàn tất",
  FAILED: "Thất bại",
};

export type AiJob = {
  id: string;
  job_type: string;
  status: AiJobStatus;
  step: string | null;
  progress_current: number;
  progress_total: number;
  related_product_id: string | null;
  related_post_id: string | null;
  input: unknown;
  output: unknown;
  error_message: string | null;
  attempts: number;
  max_attempts: number;
  locked_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GeneratedPostStatus =
  | "DRAFT"
  | "READY"
  | "REJECTED"
  | "PUBLISHED"
  | "FAILED"
  | "SKIPPED"
  | "PUBLISHING";

// Phase 17 — Visual Creative Automation V1.
export type CreativeType = "TEXT_ONLY" | "IMAGE" | "VIDEO";
export type CreativeStatus = "PENDING" | "READY" | "MISSING_ASSET" | "FAILED";
export type FacebookPublishType = "FEED" | "PHOTO" | "VIDEO";

export const CREATIVE_STATUS_LABELS: Record<CreativeStatus, string> = {
  PENDING: "Chưa gán",
  READY: "Sẵn ảnh",
  MISSING_ASSET: "Thiếu ảnh",
  FAILED: "Lỗi ảnh",
};

// Phase 17 V2 — multi-image creative pack.
export type CreativePackStatus =
  | "PENDING"
  | "READY"
  | "PARTIAL"
  | "FAILED"
  | "MISSING_PRODUCT_IMAGE";
export type CreativePackMode = "AUTO" | "FOUND_ONLY" | "GENERATED_ONLY" | "MIXED";
export type PublishMode = "FEED" | "PHOTO_ALBUM" | "VIDEO";
export type CreativeAssetSource = "PRODUCT" | "FOUND" | "AI_GENERATED";

export const CREATIVE_PACK_STATUS_LABELS: Record<CreativePackStatus, string> = {
  PENDING: "Chưa dựng",
  READY: "Đủ ảnh",
  PARTIAL: "Chưa đủ ảnh",
  FAILED: "Lỗi dựng ảnh",
  MISSING_PRODUCT_IMAGE: "Thiếu ảnh thật sản phẩm",
};

export type PostCreativeAsset = {
  id: string;
  generated_post_id: string;
  asset_type: string;
  source_type: CreativeAssetSource;
  image_url: string | null;
  local_path: string | null;
  prompt: string | null;
  caption_overlay: string | null;
  sort_order: number;
  status: "READY" | "FAILED";
  width: number | null;
  height: number | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

/** Asset rút gọn đính kèm vào GeneratedPost cho UI. */
export type CreativeAssetLite = {
  image_url: string | null;
  source_type: CreativeAssetSource;
  sort_order: number;
  status: string;
};

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
  // Phase 17: Visual Creative Automation V1
  creative_type?: CreativeType | null;
  creative_image_url?: string | null;
  creative_hook?: string | null;
  creative_brief?: string | null;
  creative_status?: CreativeStatus | null;
  facebook_publish_type?: FacebookPublishType | null;
  // Phase 17 V2: multi-image creative pack
  creative_pack_status?: CreativePackStatus | null;
  creative_pack_mode?: CreativePackMode | null;
  creative_min_assets?: number | null;
  publish_mode?: PublishMode | null;
  creative_summary?: string | null;
  creative_error?: string | null;
  creative_assets?: CreativeAssetLite[];
  active_job_id?: string | null;
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
  | "CONVERTED_TO_CAMPAIGN"
  | "RUNNING"
  | "FAILED";

export const RECOMMENDATION_STATUS_LABELS: Record<RecommendationStatus, string> = {
  DRAFT: "Nháp",
  APPROVED: "Đã duyệt",
  REJECTED: "Từ chối",
  CONVERTED_TO_CAMPAIGN: "Đã tạo chiến dịch",
  RUNNING: "Đang chạy",
  FAILED: "Thất bại",
};

/** Phase 13.3 — chế độ lập kế hoạch. */
export type PlannerMode = "HYBRID" | "EXISTING_ONLY" | "DISCOVERY_ONLY";

export const PLANNER_MODE_LABELS: Record<PlannerMode, string> = {
  HYBRID: "Sản phẩm có sẵn + tìm thêm sản phẩm mới",
  EXISTING_ONLY: "Chỉ tối ưu sản phẩm có sẵn",
  DISCOVERY_ONLY: "Tìm sản phẩm mới hoàn toàn",
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
  error_message?: string | null;
  job_input?: unknown;
  planner_mode?: PlannerMode | null;
  product_discovery_strategy?: unknown;
  campaign_id?: string | null;
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
