import "server-only";

import OpenAI from "openai";

import {
  getAIProvider,
  resolveProviderConfig,
} from "@/lib/ai/client";
import type {
  CampaignGoal,
  PlannerProduct,
  PlannerSummary,
} from "@/lib/ai/campaign-planner";
import type { MarketResearchInsights } from "@/lib/research/research-summarizer";

export type StrategyMode =
  | "safe_test"
  | "push_winners"
  | "find_new"
  | "boost_orders"
  | "boost_commission"
  | "boost_engagement";
export type DetailLevel = "quick" | "detailed" | "very_detailed";

export type SourceInsight = { insight: string; evidence: string; confidence: string };
export type MarketDiagnosis = {
  summary: string;
  customer_pain_points: string[];
  purchase_triggers: string[];
  content_patterns: string[];
  source_based_insights: SourceInsight[];
};
export type InternalDataDiagnosis = {
  data_quality: string;
  summary: string;
  what_we_know: string[];
  what_we_do_not_know: string[];
  testing_assumption: string[];
};
export type GoalStrategy = {
  main_strategy: string;
  why_this_strategy: string;
  funnel_logic: string;
  do: string[];
  avoid: string[];
};
export type ProductDecision = {
  product_id: string | null;
  product_name: string;
  decision: string;
  priority: string;
  role: string;
  reason: string;
  best_angle: string;
  best_cta: string;
  risk: string;
  confidence: string;
};
export type ProductToSource = {
  suggested_product: string;
  reason: string;
  target_customer: string;
  suggested_search_keywords: string[];
  content_angle: string;
  priority: string;
};
export type ExecPost = {
  time: string;
  product_name: string;
  post_type: string;
  objective: string;
  angle: string;
  hook: string;
  body_direction: string;
  cta: string;
  comment_prompt: string;
  save_share_trigger: string;
  why_this_post: string;
};
export type ExecDay = { day: string; theme: string; posts: ExecPost[] };
export type EngagementSystem = {
  comment_baits_safe: string[];
  save_triggers: string[];
  trust_builders: string[];
  conversion_boosters: string[];
};
export type CreativeBrief = {
  visual_direction: string[];
  copywriting_rules: string[];
  tone: string;
};
export type MeasurementPlan = {
  primary_metric: string;
  secondary_metrics: string[];
  success_threshold: string;
  what_to_check_after_7_days: string[];
};

export type StrategicPlan = {
  title: string;
  goal: string;
  executive_summary: string;
  market_diagnosis: MarketDiagnosis;
  internal_data_diagnosis: InternalDataDiagnosis;
  goal_strategy: GoalStrategy;
  product_decision_table: ProductDecision[];
  products_to_source: ProductToSource[];
  weekly_execution_plan: ExecDay[];
  engagement_system: EngagementSystem;
  creative_brief: CreativeBrief;
  measurement_plan: MeasurementPlan;
  risks_and_controls: string[];
  next_actions: string[];
  raw_ai_response: unknown;
};

export type StrategicPlanInput = {
  goal: CampaignGoal;
  week_start: string;
  week_end: string;
  target_customer?: string | null;
  priority_notes?: string | null;
  strategy_mode?: StrategyMode | null;
  detail_level?: DetailLevel | null;
  products: PlannerProduct[];
  summary: PlannerSummary;
  research?: MarketResearchInsights | null;
};

const GOAL_LABELS: Record<CampaignGoal, string> = {
  clicks: "Tăng click",
  orders: "Tăng đơn",
  commission: "Tăng hoa hồng",
  engagement: "Tăng tương tác",
  balanced: "Cân bằng",
};

const SYSTEM_PROMPT = `Bạn là GIÁM ĐỐC CHIẾN LƯỢC bán hàng affiliate Shopee trên Facebook. Bạn KHÔNG viết chung chung.
Quy trình bắt buộc 4 bước: (1) Hiểu thị trường từ research, (2) Chẩn đoán dữ liệu nội bộ, (3) Chiến lược theo mục tiêu, (4) Kế hoạch hành động chi tiết.

RULE CỨNG:
- CẤM câu chung chung kiểu "test sản phẩm", "tối ưu click", "ưu tiên sản phẩm READY" mà không giải thích cụ thể.
- Mỗi sản phẩm trong product_decision_table phải có: vai trò trong phễu, lý do, rủi ro, angle, CTA, confidence.
- Mỗi bài trong weekly_execution_plan phải có: giờ, sản phẩm, hook cụ thể, CTA cụ thể, mục tiêu bài đó, vì sao đăng giờ đó.
- Nếu goal=orders: PHÂN BIỆT rõ sản phẩm kéo click vs dễ ra đơn vs hoa hồng cao cần warming vs không nên ưu tiên; bắt buộc có conversion_boosters; lịch phải phục vụ chuyển đổi, giảm bài chỉ gây tò mò.
- Nếu dữ liệu nội bộ ít: nói rõ "Dữ liệu nội bộ còn ít, chiến lược này ưu tiên test có kiểm soát" + nêu giả thuyết test rõ ràng + cách đo sau 7 ngày. KHÔNG kết luận thắng/thua.
- Research phải biến thành insight có evidence (dựa title/snippet/nguồn nào), KHÔNG chỉ ghi "có nghiên cứu".
- KHÔNG bịa giá/công dụng; KHÔNG nói chắc chắn ra đơn.
- products_to_source: sản phẩm CHƯA có trong kho, để người dùng tự tìm link (kèm từ khóa search), không bịa link.
- weekly_execution_plan: tối đa 7 ngày, mỗi ngày 2-4 bài.

CHỈ trả về JSON đúng schema (không thêm text ngoài JSON):
{
"title":"","goal":"","executive_summary":"",
"market_diagnosis":{"summary":"","customer_pain_points":[""],"purchase_triggers":[""],"content_patterns":[""],"source_based_insights":[{"insight":"","evidence":"","confidence":"HIGH|MEDIUM|LOW"}]},
"internal_data_diagnosis":{"data_quality":"ENOUGH|LIMITED|TEST_ONLY","summary":"","what_we_know":[""],"what_we_do_not_know":[""],"testing_assumption":[""]},
"goal_strategy":{"main_strategy":"","why_this_strategy":"","funnel_logic":"","do":[""],"avoid":[""]},
"product_decision_table":[{"product_id":"","product_name":"","decision":"PUSH|TEST|HOLD|AVOID","priority":"HIGH|MEDIUM|LOW","role":"","reason":"","best_angle":"","best_cta":"","risk":"","confidence":"HIGH|MEDIUM|LOW"}],
"products_to_source":[{"suggested_product":"","reason":"","target_customer":"","suggested_search_keywords":[""],"content_angle":"","priority":"HIGH|MEDIUM|LOW"}],
"weekly_execution_plan":[{"day":"","theme":"","posts":[{"time":"","product_name":"","post_type":"deal|review|checklist|question|comparison|story|bundle","objective":"clicks|orders|commission|engagement","angle":"","hook":"","body_direction":"","cta":"","comment_prompt":"","save_share_trigger":"","why_this_post":""}]}],
"engagement_system":{"comment_baits_safe":[""],"save_triggers":[""],"trust_builders":[""],"conversion_boosters":[""]},
"creative_brief":{"visual_direction":[""],"copywriting_rules":[""],"tone":""},
"measurement_plan":{"primary_metric":"","secondary_metrics":[""],"success_threshold":"","what_to_check_after_7_days":[""]},
"risks_and_controls":[""],
"next_actions":[""]
}`;

function buildUserPrompt(input: StrategicPlanInput): string {
  const productLines = input.products
    .slice(0, 25)
    .map(
      (p) =>
        `- ${p.product_name} (id=${p.product_id}, sub_id=${p.sub_id ?? "none"}, clicks=${p.clicks}, orders=${p.orders}, commission=${p.commission}, ${p.has_data ? "có dữ liệu" : "chưa có dữ liệu"})`,
    )
    .join("\n");

  const r = input.research;
  return [
    `MỤC TIÊU: ${GOAL_LABELS[input.goal]} (${input.goal})`,
    `Chế độ chiến lược: ${input.strategy_mode ?? "(mặc định theo goal)"}`,
    `Mức độ chi tiết: ${input.detail_level ?? "very_detailed"}`,
    `Tuần: ${input.week_start} -> ${input.week_end}`,
    `Tệp khách ưu tiên: ${input.target_customer ?? "(không chỉ định)"}`,
    `Ưu tiên của người dùng: ${input.priority_notes ?? "(không có)"}`,
    "",
    "DỮ LIỆU NỘI BỘ (30 ngày):",
    `- total_clicks=${input.summary.total_clicks}, total_orders=${input.summary.total_orders}, total_commission=${input.summary.total_commission}, conversion=${input.summary.conversion_rate.toFixed(2)}%, epc=${input.summary.epc.toFixed(2)}, có báo cáo: ${input.summary.has_report_data ? "có" : "ít/không"}`,
    "Sản phẩm READY:",
    productLines || "(trống)",
    "",
    r
      ? [
          "NGHIÊN CỨU THỊ TRƯỜNG (Tavily):",
          `- Tóm tắt: ${r.market_summary}`,
          `- Pain points: ${r.customer_pain_points.join("; ")}`,
          `- Xu hướng: ${r.trend_opportunities.join("; ")}`,
          `- Hook: ${r.content_hooks.map((h) => h.hook).join("; ")}`,
          `- Nhóm SP nên đẩy: ${r.recommended_product_groups.map((g) => g.group).join("; ")}`,
        ].join("\n")
      : "NGHIÊN CỨU THỊ TRƯỜNG: (không dùng)",
    "",
    "Hãy lập kế hoạch CHIẾN LƯỢC, CỤ THỂ và CHỈ trả về JSON đúng schema.",
  ].join("\n");
}

// ---- helpers parse ----
function s(v: unknown, fb = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fb;
}
function sa(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => s(x)).filter(Boolean) : [];
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.map((x) => obj(x)) : [];
}

function mockPlan(input: StrategicPlanInput): StrategicPlan {
  const top = input.products.slice(0, 5);
  const limited = !input.summary.has_report_data;
  const goalLabel = GOAL_LABELS[input.goal];
  const orders = input.goal === "orders";

  const decisions: ProductDecision[] = top.map((p, i) => ({
    product_id: p.product_id,
    product_name: p.product_name,
    decision: i === 0 ? "PUSH" : p.has_data ? "PUSH" : "TEST",
    priority: i === 0 ? "HIGH" : i < 3 ? "MEDIUM" : "LOW",
    role: p.commission > 0 ? "hoa hồng cao" : p.clicks > 0 ? "kéo click" : "test thị trường",
    reason: p.has_data
      ? `Có ${p.clicks} click / ${p.orders} đơn gần đây — nhu cầu đã được xác nhận.`
      : "Chưa có dữ liệu — cần test nhu cầu với chi phí thấp.",
    best_angle: orders ? "Mua dự trữ / giải quyết nhu cầu thật" : "Deal nhanh",
    best_cta: orders ? "Kiểm tra deal & chốt nhanh kẻo hết" : "Bấm xem link / lưu lại canh mã",
    risk: "Tránh claim quá mức; kiểm tra tồn kho/deal trước khi đăng.",
    confidence: limited ? "LOW" : "MEDIUM",
  }));

  return {
    title: `Kế hoạch tuần — ${goalLabel}${orders ? " (ưu tiên chuyển đổi)" : ""}`,
    goal: goalLabel,
    executive_summary: limited
      ? "Dữ liệu nội bộ còn ít, chiến lược tuần này ưu tiên test có kiểm soát: chọn 2-3 sản phẩm nhu cầu rõ để xác nhận tín hiệu mua, kết hợp research thị trường để chọn góc viết và khung giờ. Mục tiêu là thu dữ liệu chuyển đổi đáng tin trước khi mở rộng."
      : "Chiến lược tuần tập trung vào nhóm sản phẩm có tín hiệu tốt gần đây, phối góc viết theo mục tiêu, và lịch đăng phục vụ đúng phễu.",
    market_diagnosis: {
      summary: input.research?.market_summary ?? "Chưa có research; dựa trên hiểu biết chung về nhu cầu hằng ngày.",
      customer_pain_points: input.research?.customer_pain_points ?? ["Phân vân chọn sản phẩm", "Muốn tiết kiệm thời gian"],
      purchase_triggers: ["Có deal/mã giảm", "Nhu cầu lặp lại", "Review thật từ người dùng"],
      content_patterns: ["Review ngắn", "Checklist", "Gom deal"],
      source_based_insights: (input.research?.content_hooks ?? []).slice(0, 3).map((h) => ({
        insight: h.hook,
        evidence: "Từ hook/nguồn research Tavily",
        confidence: "MEDIUM",
      })),
    },
    internal_data_diagnosis: {
      data_quality: limited ? "TEST_ONLY" : "LIMITED",
      summary: limited
        ? "Chưa có affiliate_reports — chưa thể kết luận sản phẩm thắng/thua."
        : "Có một ít dữ liệu, đủ để định hướng nhưng cần thêm để chắc chắn.",
      what_we_know: top.filter((p) => p.has_data).map((p) => `${p.product_name}: ${p.clicks} click / ${p.orders} đơn`),
      what_we_do_not_know: ["Tỷ lệ chuyển đổi theo từng angle", "Khung giờ tối ưu cho đơn hàng"],
      testing_assumption: [
        "Giả thuyết 1: nhóm đồ dùng hằng ngày dễ ra đơn khi có deal.",
        "Giả thuyết 2: angle 'mua dự trữ' tăng ý định mua so với 'review'.",
        "Giả thuyết 3: khung 20:30 cho chuyển đổi tốt hơn 08:00.",
      ],
    },
    goal_strategy: {
      main_strategy: orders
        ? "Tập trung sản phẩm nhu cầu rõ + giá dễ quyết định, dùng hook tăng ý định mua và CTA chốt deal."
        : `Chiến lược theo mục tiêu ${goalLabel}.`,
      why_this_strategy: orders
        ? "Mục tiêu là đơn hàng nên ưu tiên sản phẩm có ý định mua sẵn, hạn chế bài chỉ gây tò mò."
        : "Phù hợp mục tiêu đã chọn và dữ liệu hiện có.",
      funnel_logic: "Kéo chú ý (hook) -> tạo nhu cầu (lý do mua) -> chốt (CTA kiểm tra deal/lưu canh mã).",
      do: orders
        ? ["Ưu tiên sản phẩm dùng hằng ngày/giá thấp", "Hook nêu vấn đề thật", "CTA chốt deal rõ ràng"]
        : ["Phối nhiều góc viết", "Bám nhu cầu thực tế"],
      avoid: orders ? ["Bài chỉ gây tò mò không có ý định mua", "Sản phẩm giá cao chưa warming"] : ["Spam một sản phẩm"],
    },
    product_decision_table: decisions,
    products_to_source: (input.research?.recommended_product_groups ?? []).slice(0, 3).map((g) => ({
      suggested_product: g.group,
      reason: g.reason || "Nhóm tiềm năng theo research.",
      target_customer: input.target_customer ?? "người mua sắm online",
      suggested_search_keywords: [g.group, `${g.group} giá tốt shopee`],
      content_angle: "Review thật / gom deal",
      priority: "MEDIUM",
    })),
    weekly_execution_plan: ["Thứ 2", "Thứ 4", "Thứ 6", "Chủ nhật"].map((day, di) => ({
      day,
      theme: orders ? "Đẩy nhu cầu & chốt deal" : "Kéo chú ý & nuôi tương tác",
      posts: top.slice(0, 2).map((p, pi) => ({
        time: ["08:00", "20:30"][pi % 2],
        product_name: p.product_name,
        post_type: orders ? (pi === 0 ? "review" : "checklist") : "question",
        objective: input.goal === "balanced" ? (pi === 0 ? "clicks" : "orders") : input.goal,
        angle: orders ? "Mua dự trữ" : "Deal nhanh",
        hook: orders ? `Món ${p.product_name} mình hay mua lại — lần này thấy deal nên gom luôn.` : `${p.product_name} đang có deal đáng chú ý.`,
        body_direction: "Nêu nhu cầu thật, lợi ích cụ thể, không claim quá mức.",
        cta: orders ? "Kiểm tra deal & chốt kẻo hết hàng." : "Bấm xem link / lưu lại canh mã.",
        comment_prompt: "Nhà bạn đang dùng loại nào?",
        save_share_trigger: "Checklist tiện lưu lại khi cần mua.",
        why_this_post: di === 0 ? "Mở tuần bằng nhu cầu rõ để lấy tín hiệu sớm." : "Lặp lại nhu cầu vào khung giờ tối để tăng chốt.",
      })),
    })),
    engagement_system: {
      comment_baits_safe: ["Bạn hay mua món này ở đâu?", "Tuần này cần mua gì để mình gợi ý?"],
      save_triggers: ["Checklist mua sắm", "Bảng so sánh nhanh"],
      trust_builders: ["Review thật, nêu cả ưu/nhược", "Nói rõ giá có thể thay đổi theo thời điểm"],
      conversion_boosters: ["Nhấn deal có hạn", "Gợi mua kèm/dự trữ", "CTA kiểm tra giá trước khi chốt"],
    },
    creative_brief: {
      visual_direction: ["Ảnh list 3-5 món", "Checklist", "Ảnh thật sản phẩm"],
      copywriting_rules: ["Ngắn, tự nhiên", "Có disclosure tiếp thị liên kết", "Không claim tuyệt đối"],
      tone: "Thân thiện như người dùng chia sẻ.",
    },
    measurement_plan: {
      primary_metric: orders ? "Đơn hàng (orders)" : input.goal === "commission" ? "Hoa hồng" : "Clicks",
      secondary_metrics: ["Conversion rate", "EPC", "Comment/lưu bài"],
      success_threshold: limited ? "Có tín hiệu đơn/đủ dữ liệu để kết luận sau 7 ngày." : "Cải thiện so với tuần trước.",
      what_to_check_after_7_days: ["Sản phẩm nào ra đơn", "Angle nào chuyển đổi tốt", "Khung giờ nào hiệu quả"],
    },
    risks_and_controls: [
      "Không bịa giá; kiểm tra tồn kho/deal trước khi đăng.",
      "Không claim công dụng quá mức.",
      limited ? "Dữ liệu ít — đây là test plan, không kết luận vội." : "Theo dõi sát để điều chỉnh.",
    ],
    next_actions: [
      "Duyệt kế hoạch nếu phù hợp.",
      "Tìm link cho sản phẩm trong 'products_to_source'.",
      "Import báo cáo affiliate sau 7 ngày để đánh giá.",
    ],
    raw_ai_response: { mock: true },
  };
}

function parsePlan(raw: string, input: StrategicPlanInput): StrategicPlan {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return mockPlan(input);
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return mockPlan(input);
  }
  const fb = mockPlan(input);
  const md = obj(o.market_diagnosis);
  const idd = obj(o.internal_data_diagnosis);
  const gs = obj(o.goal_strategy);
  const es = obj(o.engagement_system);
  const cb = obj(o.creative_brief);
  const mp = obj(o.measurement_plan);

  return {
    title: s(o.title, fb.title),
    goal: s(o.goal, fb.goal),
    executive_summary: s(o.executive_summary, fb.executive_summary),
    market_diagnosis: {
      summary: s(md.summary),
      customer_pain_points: sa(md.customer_pain_points),
      purchase_triggers: sa(md.purchase_triggers),
      content_patterns: sa(md.content_patterns),
      source_based_insights: arr(md.source_based_insights).map((x) => ({
        insight: s(x.insight),
        evidence: s(x.evidence),
        confidence: s(x.confidence, "MEDIUM"),
      })),
    },
    internal_data_diagnosis: {
      data_quality: s(idd.data_quality, input.summary.has_report_data ? "LIMITED" : "TEST_ONLY"),
      summary: s(idd.summary),
      what_we_know: sa(idd.what_we_know),
      what_we_do_not_know: sa(idd.what_we_do_not_know),
      testing_assumption: sa(idd.testing_assumption),
    },
    goal_strategy: {
      main_strategy: s(gs.main_strategy),
      why_this_strategy: s(gs.why_this_strategy),
      funnel_logic: s(gs.funnel_logic),
      do: sa(gs.do),
      avoid: sa(gs.avoid),
    },
    product_decision_table: arr(o.product_decision_table).map((x) => ({
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
    products_to_source: arr(o.products_to_source).map((x) => ({
      suggested_product: s(x.suggested_product),
      reason: s(x.reason),
      target_customer: s(x.target_customer),
      suggested_search_keywords: sa(x.suggested_search_keywords),
      content_angle: s(x.content_angle),
      priority: s(x.priority, "MEDIUM"),
    })),
    weekly_execution_plan: arr(o.weekly_execution_plan).map((d) => ({
      day: s(d.day),
      theme: s(d.theme),
      posts: arr(d.posts).map((p) => ({
        time: s(p.time),
        product_name: s(p.product_name),
        post_type: s(p.post_type),
        objective: s(p.objective),
        angle: s(p.angle),
        hook: s(p.hook),
        body_direction: s(p.body_direction),
        cta: s(p.cta),
        comment_prompt: s(p.comment_prompt),
        save_share_trigger: s(p.save_share_trigger),
        why_this_post: s(p.why_this_post),
      })),
    })),
    engagement_system: {
      comment_baits_safe: sa(es.comment_baits_safe),
      save_triggers: sa(es.save_triggers),
      trust_builders: sa(es.trust_builders),
      conversion_boosters: sa(es.conversion_boosters),
    },
    creative_brief: {
      visual_direction: sa(cb.visual_direction),
      copywriting_rules: sa(cb.copywriting_rules),
      tone: s(cb.tone),
    },
    measurement_plan: {
      primary_metric: s(mp.primary_metric),
      secondary_metrics: sa(mp.secondary_metrics),
      success_threshold: s(mp.success_threshold),
      what_to_check_after_7_days: sa(mp.what_to_check_after_7_days),
    },
    risks_and_controls: sa(o.risks_and_controls),
    next_actions: sa(o.next_actions),
    raw_ai_response: o,
  };
}

export async function generateStrategicWeeklyPlan(
  input: StrategicPlanInput,
): Promise<StrategicPlan> {
  const provider = getAIProvider();
  if (provider === "mock") return mockPlan(input);

  const { apiKey, baseURL, model } = resolveProviderConfig(provider);
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.55,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
  });
  const raw = completion.choices[0]?.message?.content ?? "";
  return parsePlan(raw, input);
}
