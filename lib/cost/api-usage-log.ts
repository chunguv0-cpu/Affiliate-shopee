import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * HOTFIX — log mỗi lần gọi (hoặc bị chặn) API ảnh.
 * TUYỆT ĐỐI KHÔNG log API key/secret/cookie. Chỉ log provider/model/endpoint/context.
 * KHÔNG bao giờ throw — log lỗi sẽ không làm hỏng việc sinh ảnh.
 */
export type ImageApiUsageInput = {
  provider: string;          // vd v98_image | openai | grok_gateway | mock
  model?: string | null;
  keyType?: string | null;   // vd image | prompt
  callType: string;          // vd image_generation | image_generation_blocked
  endpoint?: string | null;
  context?: Record<string, unknown> | null;
  success: boolean;
  errorMessage?: string | null;
};

/** Loại bỏ mọi field nhạy cảm khỏi context trước khi lưu (phòng hờ). */
function sanitizeContext(context: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!context || typeof context !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    if (/key|secret|token|cookie|authorization|password|bearer/i.test(k)) continue;
    if (typeof v === "string" && v.length > 300) continue;
    out[k] = v;
  }
  return out;
}

export async function logImageApiUsage(input: ImageApiUsageInput): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    await supabase.from("api_usage_logs").insert({
      provider: input.provider,
      model: input.model ?? null,
      key_type: input.keyType ?? null,
      call_type: input.callType,
      endpoint: input.endpoint ?? null,
      context: sanitizeContext(input.context),
      success: input.success,
      error_message: input.errorMessage ? String(input.errorMessage).slice(0, 500) : null,
    });
  } catch {
    /* Bảng có thể chưa migrate hoặc DB lỗi — bỏ qua, không chặn sinh ảnh. */
  }
}

/**
 * HOTFIX — log lượt gọi TEXT (caption/vision/overlay/phân tích) để thấy rõ:
 * text dùng key nào (prompt vs fallback chung) + model gì + có đang ăn key ảnh không.
 * KHÔNG log API key. KHÔNG throw.
 */
export async function logTextApiUsage(input: {
  model?: string | null;
  step: string; // vd caption | bundle | vision | overlay | infer
  success: boolean;
  errorMessage?: string | null;
}): Promise<void> {
  // Xác định text đang dùng key nào (KHÔNG log giá trị key, chỉ loại).
  const hasPromptKey = !!process.env.V98_PROMPT_API_KEY?.trim();
  const sharedKey = process.env.V98_API_KEY?.trim();
  const imageKey = process.env.V98_IMAGE_API_KEY?.trim();
  const keyType = hasPromptKey
    ? "prompt"
    : sharedKey && imageKey && sharedKey === imageKey
      ? "shared_eq_image" // CẢNH BÁO: text đang trừ vào key ảnh
      : "shared";
  await logImageApiUsage({
    provider: "v98_prompt",
    model: input.model ?? null,
    keyType,
    callType: "text_generation",
    endpoint: null,
    context: { step: input.step },
    success: input.success,
    errorMessage: input.errorMessage ?? null,
  });
}

export type ImageUsageSummary = {
  available: boolean;
  todayCount: number;
  todayBlocked: number;
  lastCall: { endpoint: string | null; context: Record<string, unknown> | null; success: boolean; created_at: string } | null;
  lastBlocked: { context: Record<string, unknown> | null; error_message: string | null; created_at: string } | null;
};

function startOfTodayUtcIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

/** Đọc tóm tắt usage API ảnh hôm nay cho tab V98 Image Key. KHÔNG throw. */
export async function readImageUsageSummary(): Promise<ImageUsageSummary> {
  const empty: ImageUsageSummary = { available: false, todayCount: 0, todayBlocked: 0, lastCall: null, lastBlocked: null };
  try {
    const supabase = createSupabaseAdminClient();
    const since = startOfTodayUtcIso();

    const { count: todayCount, error: e1 } = await supabase
      .from("api_usage_logs")
      .select("id", { count: "exact", head: true })
      .eq("call_type", "image_generation")
      .eq("success", true)
      .gte("created_at", since);
    if (e1) return empty;

    const { count: todayBlocked } = await supabase
      .from("api_usage_logs")
      .select("id", { count: "exact", head: true })
      .eq("call_type", "image_generation_blocked")
      .gte("created_at", since);

    const { data: lastCallRows } = await supabase
      .from("api_usage_logs")
      .select("endpoint, context, success, created_at")
      .eq("call_type", "image_generation")
      .order("created_at", { ascending: false })
      .limit(1);

    const { data: lastBlockedRows } = await supabase
      .from("api_usage_logs")
      .select("context, error_message, created_at")
      .eq("call_type", "image_generation_blocked")
      .order("created_at", { ascending: false })
      .limit(1);

    const lc = (lastCallRows ?? [])[0] as
      | { endpoint: string | null; context: Record<string, unknown> | null; success: boolean; created_at: string }
      | undefined;
    const lb = (lastBlockedRows ?? [])[0] as
      | { context: Record<string, unknown> | null; error_message: string | null; created_at: string }
      | undefined;

    return {
      available: true,
      todayCount: todayCount ?? 0,
      todayBlocked: todayBlocked ?? 0,
      lastCall: lc ?? null,
      lastBlocked: lb ?? null,
    };
  } catch {
    return empty;
  }
}
