import "server-only";

import OpenAI from "openai";

import { getAIProvider, resolveProviderConfig } from "@/lib/ai/client";
import type { PostingPlan, ProductOpportunity } from "@/lib/types";

/**
 * Phase 19 — AI Campaign Planner cho Autopilot.
 * Sinh kế hoạch chiến dịch (KHÔNG tạo sản phẩm ngay) để user duyệt trước.
 * KHÔNG bao giờ throw: lỗi/timeout -> fallback mock có cấu trúc.
 */

export type CampaignPlanInput = {
  objective: string;
  days: number;
  posts_per_day: number;
  priority_group?: string | null;
  target_customer?: string | null;
};

export type CampaignPlanResult = {
  campaign_title: string;
  campaign_goal: string;
  target_customers: string;
  content_angles: string[];
  product_opportunities: ProductOpportunity[];
  posting_plan: PostingPlan;
  creative_direction: {
    template?: string;
    tone?: string;
    notes?: string;
  };
};

const PLAN_TIMEOUT_MS = 35_000;

const SYSTEM_PROMPT = `Bạn là chuyên gia chiến lược affiliate marketing Shopee tại Việt Nam.
Nhiệm vụ: đề xuất MỘT chiến dịch tuần dựa trên mục tiêu của người dùng.
QUAN TRỌNG:
- Chỉ ĐỀ XUẤT (chưa tạo sản phẩm). Người dùng sẽ duyệt rồi hệ thống mới tự đi tìm sản phẩm.
- Trả về DUY NHẤT một object JSON, không kèm giải thích.
- product_opportunities: 5-8 cơ hội sản phẩm cụ thể, mỗi cái có từ khóa tìm kiếm Shopee rõ ràng.
- Tiếng Việt tự nhiên, phù hợp social-commerce, không spam.

Cấu trúc JSON bắt buộc:
{
  "campaign_title": string,
  "campaign_goal": string,
  "target_customers": string,
  "content_angles": string[],
  "product_opportunities": [
    {
      "product_keyword": string,
      "category": string,
      "reason": string,
      "target_customer": string,
      "pain_point": string,
      "expected_content_angle": string,
      "suggested_price_range": string,
      "search_keywords": string[],
      "priority": "high" | "medium" | "low"
    }
  ],
  "posting_plan": { "days": number, "posts_per_day": number, "suggested_windows": string[] },
  "creative_direction": { "template": "CLEAN" | "DEAL" | "LIFESTYLE", "tone": string, "notes": string }
}`;

function buildUserPrompt(input: CampaignPlanInput): string {
  return [
    `Mục tiêu chiến dịch: ${input.objective}`,
    `Số ngày: ${input.days}`,
    `Số bài/ngày: ${input.posts_per_day}`,
    input.priority_group ? `Nhóm sản phẩm ưu tiên: ${input.priority_group}` : "Nhóm sản phẩm ưu tiên: (không chỉ định, hãy tự chọn ngách tốt)",
    input.target_customer ? `Tệp khách hàng: ${input.target_customer}` : "Tệp khách hàng: (tự xác định)",
    "",
    "Hãy trả về JSON kế hoạch chiến dịch theo đúng cấu trúc.",
  ].join("\n");
}

/** Trích object JSON đầu tiên từ chuỗi AI trả về. */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const obj = JSON.parse(candidate.slice(start, end + 1));
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
}

function normalizeOpportunities(v: unknown): ProductOpportunity[] {
  if (!Array.isArray(v)) return [];
  const out: ProductOpportunity[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const keyword = asString(o.product_keyword);
    if (!keyword) continue;
    out.push({
      product_keyword: keyword.slice(0, 120),
      category: asString(o.category) || null,
      reason: asString(o.reason) || null,
      target_customer: asString(o.target_customer) || null,
      pain_point: asString(o.pain_point) || null,
      expected_content_angle: asString(o.expected_content_angle) || null,
      suggested_price_range: asString(o.suggested_price_range) || null,
      search_keywords: asStringArray(o.search_keywords).slice(0, 6),
      priority: asString(o.priority).toLowerCase() || "medium",
    });
  }
  return out.slice(0, 12);
}

function normalizePlan(obj: Record<string, unknown>, input: CampaignPlanInput): CampaignPlanResult | null {
  const opportunities = normalizeOpportunities(obj.product_opportunities);
  if (opportunities.length === 0) return null;
  const planObj = obj.posting_plan && typeof obj.posting_plan === "object" ? (obj.posting_plan as Record<string, unknown>) : {};
  const creative = obj.creative_direction && typeof obj.creative_direction === "object" ? (obj.creative_direction as Record<string, unknown>) : {};
  const windows = asStringArray(planObj.suggested_windows);
  return {
    campaign_title: asString(obj.campaign_title, `Chiến dịch: ${input.objective}`).slice(0, 160),
    campaign_goal: asString(obj.campaign_goal, input.objective).slice(0, 600),
    target_customers: asString(obj.target_customers, input.target_customer ?? "Người tiêu dùng phổ thông").slice(0, 400),
    content_angles: asStringArray(obj.content_angles).slice(0, 8),
    product_opportunities: opportunities,
    posting_plan: {
      days: Math.max(1, Math.round(Number(planObj.days) || input.days)),
      posts_per_day: Math.max(1, Math.round(Number(planObj.posts_per_day) || input.posts_per_day)),
      suggested_windows: windows.length > 0 ? windows.slice(0, 6) : ["09:00", "12:30", "20:30"],
    },
    creative_direction: {
      template: asString(creative.template).toUpperCase() || "CLEAN",
      tone: asString(creative.tone) || "thân thiện, đáng tin",
      notes: asString(creative.notes) || "Ưu tiên ảnh sản phẩm thật, overlay gọn bằng code.",
    },
  };
}

const SEED_OPPORTUNITIES: ProductOpportunity[] = [
  { product_keyword: "khăn lau bếp đa năng", category: "Nhà bếp", reason: "Tiêu dùng nhanh, mua lặp lại", target_customer: "Nội trợ, mẹ bỉm", pain_point: "Bếp dầu mỡ khó lau", expected_content_angle: "Mẹo dọn bếp 30 giây", suggested_price_range: "20.000 - 60.000đ", search_keywords: ["khăn lau bếp", "khăn lau đa năng"], priority: "high" },
  { product_keyword: "hộp đựng thực phẩm trữ đông", category: "Nhà bếp", reason: "Nhu cầu trữ đồ ăn cao", target_customer: "Gia đình bận rộn", pain_point: "Tủ lạnh lộn xộn", expected_content_angle: "Sắp xếp tủ lạnh gọn gàng", suggested_price_range: "50.000 - 150.000đ", search_keywords: ["hộp đựng thực phẩm", "hộp trữ đông"], priority: "high" },
  { product_keyword: "đèn ngủ cảm biến chuyển động", category: "Gia dụng", reason: "Tiện ích, giá rẻ, dễ viral", target_customer: "Hộ gia đình, người thuê trọ", pain_point: "Dậy đêm tối phải bật đèn", expected_content_angle: "Tiện ích nhỏ thay đổi thói quen", suggested_price_range: "60.000 - 180.000đ", search_keywords: ["đèn ngủ cảm biến", "đèn cảm biến chuyển động"], priority: "medium" },
  { product_keyword: "giá kẹp điện thoại để bàn", category: "Phụ kiện", reason: "Phụ kiện phổ thông, biên độ cao", target_customer: "Dân văn phòng, học sinh", pain_point: "Xem video mỏi tay", expected_content_angle: "Setup bàn làm việc gọn", suggested_price_range: "30.000 - 120.000đ", search_keywords: ["giá đỡ điện thoại", "kẹp điện thoại để bàn"], priority: "medium" },
  { product_keyword: "túi đựng đồ du lịch chống nước", category: "Du lịch", reason: "Theo mùa, dễ bán combo", target_customer: "Người đi du lịch, sinh viên", pain_point: "Đồ đạc lộn xộn khi đi xa", expected_content_angle: "Checklist sắp đồ đi chơi", suggested_price_range: "40.000 - 150.000đ", search_keywords: ["túi du lịch chống nước", "túi đựng đồ"], priority: "medium" },
  { product_keyword: "bình giữ nhiệt mini cầm tay", category: "Đời sống", reason: "Bán quanh năm, dễ ra đơn", target_customer: "Dân văn phòng, gym", pain_point: "Nước nguội nhanh", expected_content_angle: "Giữ nhiệt 8 tiếng", suggested_price_range: "80.000 - 250.000đ", search_keywords: ["bình giữ nhiệt", "bình giữ nhiệt mini"], priority: "low" },
];

function mockPlan(input: CampaignPlanInput): CampaignPlanResult {
  return {
    campaign_title: `Chiến dịch ${input.objective} (${input.days} ngày)`,
    campaign_goal: input.objective,
    target_customers: input.target_customer ?? "Người tiêu dùng phổ thông quan tâm tiện ích & giá tốt",
    content_angles: ["Deal nhanh trong ngày", "Mẹo dùng thực tế", "Review thật", "Giải quyết nỗi đau cụ thể"],
    product_opportunities: input.priority_group
      ? SEED_OPPORTUNITIES.map((o) => ({ ...o, category: input.priority_group ?? o.category }))
      : SEED_OPPORTUNITIES,
    posting_plan: {
      days: input.days,
      posts_per_day: input.posts_per_day,
      suggested_windows: ["09:00", "12:30", "20:30"],
    },
    creative_direction: {
      template: "CLEAN",
      tone: "thân thiện, đáng tin",
      notes: "Ưu tiên ảnh sản phẩm thật từ Shopee; overlay/sticker render bằng code; tránh chữ do AI vẽ.",
    },
  };
}

/** Sinh kế hoạch chiến dịch. Mock-safe, không throw. */
export async function generateCampaignPlan(input: CampaignPlanInput): Promise<CampaignPlanResult> {
  const provider = getAIProvider();
  if (provider === "mock") return mockPlan(input);

  try {
    const { apiKey, baseURL, model } = resolveProviderConfig(provider);
    const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    const completion = (await Promise.race([
      client.chat.completions.create({
        model,
        temperature: 0.6,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input) },
        ],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), PLAN_TIMEOUT_MS)),
    ])) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = completion.choices?.[0]?.message?.content ?? "";
    const obj = extractJsonObject(raw);
    const plan = obj ? normalizePlan(obj, input) : null;
    return plan ?? mockPlan(input);
  } catch {
    return mockPlan(input);
  }
}
