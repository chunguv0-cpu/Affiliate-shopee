import { NextResponse } from "next/server";

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
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  const promptKey = process.env.V98_PROMPT_API_KEY?.trim();
  const imageKey = process.env.V98_IMAGE_API_KEY?.trim();
  const sharedKey = process.env.V98_API_KEY?.trim();

  // Resolve y hệt code thật.
  const textKey = promptKey || sharedKey || "";
  const textBase = process.env.V98_PROMPT_BASE_URL?.trim() || process.env.V98_BASE_URL?.trim() || "";
  const textModel = process.env.V98_PROMPT_MODEL?.trim() || process.env.V98_MODEL?.trim() || "(THIẾU — sẽ lỗi)";
  const imgKey = imageKey || sharedKey || "";
  const imgBase = process.env.V98_IMAGE_BASE_URL?.trim() || process.env.V98_BASE_URL?.trim() || "";
  const imgModel = process.env.V98_IMAGE_MODEL?.trim() || "nano-banana-2";

  const warnings: string[] = [];
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
  if (textModel.startsWith("(THIẾU")) {
    warnings.push("⚠️ Thiếu V98_PROMPT_MODEL/V98_MODEL → sinh text sẽ lỗi.");
  }
  warnings.push("ℹ️ Nếu V98 vẫn dùng model 'qwen' dù bạn đặt V98_IMAGE_MODEL: model đó V98 không hỗ trợ -> server tự đổi. Xem /api/debug/v98-models để chọn model hợp lệ.");

  return NextResponse.json({
    ok: true,
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
    ai_provider: process.env.AI_PROVIDER?.trim() || "(mock)",
    warnings,
  });
}
