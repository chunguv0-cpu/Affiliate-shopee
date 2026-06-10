import type { CampaignGoal } from "@/lib/ai/campaign-planner";
import type { StrategicPlan } from "@/lib/ai/strategic-planner";
import type { PlannerMode } from "@/lib/types";

/**
 * Kiểm tra chiều sâu của kế hoạch chiến lược. Trả về danh sách cảnh báo (rỗng = đạt).
 */
export function validateCampaignPlanQuality(
  plan: StrategicPlan,
  goal: CampaignGoal,
  plannerMode: PlannerMode = "HYBRID",
): string[] {
  const w: string[] = [];

  // Phase 13.3 — kiểm tra theo chế độ lập kế hoạch.
  const pds = plan.product_discovery_strategy;
  const opportunities = pds?.new_product_opportunities ?? [];
  if (plannerMode === "DISCOVERY_ONLY" && opportunities.length < 10) {
    w.push(`Chế độ DISCOVERY_ONLY nhưng chỉ có ${opportunities.length} sản phẩm mới (cần ≥ 10).`);
  }
  if (plannerMode === "HYBRID" && opportunities.length < 5) {
    w.push(`Chế độ HYBRID nhưng có ít hơn 5 sản phẩm mới nên tìm link.`);
  }
  if (opportunities.some((o) => (o.suggested_search_keywords?.length ?? 0) === 0)) {
    w.push("Có sản phẩm mới thiếu từ khóa tìm kiếm trên Shopee.");
  }
  if (plannerMode !== "EXISTING_ONLY" && (pds?.sourcing_plan?.length ?? 0) === 0) {
    w.push("Thiếu kế hoạch tìm nguồn (sourcing_plan).");
  }

  if (!plan.executive_summary || plan.executive_summary.trim().length < 120) {
    w.push("Tóm tắt chiến lược (executive_summary) quá ngắn/chung chung.");
  }
  if (!plan.market_diagnosis?.summary && (plan.market_diagnosis?.source_based_insights?.length ?? 0) === 0) {
    w.push("Thiếu chẩn đoán thị trường (market_diagnosis).");
  }
  // Bảng quyết định / lịch đăng chỉ bắt buộc khi KHÔNG phải DISCOVERY_ONLY.
  if (plannerMode !== "DISCOVERY_ONLY") {
    if ((plan.product_decision_table?.length ?? 0) === 0) {
      w.push("Thiếu bảng quyết định sản phẩm (product_decision_table).");
    }
    if ((plan.weekly_execution_plan?.length ?? 0) < 5) {
      w.push("Kế hoạch đăng có ít hơn 5 ngày.");
    }
    const posts = (plan.weekly_execution_plan ?? []).flatMap((d) => d.posts ?? []);
    if (posts.some((p) => !p.hook?.trim())) {
      w.push("Có bài đăng thiếu hook cụ thể.");
    }
    if (posts.some((p) => !p.cta?.trim())) {
      w.push("Có bài đăng thiếu CTA cụ thể.");
    }
  }
  if (plannerMode !== "EXISTING_ONLY" && (plan.products_to_source?.length ?? 0) === 0 && opportunities.length === 0) {
    w.push("Thiếu gợi ý sản phẩm nên tìm thêm (products_to_source / new_product_opportunities).");
  }
  if ((plan.product_decision_table ?? []).some((p) => !p.reason?.trim())) {
    w.push("Có sản phẩm thiếu lý do (reason) trong bảng quyết định.");
  }
  if (goal === "orders" && (plan.engagement_system?.conversion_boosters?.length ?? 0) === 0) {
    w.push("Mục tiêu Tăng đơn nhưng thiếu conversion_boosters.");
  }
  if (!plan.measurement_plan?.primary_metric?.trim()) {
    w.push("Thiếu kế hoạch đo lường (measurement_plan).");
  }

  return w;
}
