import { NextResponse } from "next/server";

import { getAIProvider } from "@/lib/ai/client";
import { debugAuthorized } from "@/lib/debug/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Debug: phơi bày CHÍNH XÁC key/model mà từng đường (TEXT vs IMAGE) đang dùng,
 * để biết vì sao key ảnh bị trừ / prompt key không dùng / model không đúng.
 * KHÔNG lộ API key (chỉ mask đuôi 4 ký tự + độ dài). Production cần Bearer CRON_SECRET.
 * GET /api/debug/v98-config
 */
function mask(v: string | undefined | null): { set: boolean; tail: string; len: number } {
  const s = (v ?? "").trim();
  if (!s) return { set: false, tail: "", len: 0 };
  return { set: true, tail: s.length >= 4 ? s.slice(-4) : "***", len: s.length };
}

export async function GET(request: Request) {
  if (!debugAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized — thêm ?key=<CRON_SECRET> vào URL." }, { status: 401 });
  }

  const promptKey = process.env.V98_PROMPT_API_KEY?.trim();
  const imageKey = process.env.V98_IMAGE_API_KEY?.trim();
  const sharedKey = process.env.V98_API_KEY?.trim();

  // Resolve y hệt code thật.
  const textKey = promptKey || sharedKey || "";
  const textBase =
    process.env.V98_PROMPT_BASE_URL?.trim() ||
    process.env.V98_BASE_URL?.trim() ||
    process.env.V98_IMAGE_BASE_URL?.trim() ||
    "";
  const textModelEnvSet = !!(process.env.V98_PROMPT_MODEL?.trim() || process.env.V98_MODEL?.trim());
  const textModel = process.env.V98_PROMPT_MODEL?.trim() || process.env.V98_MODEL?.trim() || "gemini-2.5-flash (mặc định)";
  const imgKey = imageKey || sharedKey || "";
  const imgBase = process.env.V98_IMAGE_BASE_URL?.trim() || process.env.V98_BASE_URL?.trim() || "";
  const imgModel = process.env.V98_IMAGE_MODEL?.trim() || "nano-banana-2";

  // Provider TEXT thực tế đang chạy (sau auto-detect). Nếu != v98 -> Prompt key KHÔNG được dùng.
  let resolvedAi = "(lỗi)";
  try {
    resolvedAi = getAIProvider();
  } catch (e) {
    resolvedAi = e instanceof Error ? `(lỗi: ${e.message})` : "(lỗi)";
  }

  const warnings: string[] = [];
  if (resolvedAi !== "v98") {
    warnings.push(`🔴 TEXT đang chạy '${resolvedAi}' (KHÔNG phải v98) → Prompt key KHÔNG hề bị trừ tiền vì text không gọi V98. Hãy đặt AI_PROVIDER=v98 + V98_PROMPT_API_KEY/V98_PROMPT_MODEL rồi Redeploy. (Điểm AI luôn 85 = dấu hiệu đang chạy mock.)`);
  }
  // Text đang dùng key nào?
  const textUsesPromptKey = !!promptKey;
  if (!promptKey) {
    warnings.push("⚠️ Chưa đặt V98_PROMPT_API_KEY → TEXT đang fallback sang V98_API_KEY.");
  }
  // Nguy hiểm: text fallback trùng key ảnh -> mọi text trừ vào key ảnh.
  if (!promptKey && sharedKey && imageKey && sharedKey === imageKey) {
    warnings.push("🔴 V98_API_KEY TRÙNG V98_IMAGE_API_KEY → TEXT (vision+caption+overlay, ~3 lượt/bài) đang TRỪ TIỀN vào KEY ẢNH. Hãy đặt V98_PROMPT_API_KEY = key text riêng.");
  }
  if (!promptKey && sharedKey && !imageKey) {
    warnings.push("⚠️ Chỉ có V98_API_KEY (1 key dùng chung text + ảnh) → không tách được chi phí. Nên đặt V98_PROMPT_API_KEY và V98_IMAGE_API_KEY riêng.");
  }
  if (textKey && imgKey && textKey === imgKey) {
    warnings.push("🔴 TEXT và IMAGE đang dùng CÙNG một key → mọi chi phí dồn vào 1 key.");
  }
  if (!textModelEnvSet) {
    warnings.push("ℹ️ Chưa đặt V98_PROMPT_MODEL/V98_MODEL → text dùng mặc định 'gemini-2.5-flash'. Nếu V98 của bạn KHÔNG hỗ trợ model này, hãy đặt V98_PROMPT_MODEL = model text hợp lệ (xem /api/debug/v98-models?image=0).");
  }
  if (!textBase) {
    warnings.push("🔴 Thiếu cả V98_PROMPT_BASE_URL / V98_BASE_URL / V98_IMAGE_BASE_URL → TEXT không gọi được V98 -> rơi mock. Hãy đặt V98_PROMPT_BASE_URL.");
  }
  warnings.push("ℹ️ Test text trực tiếp: /api/debug/v98-text. Nếu lỗi -> đó là lý do bài bị 'Mock mode'. Test ảnh: /api/debug/v98-models.");

  return NextResponse.json({
    ok: true,
    // Dấu phiên bản: nếu KHÔNG thấy field này -> Vercel đang chạy CODE CŨ, cần redeploy.
    build_marker: "hotfix-v13-debug-query-key-auth",
    TEXT: {
      duong: "caption / vision / overlay / phân tích",
      key_dang_dung: textUsesPromptKey ? "V98_PROMPT_API_KEY" : sharedKey ? "V98_API_KEY (fallback)" : "(THIẾU)",
      key_mask: mask(textKey),
      base_url_set: !!textBase,
      model: textModel,
    },
    IMAGE: {
      duong: "sinh ảnh AI (hero)",
      key_dang_dung: imageKey ? "V98_IMAGE_API_KEY" : sharedKey ? "V98_API_KEY (fallback)" : "(THIẾU)",
      key_mask: mask(imgKey),
      base_url_set: !!imgBase,
      model_gui_di: imgModel,
    },
    keys: {
      V98_PROMPT_API_KEY: mask(promptKey),
      V98_IMAGE_API_KEY: mask(imageKey),
      V98_API_KEY: mask(sharedKey),
      prompt_khac_image: !!promptKey && !!imageKey && promptKey !== imageKey,
    },
    image_provider: process.env.IMAGE_PROVIDER?.trim() || "(auto)",
    ai_provider_env: process.env.AI_PROVIDER?.trim() || "(chưa đặt)",
    ai_provider_resolved: resolvedAi,
    text_dung_v98: resolvedAi === "v98",
    warnings,
  });
}
