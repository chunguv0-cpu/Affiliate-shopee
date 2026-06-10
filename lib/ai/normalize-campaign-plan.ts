import type { ResearchStatus, StrategicPlan } from "@/lib/ai/strategic-planner";
import type { PlannerMode } from "@/lib/types";

/**
 * Chuẩn hóa AN TOÀN một plan (từ AI hoặc từ DB) về đầy đủ field.
 * KHÔNG throw — mọi thiếu sót đều có fallback để UI không nhận undefined.
 */

function s(v: unknown, fb = ""): string {
  return typeof v === "string" && v.trim() ? v : fb;
}
function sArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x : x == null ? "" : String(x))).filter((x) => x.trim() !== "");
}
function aArr(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}));
}
function o(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function normalizeCampaignPlan(input: unknown): StrategicPlan {
  const p = o(input);
  const md = o(p.market_diagnosis);
  const idd = o(p.internal_data_diagnosis);
  const gs = o(p.goal_strategy);
  const es = o(p.engagement_system);
  const cb = o(p.creative_brief);
  const mp = o(p.measurement_plan);
  const pds = o(p.product_discovery_strategy);

  const mode: PlannerMode =
    p.planner_mode === "EXISTING_ONLY" || p.planner_mode === "DISCOVERY_ONLY"
      ? (p.planner_mode as PlannerMode)
      : "HYBRID";

  const rsRaw = pds.research_status ?? p.research_status;
  const researchStatus: ResearchStatus =
    rsRaw === "USED_TAVILY" || rsRaw === "PARTIAL_RESEARCH" || rsRaw === "FALLBACK_ONLY"
      ? (rsRaw as ResearchStatus)
      : "FALLBACK_ONLY";

  const isDiscovery = mode === "DISCOVERY_ONLY";
  const goalStr = s(p.goal, "");
  const ordersGoal = /order|đơn/i.test(goalStr);
  const execSummary = s(p.executive_summary, "");

  // ---- product_discovery_strategy (đã chuẩn hóa) ----
  const discovery = {
    research_status: researchStatus,
    discovery_summary: s(pds.discovery_summary),
    recommended_categories: aArr(pds.recommended_categories).map((x) => ({
      category: s(x.category),
      why_now: s(x.why_now),
      target_customer: s(x.target_customer),
      purchase_intent: s(x.purchase_intent, "MEDIUM"),
      content_potential: s(x.content_potential, "MEDIUM"),
      risk: s(x.risk),
    })),
    new_product_opportunities: aArr(pds.new_product_opportunities).map((x) => ({
      suggested_product: s(x.suggested_product),
      category: s(x.category),
      reason: s(x.reason),
      target_customer: s(x.target_customer),
      pain_point: s(x.pain_point),
      suggested_price_band: s(x.suggested_price_band),
      suggested_search_keywords: sArr(x.suggested_search_keywords),
      content_angle: s(x.content_angle),
      first_post_hook: s(x.first_post_hook),
      cta: s(x.cta),
      priority: s(x.priority, "MEDIUM"),
      confidence: s(x.confidence, "MEDIUM"),
    })),
    sourcing_plan: aArr(pds.sourcing_plan).map((x) => ({
      step: s(x.step),
      detail: s(x.detail),
    })),
  };

  // ---- market_diagnosis (fallback an toàn cho DISCOVERY_ONLY) ----
  const mdBase = {
    summary: s(md.summary),
    customer_pain_points: sArr(md.customer_pain_points),
    purchase_triggers: sArr(md.purchase_triggers),
    content_patterns: sArr(md.content_patterns),
    source_based_insights: aArr(md.source_based_insights).map((x) => ({
      insight: s(x.insight),
      evidence: s(x.evidence),
      confidence: s(x.confidence, "MEDIUM"),
    })),
  };
  const mdEmpty =
    !mdBase.summary && mdBase.customer_pain_points.length === 0 && mdBase.source_based_insights.length === 0;
  const marketDiagnosis =
    isDiscovery && mdEmpty
      ? {
          summary: discovery.discovery_summary || execSummary,
          customer_pain_points: Array.from(
            new Set(discovery.new_product_opportunities.map((x) => x.pain_point).filter((x) => x.trim() !== "")),
          ).slice(0, 8),
          purchase_triggers: [
            "Nhu cầu mua sản phẩm thiết yếu",
            "Sản phẩm giải quyết vấn đề hằng ngày",
            "Giá dễ ra quyết định",
            "Có thể tạo nội dung dạng checklist/review mềm",
          ],
          content_patterns: [
            "Bài checklist sản phẩm nên mua",
            "Bài hỏi kinh nghiệm sử dụng",
            "Bài gom sản phẩm theo tình huống",
            "Bài review mềm tránh quảng cáo quá lộ",
          ],
          source_based_insights: [],
        }
      : mdBase;

  // ---- engagement_system (fallback conversion_boosters khi goal=orders) ----
  const engagement = {
    comment_baits_safe: sArr(es.comment_baits_safe),
    save_triggers: sArr(es.save_triggers),
    trust_builders: sArr(es.trust_builders),
    conversion_boosters: sArr(es.conversion_boosters),
  };
  if (ordersGoal && engagement.conversion_boosters.length === 0) {
    engagement.conversion_boosters = [
      "Dùng CTA kiểm tra deal thay vì ép mua trực diện.",
      "Ưu tiên sản phẩm có nhu cầu rõ, dễ hiểu trong 3 giây đầu.",
      "Viết theo tình huống sử dụng thực tế để tăng ý định mua.",
      "Nhắc người dùng kiểm tra giá, tồn kho và đánh giá shop trước khi chốt.",
      "Dùng sản phẩm giá thấp/thiết yếu làm bài kéo đơn đầu tiên.",
    ];
  }

  // ---- measurement_plan (fallback khi thiếu) ----
  const mpBase = {
    primary_metric: s(mp.primary_metric),
    secondary_metrics: sArr(mp.secondary_metrics),
    success_threshold: s(mp.success_threshold),
    what_to_check_after_7_days: sArr(mp.what_to_check_after_7_days),
  };
  const mpEmpty = !mpBase.primary_metric && mpBase.secondary_metrics.length === 0;
  const measurementPlan = mpEmpty
    ? {
        primary_metric: ordersGoal ? "Số đơn hàng theo sub_id" : "Click và tương tác",
        secondary_metrics: [
          "Click theo sub_id",
          "Tỷ lệ đơn/click",
          "Hoa hồng",
          "Bài có nhiều comment/lưu bài",
          "Sản phẩm được click nhiều nhất",
        ],
        success_threshold:
          "Sau 7 ngày, chọn nhóm sản phẩm có click hoặc đơn tốt nhất để import thêm link và tạo campaign thật.",
        what_to_check_after_7_days: [
          "Nhóm sản phẩm nào có nhiều click nhất",
          "Sản phẩm nào tạo đơn hoặc tín hiệu mua rõ nhất",
          "Hook nào kéo comment tốt",
          "CTA nào kéo click tốt",
          "Sản phẩm nào nên bỏ hoặc test lại",
        ],
      }
    : mpBase;

  return {
    title: s(p.title, "Kế hoạch chiến dịch"),
    goal: goalStr,
    planner_mode: mode,
    research_status: researchStatus,
    product_discovery_strategy: discovery,
    executive_summary: execSummary,
    market_diagnosis: marketDiagnosis,
    internal_data_diagnosis: {
      data_quality: s(idd.data_quality, "TEST_ONLY"),
      summary: s(idd.summary),
      what_we_know: sArr(idd.what_we_know),
      what_we_do_not_know: sArr(idd.what_we_do_not_know),
      testing_assumption: sArr(idd.testing_assumption),
    },
    goal_strategy: {
      main_strategy: s(gs.main_strategy),
      why_this_strategy: s(gs.why_this_strategy),
      funnel_logic: s(gs.funnel_logic),
      do: sArr(gs.do),
      avoid: sArr(gs.avoid),
    },
    product_decision_table: aArr(p.product_decision_table).map((x) => ({
      product_id: typeof x.product_id === "string" ? x.product_id : null,
      product_name: s(x.product_name, "Sản phẩm"),
      decision: s(x.decision, "TEST"),
      priority: s(x.priority, "MEDIUM"),
      role: s(x.role),
      reason: s(x.reason),
      best_angle: s(x.best_angle),
      best_cta: s(x.best_cta),
      risk: s(x.risk),
      confidence: s(x.confidence, "MEDIUM"),
    })),
    products_to_source: aArr(p.products_to_source).map((x) => ({
      suggested_product: s(x.suggested_product),
      reason: s(x.reason),
      target_customer: s(x.target_customer),
      suggested_search_keywords: sArr(x.suggested_search_keywords),
      content_angle: s(x.content_angle),
      priority: s(x.priority, "MEDIUM"),
    })),
    weekly_execution_plan: aArr(p.weekly_execution_plan).map((d) => ({
      day: s(d.day),
      theme: s(d.theme),
      posts: aArr(d.posts).map((post) => ({
        time: s(post.time),
        product_name: s(post.product_name),
        post_type: s(post.post_type),
        objective: s(post.objective),
        angle: s(post.angle),
        hook: s(post.hook),
        body_direction: s(post.body_direction),
        cta: s(post.cta),
        comment_prompt: s(post.comment_prompt),
        save_share_trigger: s(post.save_share_trigger),
        why_this_post: s(post.why_this_post),
      })),
    })),
    engagement_system: engagement,
    creative_brief: {
      visual_direction: sArr(cb.visual_direction),
      copywriting_rules: sArr(cb.copywriting_rules),
      tone: s(cb.tone),
    },
    measurement_plan: measurementPlan,
    risks_and_controls: sArr(p.risks_and_controls),
    next_actions: sArr(p.next_actions),
    raw_ai_response: null,
  };
}
