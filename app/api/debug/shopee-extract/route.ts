import { NextResponse } from "next/server";

import { extractShopeeProductImages } from "@/lib/shopee/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Debug: GET /api/debug/shopee-extract?url=...
 * Trả diagnostics + ảnh tìm được. Production yêu cầu Bearer CRON_SECRET.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }
  const url = new URL(request.url).searchParams.get("url");
  if (!url) {
    return NextResponse.json({ ok: false, error: "Thiếu ?url=" }, { status: 400 });
  }
  const result = await extractShopeeProductImages(url);
  return NextResponse.json({
    ok: result.ok,
    product_name: result.product_name,
    image_urls: result.image_urls,
    diagnostics: result.diagnostics,
  });
}
