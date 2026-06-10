import "server-only";

import OpenAI from "openai";

import { getAIProvider, resolveProviderConfig } from "@/lib/ai/client";
import type { SearchResult } from "@/lib/research/search-client";

export type ContentHook = { hook: string; why_it_works: string; best_for_product: string };
export type ProductGroup = { group: string; reason: string; products: string[] };
export type EngagementTactic = { tactic: string; example: string; risk: string };

export type MarketResearchInsights = {
  market_summary: string;
  customer_pain_points: string[];
  trend_opportunities: string[];
  content_hooks: ContentHook[];
  recommended_product_groups: ProductGroup[];
  engagement_tactics: EngagementTactic[];
  risks: string[];
  source_notes: string[];
};

export type SummarizeInput = {
  queries: string[];
  results: SearchResult[];
  productNames: string[];
  goal: string;
  target_customer?: string | null;
};

const SYSTEM_PROMPT = `Bạn là chuyên gia nghiên cứu thị trường cho affiliate Shopee đăng Facebook.
Tổng hợp các nguồn công khai (title/snippet) thành insight ỨNG DỤNG ĐƯỢC cho bài Facebook.

Quy tắc:
- KHÔNG bịa số liệu cụ thể nếu nguồn không có.
- KHÔNG copy dài nội dung từ nguồn (chỉ tóm tắt ngắn).
- KHÔNG claim y tế/sức khỏe quá mức.
- KHÔNG nói chắc chắn sản phẩm sẽ ra đơn.
- Ưu tiên insight áp dụng cho viết caption / kéo tương tác.
- Nếu nguồn ít/không rõ, nói rõ trong market_summary.

CHỈ trả về JSON đúng schema (không thêm text ngoài JSON):
{
  "market_summary": "",
  "customer_pain_points": [""],
  "trend_opportunities": [""],
  "content_hooks": [{"hook":"","why_it_works":"","best_for_product":""}],
  "recommended_product_groups": [{"group":"","reason":"","products":[""]}],
  "engagement_tactics": [{"tactic":"","example":"","risk":""}],
  "risks": [""],
  "source_notes": [""]
}`;

function buildUserPrompt(input: SummarizeInput): string {
  const sources = input.results
    .slice(0, 20)
    .map((r, i) => `${i + 1}. ${r.title} — ${r.snippet ?? ""}`.slice(0, 300))
    .join("\n");
  return [
    `Mục tiêu: ${input.goal}`,
    `Tệp khách: ${input.target_customer ?? "(không chỉ định)"}`,
    `Sản phẩm: ${input.productNames.slice(0, 25).join(", ") || "(trống)"}`,
    "",
    "Các truy vấn đã tìm:",
    input.queries.map((q) => `- ${q}`).join("\n"),
    "",
    "Nguồn tham khảo (tóm tắt):",
    sources || "(không có nguồn)",
    "",
    "Hãy tổng hợp và CHỈ trả về JSON đúng schema.",
  ].join("\n");
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : "")).filter(Boolean) : [];
}
function str(v: unknown, fb = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fb;
}

function mockInsights(input: SummarizeInput): MarketResearchInsights {
  return {
    market_summary:
      "Tổng hợp mẫu (mock): khách ưu tiên giá hợp lý, review thật và tiện lợi hằng ngày. Dữ liệu nguồn còn ít — nên xem là định hướng test.",
    customer_pain_points: [
      "Phân vân giữa nhiều lựa chọn, sợ mua nhầm.",
      "Muốn tiết kiệm thời gian, mua một lần dùng lâu.",
    ],
    trend_opportunities: [
      "Nội dung review thật/so sánh ngắn dễ tạo niềm tin.",
      "Bài 'gom deal' và checklist được lưu lại nhiều.",
    ],
    content_hooks: [
      { hook: "Nhà bạn đang dùng loại nào?", why_it_works: "Kích thích bình luận.", best_for_product: input.productNames[0] ?? "sản phẩm hằng ngày" },
    ],
    recommended_product_groups: [
      { group: "Đồ dùng hằng ngày", reason: "Nhu cầu lặp lại, dễ chốt khi có deal.", products: input.productNames.slice(0, 3) },
    ],
    engagement_tactics: [
      { tactic: "Câu hỏi mở cuối bài", example: "Bạn hay mua món này ở đâu?", risk: "Tránh hỏi quá chung." },
    ],
    risks: ["Không bịa giá.", "Kiểm tra sản phẩm trước khi đăng."],
    source_notes: ["Nguồn mẫu (mock) — chưa cấu hình SEARCH_PROVIDER thật."],
  };
}

function parse(raw: string, input: SummarizeInput): MarketResearchInsights {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return mockInsights(input);
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return mockInsights(input);
  }
  const fb = mockInsights(input);
  return {
    market_summary: str(o.market_summary, fb.market_summary),
    customer_pain_points: strArr(o.customer_pain_points),
    trend_opportunities: strArr(o.trend_opportunities),
    content_hooks: Array.isArray(o.content_hooks)
      ? o.content_hooks.map((h) => {
          const r = (h ?? {}) as Record<string, unknown>;
          return { hook: str(r.hook), why_it_works: str(r.why_it_works), best_for_product: str(r.best_for_product) };
        })
      : [],
    recommended_product_groups: Array.isArray(o.recommended_product_groups)
      ? o.recommended_product_groups.map((g) => {
          const r = (g ?? {}) as Record<string, unknown>;
          return { group: str(r.group), reason: str(r.reason), products: strArr(r.products) };
        })
      : [],
    engagement_tactics: Array.isArray(o.engagement_tactics)
      ? o.engagement_tactics.map((t) => {
          const r = (t ?? {}) as Record<string, unknown>;
          return { tactic: str(r.tactic), example: str(r.example), risk: str(r.risk) };
        })
      : [],
    risks: strArr(o.risks),
    source_notes: strArr(o.source_notes),
  };
}

export async function summarizeMarketResearch(
  input: SummarizeInput,
): Promise<MarketResearchInsights> {
  const provider = getAIProvider();
  if (provider === "mock") return mockInsights(input);

  const { apiKey, baseURL, model } = resolveProviderConfig(provider);
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const completion = await client.chat.completions.create({
    model,
    temperature: 0.5,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
  });
  const raw = completion.choices[0]?.message?.content ?? "";
  return parse(raw, input);
}
