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
  preferred_price_range?: string | null;
  avoid_products?: string | null;
  /** Phase 20 — tránh lặp sản phẩm/nhóm đã dùng gần đây. */
  excluded_recent_products?: string[];
  already_used_categories?: string[];
};

const NOVELTY_WINDOW_DAYS = (() => {
  const raw = process.env.PRODUCT_NOVELTY_WINDOW_DAYS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.max(1, n) : 30;
})();

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
- product_opportunities: 5-8 cơ hội sản phẩm CỤ THỂ. product_keyword phải là tên sản phẩm cụ thể có thể search Shopee ra đúng món, KHÔNG dùng cụm rộng như "đồ công nghệ", "đồ gia dụng", "sản phẩm hot", "tiện ích", "phụ kiện".
  * TỐT: "đèn cảm biến chuyển động gắn tủ", "máy xay mini sạc USB", "giá đỡ điện thoại gấp gọn", "máy hút bụi mini bàn làm việc", "túi hút chân không quần áo", "lưới lọc cống chống mùi", "hộp đựng thực phẩm có ron kín".
  * XẤU: "đồ công nghệ", "đồ gia dụng", "phụ kiện nhà cửa".
- search_keywords cho mỗi cơ hội cũng phải cụ thể (2-4 từ khóa).
- KHÔNG lặp lại các sản phẩm đã dùng trong ${NOVELTY_WINDOW_DAYS} ngày qua (xem danh sách loại trừ), trừ khi có lý do rất mạnh. Ưu tiên ý tưởng MỚI/khác nhóm đã dùng.
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
  const excluded = (input.excluded_recent_products ?? []).slice(0, 40);
  const usedCats = (input.already_used_categories ?? []).slice(0, 20);
  return [
    `Mục tiêu chiến dịch: ${input.objective}`,
    `Số ngày: ${input.days}`,
    `Số bài/ngày: ${input.posts_per_day}`,
    input.priority_group ? `Nhóm sản phẩm ưu tiên: ${input.priority_group}` : "Nhóm sản phẩm ưu tiên: (không chỉ định, hãy tự chọn ngách tốt)",
    input.target_customer ? `Tệp khách hàng: ${input.target_customer}` : "Tệp khách hàng: (tự xác định)",
    input.preferred_price_range ? `Mức giá mong muốn: ${input.preferred_price_range}` : "Mức giá mong muốn: (linh hoạt theo sản phẩm)",
    input.avoid_products ? `Loại sản phẩm muốn tránh: ${input.avoid_products}` : "Loại sản phẩm muốn tránh: (không chỉ định)",
    "",
    excluded.length > 0
      ? `Sản phẩm/ý tưởng ĐÃ DÙNG gần đây (TRÁNH lặp lại): ${excluded.join("; ")}`
      : "Sản phẩm đã dùng gần đây: (chưa có)",
    usedCats.length > 0 ? `Nhóm hàng đã khai thác nhiều: ${usedCats.join("; ")}` : "Nhóm hàng đã khai thác: (chưa có)",
    "",
    "Hãy đề xuất các cơ hội sản phẩm MỚI, CỤ THỂ (khác danh sách đã dùng), tôn trọng mức giá mong muốn và loại sản phẩm cần tránh. Trả về JSON theo đúng cấu trúc.",
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
  { product_keyword: "hộp đựng thực phẩm có ron kín", category: "Nhà bếp", reason: "Nhu cầu trữ đồ ăn cao", target_customer: "Gia đình bận rộn", pain_point: "Tủ lạnh lộn xộn", expected_content_angle: "Sắp xếp tủ lạnh gọn gàng", suggested_price_range: "50.000 - 150.000đ", search_keywords: ["hộp đựng thực phẩm", "hộp trữ đông ron kín"], priority: "high" },
  { product_keyword: "đèn cảm biến chuyển động gắn tủ", category: "Công nghệ", reason: "Tiện ích, giá rẻ, dễ viral", target_customer: "Hộ gia đình, người thuê trọ", pain_point: "Dậy đêm tối phải bật đèn", expected_content_angle: "Tiện ích nhỏ thay đổi thói quen", suggested_price_range: "60.000 - 180.000đ", search_keywords: ["đèn cảm biến chuyển động", "đèn led cảm biến tủ"], priority: "medium" },
  { product_keyword: "giá đỡ điện thoại gấp gọn để bàn", category: "Công nghệ", reason: "Phụ kiện phổ thông, biên độ cao", target_customer: "Dân văn phòng, học sinh", pain_point: "Xem video mỏi tay", expected_content_angle: "Setup bàn làm việc gọn", suggested_price_range: "30.000 - 120.000đ", search_keywords: ["giá đỡ điện thoại", "kẹp điện thoại để bàn"], priority: "medium" },
  { product_keyword: "túi hút chân không quần áo", category: "Sắp xếp nhà cửa", reason: "Theo mùa, dễ bán combo", target_customer: "Gia đình, người đi du lịch", pain_point: "Tủ quần áo chật", expected_content_angle: "Tiết kiệm 70% diện tích tủ", suggested_price_range: "40.000 - 150.000đ", search_keywords: ["túi hút chân không", "túi nén quần áo"], priority: "medium" },
  { product_keyword: "bình giữ nhiệt mini cầm tay", category: "Đời sống", reason: "Bán quanh năm, dễ ra đơn", target_customer: "Dân văn phòng, gym", pain_point: "Nước nguội nhanh", expected_content_angle: "Giữ nhiệt 8 tiếng", suggested_price_range: "80.000 - 250.000đ", search_keywords: ["bình giữ nhiệt", "bình giữ nhiệt mini"], priority: "low" },
  { product_keyword: "máy xay mini sạc USB", category: "Công nghệ", reason: "Tiện cho mẹ bỉm/đồ uống", target_customer: "Mẹ bỉm, dân văn phòng", pain_point: "Xay ít không tiện máy lớn", expected_content_angle: "Xay sinh tố 30 giây", suggested_price_range: "120.000 - 300.000đ", search_keywords: ["máy xay mini", "máy xay sạc usb"], priority: "high" },
  { product_keyword: "máy hút bụi mini bàn làm việc", category: "Công nghệ", reason: "Tiện ích văn phòng dễ viral", target_customer: "Dân văn phòng, học sinh", pain_point: "Bàn phím bụi bẩn", expected_content_angle: "Làm sạch bàn phím trong 1 phút", suggested_price_range: "80.000 - 200.000đ", search_keywords: ["máy hút bụi mini", "máy hút bụi bàn phím"], priority: "medium" },
  { product_keyword: "móc dán tường chịu lực", category: "Sắp xếp nhà cửa", reason: "Tiêu dùng nhanh, mua nhiều", target_customer: "Hộ gia đình, thuê trọ", pain_point: "Tường không khoan được", expected_content_angle: "Treo đồ không cần khoan", suggested_price_range: "15.000 - 60.000đ", search_keywords: ["móc dán tường", "móc treo chịu lực"], priority: "medium" },
  { product_keyword: "kệ nhà tắm dán tường", category: "Sắp xếp nhà cửa", reason: "Nhu cầu cao, dễ combo", target_customer: "Hộ gia đình", pain_point: "Nhà tắm bừa bộn", expected_content_angle: "Nhà tắm gọn trong 5 phút", suggested_price_range: "50.000 - 180.000đ", search_keywords: ["kệ nhà tắm", "kệ dán tường nhà tắm"], priority: "low" },
  { product_keyword: "lưới lọc cống chống mùi", category: "Nhà bếp", reason: "Tiêu dùng nhanh, đơn lặp lại", target_customer: "Nội trợ", pain_point: "Cống tắc, hôi", expected_content_angle: "Hết tắc cống & mùi hôi", suggested_price_range: "20.000 - 70.000đ", search_keywords: ["lưới lọc cống", "lưới lọc rác bồn rửa"], priority: "low" },
  { product_keyword: "đèn led tủ quần áo cảm biến", category: "Công nghệ", reason: "Tiện ích, dễ demo video", target_customer: "Hộ gia đình", pain_point: "Tủ tối khó tìm đồ", expected_content_angle: "Tủ quần áo tự sáng", suggested_price_range: "60.000 - 160.000đ", search_keywords: ["đèn led tủ", "đèn cảm biến tủ quần áo"], priority: "low" },
  { product_keyword: "sạc dự phòng mini", category: "Công nghệ", reason: "Phổ thông, bán quanh năm", target_customer: "Người dùng smartphone", pain_point: "Hết pin khi ra ngoài", expected_content_angle: "Bỏ túi không lo hết pin", suggested_price_range: "150.000 - 400.000đ", search_keywords: ["sạc dự phòng mini", "pin sạc dự phòng"], priority: "low" },
  { product_keyword: "dao gọt đa năng nhà bếp", category: "Nhà bếp", reason: "Tiêu dùng, dễ demo", target_customer: "Nội trợ", pain_point: "Gọt vỏ chậm", expected_content_angle: "Gọt nhanh gấp đôi", suggested_price_range: "25.000 - 90.000đ", search_keywords: ["dao gọt đa năng", "dao gọt vỏ"], priority: "low" },
];

function mockPlan(input: CampaignPlanInput): CampaignPlanResult {
  const excludedNorm = new Set((input.excluded_recent_products ?? []).map((s) => normalizeForMatch(s)));
  // Loại các seed đã dùng gần đây.
  let pool = SEED_OPPORTUNITIES.filter((o) => !excludedNorm.has(normalizeForMatch(o.product_keyword)));
  if (pool.length < 6) pool = SEED_OPPORTUNITIES; // không còn đủ -> dùng full để vẫn có gợi ý.
  // Xoay vòng để mỗi lần gợi ý ra tập khác nhau (theo số sản phẩm đã loại trừ).
  const offset = (input.excluded_recent_products?.length ?? 0) % pool.length;
  const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];
  const chosen = rotated.slice(0, Math.min(8, Math.max(6, rotated.length)));
  return {
    campaign_title: `Chiến dịch ${input.objective} (${input.days} ngày)`,
    campaign_goal: input.objective,
    target_customers: input.target_customer ?? "Người tiêu dùng phổ thông quan tâm tiện ích & giá tốt",
    content_angles: ["Deal nhanh trong ngày", "Mẹo dùng thực tế", "Review thật", "Giải quyết nỗi đau cụ thể"],
    product_opportunities: chosen,
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

function normalizeForMatch(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
