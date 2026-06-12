/**
 * Phase 21 — Opportunity validator. Ensures AI campaign opportunities stay
 * inside the locked vertical. Drops out-of-vertical / blocked ideas so the AI
 * cannot drift to generic hot products.
 */

import { classifyProductVertical, profileFor, vNorm, type Vertical } from "@/lib/autopilot/campaign-vertical";
import type { ProductOpportunity } from "@/lib/types";

export type ValidationResult = {
  valid: ProductOpportunity[];
  dropped: Array<{ keyword: string; reason: string }>;
};

/**
 * Giữ lại cơ hội thuộc đúng ngành khóa; loại cơ hội lệch ngành / chứa từ chặn.
 * Nếu vertical = UNKNOWN: không lọc (chờ người dùng làm rõ ở tầng trên).
 */
export function validateOpportunitiesForVertical(
  opportunities: ProductOpportunity[],
  vertical: Vertical,
): ValidationResult {
  if (vertical === "UNKNOWN") return { valid: opportunities, dropped: [] };
  const profile = profileFor(vertical);
  if (!profile) return { valid: opportunities, dropped: [] };

  const valid: ProductOpportunity[] = [];
  const dropped: Array<{ keyword: string; reason: string }> = [];

  for (const opp of opportunities) {
    const hay = vNorm(`${opp.product_keyword} ${(opp.search_keywords ?? []).join(" ")} ${opp.category ?? ""}`);

    // Từ chặn -> loại.
    const blocked = profile.negative.find((neg) => neg && hay.includes(neg));
    if (blocked) {
      dropped.push({ keyword: opp.product_keyword, reason: `Chứa từ chặn: ${blocked}` });
      continue;
    }

    // Có tín hiệu đúng ngành?
    const hasAllowed = profile.allowed.some((a) => a && hay.includes(a));
    const hasSignal = profile.signals.some((s) => s && hay.includes(s));
    if (hasAllowed || hasSignal) {
      valid.push(opp);
      continue;
    }

    // Không có tín hiệu ngành khóa: kiểm tra có nghiêng hẳn sang ngành khác không.
    const prodV = classifyProductVertical(opp.product_keyword);
    if (prodV.vertical !== "UNKNOWN" && prodV.vertical !== vertical && prodV.score >= 2) {
      dropped.push({ keyword: opp.product_keyword, reason: `Lệch sang ngành ${prodV.vertical}` });
      continue;
    }
    // Mơ hồ nhưng không lệch hẳn -> giữ (an toàn).
    valid.push(opp);
  }

  return { valid, dropped };
}

/** Tạo cơ hội dự phòng theo ngành (vertical-specific) — KHÔNG dùng list hot toàn cục. */
export function verticalFallbackOpportunities(vertical: Vertical): ProductOpportunity[] {
  const profile = profileFor(vertical);
  if (!profile) return [];
  return profile.seeds.slice(0, 8).map((seed) => ({
    product_keyword: seed,
    category: profile.label,
    reason: `Sản phẩm phổ biến trong ngành ${profile.label}`,
    target_customer: null,
    pain_point: null,
    expected_content_angle: null,
    suggested_price_range: null,
    search_keywords: [seed],
    priority: "medium",
  }));
}
