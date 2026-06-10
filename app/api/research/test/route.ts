import { NextResponse } from "next/server";

import { getSearchProvider, searchWeb } from "@/lib/research/search-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/research/test — test search provider (trả tối đa 3 kết quả).
 * Không trả/đụng API key.
 */
export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Body không phải JSON hợp lệ." }, { status: 400 });
    }
    const q = typeof (body as { query?: unknown })?.query === "string"
      ? (body as { query: string }).query.trim()
      : "";
    if (!q) {
      return NextResponse.json({ ok: false, error: "Thiếu query." }, { status: 400 });
    }

    const results = await searchWeb(q, { maxResults: 3 });
    return NextResponse.json({
      ok: true,
      provider: getSearchProvider(),
      results: results.slice(0, 3).map((r) => ({ title: r.title, url: r.url, snippet: r.snippet })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
