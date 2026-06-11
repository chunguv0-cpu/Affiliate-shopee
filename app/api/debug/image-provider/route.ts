import { NextResponse } from "next/server";

import { getImageProviderConfig } from "@/lib/creative/image-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chẩn đoán cấu hình provider ảnh (an toàn — KHÔNG lộ API key).
 * GET /api/debug/image-provider
 */
export async function GET() {
  const cfg = getImageProviderConfig();
  return NextResponse.json({
    provider: cfg.provider,
    hasV98Key: cfg.hasV98Key,
    v98BaseUrlExists: Boolean(cfg.v98BaseUrl),
    imageModel: cfg.imageModel,
    isConfigured: cfg.isConfigured,
    errors: cfg.errors,
  });
}
