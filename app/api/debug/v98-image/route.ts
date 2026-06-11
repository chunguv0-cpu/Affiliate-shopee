import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Debug: gọi THẲNG endpoint ảnh V98 (1 lần, không retry) để xem raw status + body.
 * Giúp phân biệt 429 do rate-limit hay do hết quota/không hỗ trợ model.
 * GET /api/debug/v98-image?prompt=...   (production cần Bearer CRON_SECRET)
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }
  const apiKey = process.env.V98_API_KEY?.trim();
  const baseURL = process.env.V98_BASE_URL?.trim();
  const model = process.env.V98_IMAGE_MODEL?.trim() || "gpt-image-2";
  if (!apiKey || !baseURL) {
    return NextResponse.json({ ok: false, error: "Thiếu V98_API_KEY / V98_BASE_URL." }, { status: 500 });
  }
  const prompt = new URL(request.url).searchParams.get("prompt") || "a simple red apple on a white table, product photo";

  const endpoint = `${baseURL.replace(/\/$/, "")}/images/generations`;
  const started = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024" }),
    });
    const text = await res.text();
    let body: unknown = text.slice(0, 1500);
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    return NextResponse.json({
      ok: res.ok,
      endpoint,
      model,
      httpStatus: res.status,
      ms: Date.now() - started,
      // ẩn ảnh base64 to nếu có
      body: redact(body),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      endpoint,
      model,
      error: err instanceof Error ? err.message : "fetch error",
      ms: Date.now() - started,
    });
  }
}

function redact(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const o = body as Record<string, unknown>;
  if (Array.isArray(o.data)) {
    o.data = (o.data as Array<Record<string, unknown>>).map((d) => ({
      ...d,
      b64_json: d.b64_json ? `[b64 ${String(d.b64_json).length} chars]` : undefined,
    }));
  }
  return o;
}
