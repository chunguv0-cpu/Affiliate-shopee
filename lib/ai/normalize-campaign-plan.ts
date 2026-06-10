import type { StrategicPlan } from "@/lib/ai/strategic-planner";

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

  return {
    title: s(p.title, "Kế hoạch chiến dịch"),
    goal: s(p.goal, ""),
    executive_summary: s(p.executive_summary, ""),
    market_diagnosis: {
      summary: s(md.summary),
      customer_pain_points: sArr(md.customer_pain_points),
      purchase_triggers: sArr(md.purchase_triggers),
      content_patterns: sArr(md.content_patterns),
      source_based_insights: aArr(md.source_based_insights).map((x) => ({
        insight: s(x.insight),
        evidence: s(x.evidence),
        confidence: s(x.confidence, "MEDIUM"),
      })),
    },
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
    engagement_system: {
      comment_baits_safe: sArr(es.comment_baits_safe),
      save_triggers: sArr(es.save_triggers),
      trust_builders: sArr(es.trust_builders),
      conversion_boosters: sArr(es.conversion_boosters),
    },
    creative_brief: {
      visual_direction: sArr(cb.visual_direction),
      copywriting_rules: sArr(cb.copywriting_rules),
      tone: s(cb.tone),
    },
    measurement_plan: {
      primary_metric: s(mp.primary_metric),
      secondary_metrics: sArr(mp.secondary_metrics),
      success_threshold: s(mp.success_threshold),
      what_to_check_after_7_days: sArr(mp.what_to_check_after_7_days),
    },
    risks_and_controls: sArr(p.risks_and_controls),
    next_actions: sArr(p.next_actions),
    raw_ai_response: null,
  };
}
