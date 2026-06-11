import { NextResponse } from "next/server";

import {
  extractShopeeImagesWithBrowser,
  getShopeeImageSourceProvider,
  isBrowserExtractConfigured,
} from "@/lib/shopee/browser-extract";
import { extractShopeeProductImages } from "@/lib/shopee/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Debug: GET /api/debug/shopee-extract?url=...&useBrowser=1
 * Production yêu cầu Bearer CRON_SECRET.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }
  const sp = new URL(request.url).searchParams;
  const url = sp.get("url");
  const useBrowser = sp.get("useBrowser") === "1";
  if (!url) return NextResponse.json({ ok: false, error: "Thiếu ?url=" }, { status: 400 });

  const server = await extractShopeeProductImages(url);
  const diagnostics: Record<string, unknown> = {
    ...server.diagnostics,
    imageSourceProvider: getShopeeImageSourceProvider(),
  };
  let images = server.image_urls;

  if (useBrowser) {
    if (!isBrowserExtractConfigured()) {
      return NextResponse.json({
        ok: false,
        error: "Browser extractor is not configured. Set SHOPEE_IMAGE_SOURCE_PROVIDER=browserless and BROWSERLESS_* env.",
        diagnostics,
      });
    }
    const b = await extractShopeeImagesWithBrowser(server.diagnostics.finalUrl ?? url);
    diagnostics.browserExtractionTried = true;
    diagnostics.browserExtractionStatus = b.status;
    diagnostics.browserExtractionError = b.error;
    diagnostics.browserImageCandidatesCount = b.candidatesCount;
    diagnostics.browserValidImagesCount = b.validCount;
    if (b.ok && b.image_urls.length > 0) images = b.image_urls;
  }

  diagnostics.firstValidImages = images.slice(0, 5);
  return NextResponse.json({
    ok: images.length > 0,
    product_name: server.product_name,
    image_urls: images,
    diagnostics,
  });
}
