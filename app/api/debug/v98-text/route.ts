import { NextResponse } from "next/server";

import OpenAI from "openai";

import { getAIProvider } from "@/lib/ai/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Debug: gọi THẬT 1 lần V98 TEXT bằng Prompt key + text model -> xem chạy được hay lỗi gì.
 * Giúp phân biệt: đang mock (AI_PROVIDER!=v98) HAY v98 nhưng model/key text sai -> rơi mock.
 * KHÔNG lộ API key. Production cần Bearer CRON_SECRET.
 * GET /api/debug/v98-text
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  let resolvedAi = "(lỗi)";
  try {
    resolvedAi = getAIProvider();
  } catch (e) {
    resolvedAi = e instanceof Error ? `(lỗi: ${e.message})` : "(lỗi)";
  }

  const apiKey = process.env.V98_PROMPT_API_KEY?.trim() || process.env.V98_API_KEY?.trim();
  const baseURL = process.env.V98_PROMPT_BASE_URL?.trim() || process.env.V98_BASE_URL?.trim();
  const model = process.env.V98_PROMPT_MODEL?.trim() || process.env.V98_MODEL?.trim();

  const missing: string[] = [];
  if (!apiKey) missing.push("V98_PROMPT_API_KEY (hoặc V98_API_KEY)");
  if (!baseURL) missing.push("V98_PROMPT_BASE_URL (hoặc V98_BASE_URL)");
  if (!model) missing.push("V98_PROMPT_MODEL (hoặc V98_MODEL)");
  if (missing.length > 0) {
    return NextResponse.json({
      ok: false,
      ai_provider_resolved: resolvedAi,
      text_dung_v98: resolvedAi === "v98",
      error: `Thiếu cấu hình text: ${missing.join(", ")} -> TEXT sẽ chạy mock.`,
      missing,
    });
  }

  const started = Date.now();
  try {
    const client = new OpenAI({ apiKey: apiKey as string, baseURL });
    const completion = await client.chat.completions.create({
      model: model as string,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Bạn trả lời đúng JSON." },
        { role: "user", content: 'Trả về đúng JSON: {"ping":"pong"}' },
      ],
    });
    const reply = completion.choices[0]?.message?.content ?? "";
    return NextResponse.json({
      ok: true,
      ai_provider_resolved: resolvedAi,
      text_dung_v98: resolvedAi === "v98",
      model_da_gui: model,
      ms: Date.now() - started,
      reply: typeof reply === "string" ? reply.slice(0, 500) : reply,
      ket_luan:
        resolvedAi === "v98"
          ? "✅ V98 TEXT chạy OK. Nếu bài vẫn mock: do AI_PROVIDER chưa phải v98 (xem ai_provider_resolved) hoặc deploy chưa cập nhật."
          : `⚠️ Gọi V98 OK nhưng ai_provider_resolved='${resolvedAi}' -> app vẫn dùng ${resolvedAi} cho bài. Đặt AI_PROVIDER=v98.`,
    });
  } catch (err) {
    const e = err as { status?: number; message?: string; name?: string };
    return NextResponse.json({
      ok: false,
      ai_provider_resolved: resolvedAi,
      text_dung_v98: resolvedAi === "v98",
      model_da_gui: model,
      ms: Date.now() - started,
      httpStatus: e?.status ?? null,
      error: e?.message ? String(e.message).slice(0, 400) : "V98 text call failed.",
      ket_luan:
        "🔴 V98 TEXT GỌI LỖI -> app tự rơi về mock (caption mẫu, Prompt key không bị trừ). " +
        "Thường do model text sai (đổi V98_PROMPT_MODEL, xem /api/debug/v98-models?image=0) hoặc key/base sai.",
    });
  }
}
