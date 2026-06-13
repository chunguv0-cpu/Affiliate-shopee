import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Debug: liệt kê các model mà V98 (key ảnh) hỗ trợ -> để chọn V98_IMAGE_MODEL hợp lệ.
 * Gọi GET {V98_IMAGE_BASE_URL}/models bằng V98 Image Key (fallback key chung).
 * KHÔNG lộ API key. Production yêu cầu Bearer CRON_SECRET.
 * GET /api/debug/v98-models[?image=1|0]   image=1 (mặc định) dùng key ảnh; image=0 dùng key prompt.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }
  const useImage = new URL(request.url).searchParams.get("image") !== "0";
  const apiKey = useImage
    ? process.env.V98_IMAGE_API_KEY?.trim() || process.env.V98_API_KEY?.trim()
    : process.env.V98_PROMPT_API_KEY?.trim() || process.env.V98_API_KEY?.trim();
  const baseURL = useImage
    ? process.env.V98_IMAGE_BASE_URL?.trim() || process.env.V98_BASE_URL?.trim()
    : process.env.V98_PROMPT_BASE_URL?.trim() || process.env.V98_BASE_URL?.trim();
  const currentImageModel = process.env.V98_IMAGE_MODEL?.trim() || "nano-banana-2";

  if (!apiKey || !baseURL) {
    return NextResponse.json(
      { ok: false, error: `Thiếu ${useImage ? "V98_IMAGE_API_KEY/BASE_URL" : "V98_PROMPT_API_KEY/BASE_URL"} (hoặc V98_API_KEY/BASE_URL).` },
      { status: 500 },
    );
  }

  const endpoint = `${baseURL.replace(/\/$/, "")}/models`;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await res.text();
    let body: unknown = text.slice(0, 2000);
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }

    // Cố gắng rút danh sách id model + lọc model có vẻ là model ảnh.
    const list = body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
      ? ((body as { data: Array<Record<string, unknown>> }).data)
      : [];
    const allIds = list.map((m) => String(m.id ?? m.model ?? "")).filter(Boolean).sort();
    const imageLike = allIds.filter((id) =>
      /image|dall|flux|banana|sd|stable|midjourney|imagen|seedream|kontext|qwen-image|grok-2-image/i.test(id),
    );

    return NextResponse.json({
      ok: res.ok,
      endpoint,
      httpStatus: res.status,
      ms: Date.now() - started,
      currentImageModel,
      modelCount: allIds.length,
      imageModelCandidates: imageLike,
      allModels: allIds,
      hint: "Đặt V98_IMAGE_MODEL = 1 trong imageModelCandidates (hoặc allModels) rồi deploy lại.",
      ...(res.ok ? {} : { raw: body }),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      endpoint,
      error: err instanceof Error ? (err.name === "AbortError" ? "Quá thời gian (20s)." : err.message) : "fetch error",
      ms: Date.now() - started,
    });
  } finally {
    clearTimeout(timer);
  }
}
