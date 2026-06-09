import { NextResponse } from "next/server";

import {
  generateAffiliateCaption,
  getAIProvider,
  type ProductInput,
} from "@/lib/ai/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * POST /api/ai/test
 * Test sinh caption Affiliate qua provider hiện tại.
 * Key AI chỉ được dùng phía server (trong generateAffiliateCaption).
 */
export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Body request không phải JSON hợp lệ." },
        { status: 400 },
      );
    }

    const b = (body ?? {}) as Record<string, unknown>;

    const product_name = readString(b.product_name);
    const affiliate_link = readString(b.affiliate_link);

    if (!product_name) {
      return NextResponse.json(
        { ok: false, error: "Tên sản phẩm là bắt buộc." },
        { status: 400 },
      );
    }
    if (!affiliate_link) {
      return NextResponse.json(
        { ok: false, error: "Link affiliate là bắt buộc." },
        { status: 400 },
      );
    }
    if (!/^https?:\/\//i.test(affiliate_link)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Link affiliate phải bắt đầu bằng http:// hoặc https://",
        },
        { status: 400 },
      );
    }

    const product: ProductInput = {
      product_name,
      affiliate_link,
      price_note: readString(b.price_note),
      target_customer: readString(b.target_customer),
      product_angle: readString(b.product_angle),
      image_url: readString(b.image_url),
    };

    const provider = getAIProvider();
    const data = await generateAffiliateCaption(product);

    return NextResponse.json({ ok: true, provider, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
