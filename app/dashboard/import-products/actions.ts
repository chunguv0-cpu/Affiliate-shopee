"use server";

import { revalidatePath } from "next/cache";

import { inferProductInfoFromAffiliateLink } from "@/lib/ai/client";
import { generateSubId, getAllowedShopeeHost } from "@/lib/affiliate";
import { insertPostingLog } from "@/lib/posts/log";
import { enrichShopeeAffiliateLink } from "@/lib/shopee/enrich";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export type ImportLinksResult =
  | { ok: true; inserted: number; skipped: number; warnings: string[]; errors: string[] }
  | { ok: false; error: string };

const MAX_LINKS = 20;
const IMPORT_ACTION = "IMPORT_AFFILIATE_LINKS_ONLY";

/**
 * Import "Affiliate Links Only": mỗi link 1 sản phẩm, AI tự suy luận thông tin.
 * KHÔNG tạo caption/campaign, KHÔNG gọi Facebook.
 */
export async function importAffiliateLinksOnly(
  links: string[],
): Promise<ImportLinksResult> {
  if (!Array.isArray(links)) {
    return { ok: false, error: "Dữ liệu không hợp lệ." };
  }

  const cleaned = links
    .map((l) => (typeof l === "string" ? l.trim() : ""))
    .filter((l) => l.length > 0);

  if (cleaned.length === 0) {
    return { ok: false, error: "Chưa có link nào để import." };
  }
  if (cleaned.length > MAX_LINKS) {
    return {
      ok: false,
      error: "Mỗi lần chỉ import tối đa 20 link để tránh quá tải.",
    };
  }

  const warnings: string[] = [];
  const errors: string[] = [];

  // Lọc link hợp lệ + bỏ trùng trong input.
  const seen = new Set<string>();
  const valid: string[] = [];
  for (const link of cleaned) {
    if (seen.has(link)) {
      warnings.push(`Bỏ qua link trùng trong danh sách: ${link}`);
      continue;
    }
    seen.add(link);
    if (!/^https?:\/\//i.test(link) || !getAllowedShopeeHost(link)) {
      errors.push(`Link không hợp lệ (chỉ nhận s.shopee.vn / shope.ee / shopee.vn): ${link}`);
      continue;
    }
    valid.push(link);
  }

  let supabase;
  try {
    supabase = createSupabaseAdminClient();
  } catch (err) {
    const m = err instanceof Error ? err.message : "Lỗi không xác định.";
    return { ok: false, error: `Không kết nối được cơ sở dữ liệu: ${m}` };
  }

  // Bỏ trùng so với DB.
  const existing = new Set<string>();
  if (valid.length > 0) {
    const { data } = await supabase
      .from("products")
      .select("affiliate_link")
      .in("affiliate_link", valid);
    for (const r of data ?? []) {
      if (r.affiliate_link) existing.add(r.affiliate_link as string);
    }
  }

  let inserted = 0;

  // Xử lý tuần tự (không spam request Shopee).
  for (const link of valid) {
    if (existing.has(link)) {
      warnings.push(`Đã tồn tại trong DB, bỏ qua: ${link}`);
      continue;
    }

    try {
      const enriched = await enrichShopeeAffiliateLink(link);
      const info = await inferProductInfoFromAffiliateLink({
        affiliate_link: link,
        resolved_url: enriched.resolved_url,
        title: enriched.title,
        description: enriched.description,
      });

      const lowConfidence = info.confidence < 60;
      const linkNote =
        `Imported from affiliate link only. AI confidence: ${info.confidence}.` +
        (lowConfidence ? " Cần kiểm tra lại thông tin sản phẩm." : "");
      if (lowConfidence) {
        warnings.push(`Confidence thấp (${info.confidence}): "${info.product_name}" — nên kiểm tra lại.`);
      }

      const { error } = await supabase.from("products").insert({
        product_name: info.product_name,
        original_url: enriched.resolved_url ?? null,
        affiliate_link: link,
        sub_id: generateSubId(info.product_name),
        link_status: "READY",
        link_note: linkNote,
        price_note: info.price_note,
        target_customer: info.target_customer,
        product_angle: info.product_angle,
        image_url: enriched.image_url ?? null,
        status: "ACTIVE",
      });

      if (error) {
        errors.push(`Lưu thất bại (${link}): ${error.message}`);
        continue;
      }
      inserted += 1;
    } catch (err) {
      const m = err instanceof Error ? err.message : "Lỗi không xác định.";
      errors.push(`Lỗi xử lý (${link}): ${m}`);
    }
  }

  const skipped = cleaned.length - inserted;

  await insertPostingLog(
    supabase,
    null,
    IMPORT_ACTION,
    inserted > 0 ? "SUCCESS" : "FAILED",
    `Đã import ${inserted} link, bỏ qua ${skipped} link.`,
    { inserted, skipped, warnings, errors },
  );

  revalidatePath("/dashboard/products");
  revalidatePath("/dashboard/affiliate-links");
  revalidatePath("/dashboard/import-products");

  return { ok: true, inserted, skipped, warnings, errors };
}
