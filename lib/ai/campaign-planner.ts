import "server-only";

import OpenAI from "openai";

import { getAIProvider, resolveProviderConfig } from "@/lib/ai/client";
import type { MarketResearchInsights } from "@/lib/research/research-summarizer";

export type CampaignGoal =
  | "clicks"
  | "orders"
  | "commission"
  | "engagement"
  | "balanced";

export type PlannerProduct = {
  product_id: string;
  product_name: string;
  sub_id: string | null;
  clicks: number;
  orders: number;
  commission: number;
  has_data: boolean;
};

export type PlannerSummary = {
  total_clicks: number;
  total_orders: number;
  total_commission: number;
  conversion_rate: number;
  epc: number;
  has_report_data: boolean;
};

export type WeeklyPlanInput = {
  goal: CampaignGoal;
  week_start: string;
  week_end: string;
  target_customer?: string | null;
  notes?: string | null;
  products: PlannerProduct[];
  summary: PlannerSummary;
  topAngles: { angle: string; clicks: number; orders: number; commission: number }[];
  topTimes: { time: string; posts: number }[];
  /** Phase 13.1: insight nghiên cứu thị trường (nếu có). */
  research?: MarketResearchInsights | null;
};

export type CampaignConcept = {
  big_idea: string;
  target_emotion: string;
  viral_mechanism: string;
  why_this_week: string;
};
export type InteractionItem = {
  post_type: string;
  comment_prompt: string;
  save_share_trigger: string;
  expected_behavior: string;
};
export type CreativeItem = {
  format: string;
  idea: string;
  example_copy_direction: string;
};
/** Sản phẩm gợi ý NÊN TÌM THÊM (chưa có trong kho) để user tự tìm link. */
export type SuggestedProduct = {
  product_name: string;
  category: string;
  reason: string;
  search_keyword: string;
  why_now: string;
};

export type RecProduct = {
  product_id: string | null;
  product_name: string;
  priority: string;
  reason: string;
  suggested_role: string;
  risk: string;
};
export type RecScheduleItem = {
  day: string;
  time: string;
  product_name: string;
  angle: string;
  objective: string;
  hook_direction: string;
  cta: string;
  comment_prompt: string;
};
export type RecAngle = {
  angle: string;
  purpose: string;
  best_for: string;
  example_hook: string;
};
export type RecHook = { type: string; hook: string; why_it_works: string };

export type WeeklyPlanResult = {
  title: string;
  goal: string;
  summary: string;
  strategy: string;
  recommended_products: RecProduct[];
  recommended_schedule: RecScheduleItem[];
  content_angles: RecAngle[];
  engagement_hooks: RecHook[];
  risks: string[];
  ai_reasoning_summary: string;
  campaign_concept: CampaignConcept | null;
  interaction_plan: InteractionItem[];
  creative_directions: CreativeItem[];
  suggested_new_products: SuggestedProduct[];
  raw_ai_response: unknown;
};

const GOAL_LABELS: Record<CampaignGoal, string> = {
  clicks: "Tăng click",
  orders: "Tăng đơn",
  commission: "Tăng hoa hồng",
  engagement: "Tăng tương tác",
  balanced: "Cân bằng",
};

const SYSTEM_PROMPT = `Bạn là chuyên gia hoạch định chiến dịch Affiliate Shopee đăng trên Facebook.
Dựa trên dữ liệu sản phẩm + hiệu quả (clicks/orders/commission) + lịch sử bài đăng, hãy đề xuất kế hoạch chiến dịch cho TUẦN này.

Quy tắc:
- KHÔNG bịa giá cụ thể nếu không có dữ liệu giá.
- KHÔNG bịa công dụng y tế/sức khỏe, KHÔNG claim "tốt nhất/rẻ nhất/cam kết".
- KHÔNG nói chắc chắn sẽ có đơn/hoa hồng.
- Ưu tiên sản phẩm link_status READY, có dữ liệu click/order/commission tốt, hoặc sản phẩm mới cần test.
- Nếu dữ liệu affiliate còn ít, nêu rõ: "Dữ liệu còn ít, đây là kế hoạch test."
- Đề xuất cách tăng tương tác: câu hỏi mở, hook gây tò mò, CTA lưu bài/xem link, angle review thật, mua dự trữ, gom deal.
- Tối đa 7 ngày; mỗi ngày 2-4 bài; không spam 1 sản phẩm quá nhiều nếu còn nhiều sản phẩm khác.
- Nếu mục tiêu là engagement: ưu tiên hook/câu hỏi hơn bán trực diện.
- Nếu mục tiêu là commission: ưu tiên sản phẩm hoa hồng cao nhưng vẫn có khả năng click.

Nếu có dữ liệu NGHIÊN CỨU THỊ TRƯỜNG, hãy tận dụng để kế hoạch CỤ THỂ hơn (hook, nhóm sản phẩm, cách kéo tương tác). Phân biệt rõ dữ liệu nội bộ vs research ngoài vs suy luận.

CHỈ trả về JSON đúng schema (không thêm text ngoài JSON):
{
  "title": "", "goal": "", "summary": "", "strategy": "",
  "recommended_products": [{"product_id":"","product_name":"","priority":"HIGH|MEDIUM|LOW","reason":"","suggested_role":"","risk":""}],
  "recommended_schedule": [{"day":"","time":"","product_name":"","angle":"","objective":"","hook_direction":"","cta":"","comment_prompt":""}],
  "content_angles": [{"angle":"","purpose":"","best_for":"","example_hook":""}],
  "engagement_hooks": [{"type":"","hook":"","why_it_works":""}],
  "campaign_concept": {"big_idea":"","target_emotion":"","viral_mechanism":"","why_this_week":""},
  "interaction_plan": [{"post_type":"câu hỏi mở | list deal | review mềm | so sánh | checklist","comment_prompt":"","save_share_trigger":"","expected_behavior":"comment | click | lưu bài | inbox"}],
  "creative_directions": [{"format":"bài text | ảnh list | ảnh before-after | checklist | album","idea":"","example_copy_direction":""}],
  "suggested_new_products": [{"product_name":"","category":"","reason":"","search_keyword":"","why_now":""}],
  "risks": [""],
  "ai_reasoning_summary": ""
}

QUAN TRỌNG về suggested_new_products:
- Đây là sản phẩm/nhóm sản phẩm NÊN TÌM THÊM (CHƯA có trong kho) để người dùng tự đi tìm link affiliate Shopee.
- Dựa trên nghiên cứu thị trường + xu hướng + tệp khách; liên quan tới nhóm sản phẩm hiện có.
- KHÔNG bịa link/giá cụ thể. Cung cấp "search_keyword" để người dùng tự search trên Shopee.
- Đề xuất 3-7 mục.`;

function buildUserPrompt(input: WeeklyPlanInput): string {
  const productLines = input.products
    .slice(0, 25)
    .map(
      (p) =>
        `- ${p.product_name} (id=${p.product_id}, sub_id=${p.sub_id ?? "none"}, clicks=${p.clicks}, orders=${p.orders}, commission=${p.commission}, ${p.has_data ? "có dữ liệu" : "chưa có dữ liệu"})`,
    )
    .join("\n");

  return [
    `Mục tiêu tuần: ${GOAL_LABELS[input.goal]} (${input.goal})`,
    `Tuần: ${input.week_start} -> ${input.week_end}`,
    `Tệp khách ưu tiên: ${input.target_customer ?? "(không chỉ định)"}`,
    `Ghi chú: ${input.notes ?? "(không có)"}`,
    "",
    "Tổng quan hiệu quả 30 ngày:",
    `- total_clicks=${input.summary.total_clicks}, total_orders=${input.summary.total_orders}, total_commission=${input.summary.total_commission}`,
    `- conversion_rate=${input.summary.conversion_rate.toFixed(2)}%, epc=${input.summary.epc.toFixed(2)}`,
    `- có dữ liệu báo cáo: ${input.summary.has_report_data ? "có" : "ít/không"}`,
    "",
    "Angle hiệu quả (gần đúng):",
    input.topAngles.length
      ? input.topAngles.map((a) => `- ${a.angle}: clicks=${a.clicks}, orders=${a.orders}, commission=${a.commission}`).join("\n")
      : "(chưa có dữ liệu angle)",
    "",
    "Khung giờ đã dùng nhiều:",
    input.topTimes.length ? input.topTimes.map((t) => `- ${t.time}: ${t.posts} bài`).join("\n") : "(chưa có)",
    "",
    "Danh sách sản phẩm READY:",
    productLines || "(trống)",
    "",
    input.research
      ? [
          "NGHIÊN CỨU THỊ TRƯỜNG (nguồn ngoài):",
          `- Tóm tắt: ${input.research.market_summary}`,
          `- Pain points: ${input.research.customer_pain_points.join("; ")}`,
          `- Cơ hội/xu hướng: ${input.research.trend_opportunities.join("; ")}`,
          `- Hook gợi ý: ${input.research.content_hooks.map((h) => h.hook).join("; ")}`,
          `- Tactic tương tác: ${input.research.engagement_tactics.map((t) => t.tactic).join("; ")}`,
        ].join("\n")
      : "NGHIÊN CỨU THỊ TRƯỜNG: (không dùng)",
    "",
    "Hãy lập kế hoạch và CHỈ trả về JSON đúng schema.",
  ].join("\n");
}

const DEFAULT_ANGLES: RecAngle[] = [
  { angle: "Deal nhanh", purpose: "Kéo click", best_for: "Sản phẩm giá thấp / nhu cầu hằng ngày", example_hook: "Deal hôm nay khá hời, ai cần thì xem nhanh!" },
  { angle: "Review thật", purpose: "Tạo niềm tin", best_for: "Sản phẩm cần thuyết phục", example_hook: "Mình dùng thử rồi, chia sẻ thật nè." },
  { angle: "Mua dự trữ", purpose: "Tăng đơn", best_for: "Đồ dùng hằng ngày, mẹ bỉm", example_hook: "Món này hay hết, thấy deal là gom luôn." },
  { angle: "Combo kéo traffic", purpose: "Gom deal", best_for: "Nhiều sản phẩm cùng nhóm", example_hook: "Gom vài deal hay, để link đây ai cần xem thêm." },
];

const DEFAULT_HOOKS: RecHook[] = [
  { type: "Câu hỏi mở", hook: "Nhà bạn đang dùng món này loại nào?", why_it_works: "Kích thích bình luận, tăng reach." },
  { type: "Gây tò mò", hook: "Món nhỏ mà mình dùng hằng ngày không ngờ tới...", why_it_works: "Tạo tò mò để giữ người đọc." },
];

const DEFAULT_RISKS = [
  "Không bịa giá cụ thể nếu không có dữ liệu.",
  "Không claim công dụng quá mức.",
  "Kiểm tra lại sản phẩm trước khi chạy.",
];

/** Kế hoạch mẫu (mock) dựa trên vài sản phẩm đầu tiên. */
function mockPlan(input: WeeklyPlanInput): WeeklyPlanResult {
  const top = input.products.slice(0, 3);
  const lowData = !input.summary.has_report_data;
  const days = ["Thứ 2", "Thứ 4", "Thứ 6"];
  const times = ["08:00", "11:30", "20:30"];

  return {
    title: `Kế hoạch tuần — ${GOAL_LABELS[input.goal]}`,
    goal: GOAL_LABELS[input.goal],
    summary: lowData
      ? "Dữ liệu còn ít, đây là kế hoạch test dựa trên sản phẩm hiện có."
      : "Kế hoạch tuần dựa trên hiệu quả gần đây và sản phẩm READY.",
    strategy:
      "Ưu tiên sản phẩm có dữ liệu tốt + thử nghiệm sản phẩm mới; phối nhiều góc viết để tăng tương tác và click.",
    recommended_products: top.map((p, i) => ({
      product_id: p.product_id,
      product_name: p.product_name,
      priority: i === 0 ? "HIGH" : i === 1 ? "MEDIUM" : "LOW",
      reason: p.has_data ? "Có dữ liệu click/đơn gần đây." : "Sản phẩm mới, cần test thị hiếu.",
      suggested_role: p.commission > 0 ? "hoa hồng cao" : p.clicks > 0 ? "kéo click" : "test sản phẩm mới",
      risk: lowData ? "Dữ liệu ít — chỉ là test." : "",
    })),
    recommended_schedule: top.flatMap((p, pi) =>
      days.slice(0, 2).map((day, di) => ({
        day,
        time: times[(pi + di) % times.length],
        product_name: p.product_name,
        angle: DEFAULT_ANGLES[(pi + di) % DEFAULT_ANGLES.length].angle,
        objective: GOAL_LABELS[input.goal],
        hook_direction: "Mở đầu tự nhiên, nêu nhu cầu thực tế.",
        cta: "Lưu bài lại / xem link bên dưới nhé.",
        comment_prompt: "Nhà bạn đang dùng món này loại nào?",
      })),
    ),
    content_angles: DEFAULT_ANGLES,
    engagement_hooks: DEFAULT_HOOKS,
    campaign_concept: {
      big_idea: "Tuần gom deal đồ dùng hằng ngày — chọn đúng, mua đủ.",
      target_emotion: "An tâm, tiết kiệm thời gian.",
      viral_mechanism: "Bài hỏi đáp + checklist dễ lưu, dễ tag bạn bè.",
      why_this_week: lowData ? "Khởi động test để thu dữ liệu." : "Tận dụng nhóm sản phẩm đang có tương tác.",
    },
    interaction_plan: [
      { post_type: "câu hỏi mở", comment_prompt: "Bạn hay mua món này ở đâu?", save_share_trigger: "Checklist tiện lưu lại", expected_behavior: "comment" },
      { post_type: "list deal", comment_prompt: "Cần link món nào để mình gửi?", save_share_trigger: "Gom nhiều deal trong 1 bài", expected_behavior: "click" },
    ],
    creative_directions: [
      { format: "ảnh list", idea: "Tổng hợp 3-5 món hằng ngày kèm ghi chú ngắn", example_copy_direction: "Liệt kê ngắn gọn, mỗi món 1 dòng lợi ích thực tế." },
      { format: "checklist", idea: "Checklist 'cần mua dự trữ tuần này'", example_copy_direction: "Giọng thân thiện, gợi nhu cầu thật, CTA lưu bài." },
    ],
    risks: DEFAULT_RISKS,
    ai_reasoning_summary: lowData
      ? "Mock: dữ liệu ít nên ưu tiên test sản phẩm hiện có với nhiều góc viết."
      : "Mock: ưu tiên sản phẩm có dữ liệu, phối góc viết theo mục tiêu.",
    suggested_new_products: [
      {
        product_name: "Combo phụ kiện đi kèm sản phẩm chủ lực",
        category: "Phụ kiện / cross-sell",
        reason: "Tăng giá trị giỏ hàng và bài combo dễ kéo tương tác.",
        search_keyword: "phụ kiện " + (top[0]?.product_name ?? "sản phẩm hằng ngày"),
        why_now: "Tận dụng nhu cầu đang có của nhóm sản phẩm chủ lực.",
      },
      {
        product_name: "Sản phẩm tiêu hao dùng hằng ngày",
        category: "Đồ dùng gia đình",
        reason: "Nhu cầu lặp lại, dễ chốt khi có deal, hợp bài 'mua dự trữ'.",
        search_keyword: "đồ dùng gia đình tiện ích sale",
        why_now: "Mùa sale, khách hay gom dự trữ.",
      },
    ],
    raw_ai_response: { mock: true },
  };
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

/** Chuẩn hóa JSON AID về WeeklyPlanResult (fallback mock nếu lỗi). */
function parsePlan(raw: string, input: WeeklyPlanInput): WeeklyPlanResult {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return mockPlan(input);

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return mockPlan(input);
  }

  const fb = mockPlan(input);
  return {
    title: str(obj.title, fb.title),
    goal: str(obj.goal, fb.goal),
    summary: str(obj.summary, fb.summary),
    strategy: str(obj.strategy, fb.strategy),
    recommended_products: asArray(obj.recommended_products).map((p) => {
      const r = (p ?? {}) as Record<string, unknown>;
      return {
        product_id: typeof r.product_id === "string" ? r.product_id : null,
        product_name: str(r.product_name, "Sản phẩm"),
        priority: str(r.priority, "MEDIUM"),
        reason: str(r.reason),
        suggested_role: str(r.suggested_role),
        risk: str(r.risk),
      };
    }),
    recommended_schedule: asArray(obj.recommended_schedule).map((s) => {
      const r = (s ?? {}) as Record<string, unknown>;
      return {
        day: str(r.day),
        time: str(r.time),
        product_name: str(r.product_name),
        angle: str(r.angle),
        objective: str(r.objective),
        hook_direction: str(r.hook_direction),
        cta: str(r.cta),
        comment_prompt: str(r.comment_prompt),
      };
    }),
    content_angles: asArray(obj.content_angles).map((a) => {
      const r = (a ?? {}) as Record<string, unknown>;
      return {
        angle: str(r.angle),
        purpose: str(r.purpose),
        best_for: str(r.best_for),
        example_hook: str(r.example_hook),
      };
    }),
    engagement_hooks: asArray(obj.engagement_hooks).map((h) => {
      const r = (h ?? {}) as Record<string, unknown>;
      return {
        type: str(r.type),
        hook: str(r.hook),
        why_it_works: str(r.why_it_works),
      };
    }),
    risks: asArray(obj.risks).map((x) => str(x)).filter(Boolean),
    ai_reasoning_summary: str(obj.ai_reasoning_summary, fb.ai_reasoning_summary),
    campaign_concept: (() => {
      const c = (obj.campaign_concept ?? null) as Record<string, unknown> | null;
      if (!c || typeof c !== "object") return fb.campaign_concept;
      return {
        big_idea: str(c.big_idea),
        target_emotion: str(c.target_emotion),
        viral_mechanism: str(c.viral_mechanism),
        why_this_week: str(c.why_this_week),
      };
    })(),
    interaction_plan: asArray(obj.interaction_plan).map((it) => {
      const r = (it ?? {}) as Record<string, unknown>;
      return {
        post_type: str(r.post_type),
        comment_prompt: str(r.comment_prompt),
        save_share_trigger: str(r.save_share_trigger),
        expected_behavior: str(r.expected_behavior),
      };
    }),
    creative_directions: asArray(obj.creative_directions).map((it) => {
      const r = (it ?? {}) as Record<string, unknown>;
      return {
        format: str(r.format),
        idea: str(r.idea),
        example_copy_direction: str(r.example_copy_direction),
      };
    }),
    suggested_new_products: asArray(obj.suggested_new_products).map((it) => {
      const r = (it ?? {}) as Record<string, unknown>;
      return {
        product_name: str(r.product_name),
        category: str(r.category),
        reason: str(r.reason),
        search_keyword: str(r.search_keyword),
        why_now: str(r.why_now),
      };
    }),
    raw_ai_response: obj,
  };
}

/** Sinh kế hoạch chiến dịch tuần (mock / v98 / openai). */
export async function generateWeeklyCampaignPlan(
  input: WeeklyPlanInput,
): Promise<WeeklyPlanResult> {
  const provider = getAIProvider();
  if (provider === "mock") return mockPlan(input);

  const { apiKey, baseURL, model } = resolveProviderConfig(provider);
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.6,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  return parsePlan(raw, input);
}
