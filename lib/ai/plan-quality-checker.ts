import type { CampaignGoal } from "@/lib/ai/campaign-planner";
import type { StrategicPlan } from "@/lib/ai/strategic-planner";

/**
 * Kiểm tra chiều sâu của kế hoạch chiến lược. Trả về danh sách cảnh báo (rỗng = đạt).
 */
export function validateCampaignPlanQuality(
  plan: StrategicPlan,
  goal: CampaignGoal,
): string[] {
  const w: string[] = [];

  if (!plan.executive_summary || plan.executive_summary.trim().length < 120) {
    w.push("Tóm tắt chiến lược (executive_summary) quá ngắn/chung chung.");
  }
  if (!plan.market_diagnosis?.summary && (plan.market_diagnosis?.source_based_insights?.length ?? 0) === 0) {
    w.push("Thiếu chẩn đoán thị trường (market_diagnosis).");
  }
  if ((plan.product_decision_table?.length ?? 0) === 0) {
    w.push("Thiếu bảng quyết định sản phẩm (product_decision_table).");
  }
  if ((plan.products_to_source?.length ?? 0) === 0) {
    w.push("Thiếu gợi ý sản phẩm nên tìm thêm (products_to_source).");
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
