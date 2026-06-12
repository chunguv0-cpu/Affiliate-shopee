/**
 * Phase 21 — Query expansion. Never search only broad terms.
 * Expand a broad user keyword into SPECIFIC product queries within the vertical.
 */

import { isBroadKeyword, profileFor, vNorm, type Vertical } from "@/lib/autopilot/campaign-vertical";

export type ExpandedQueries = {
  primary_query: string;
  secondary_queries: string[];
  /** Tất cả query để chạy tìm kiếm (đã dedupe, cụ thể). */
  all: string[];
  used_seeds: boolean;
};

/**
 * Sinh query cụ thể cho 1 cơ hội trong ngành đã khóa.
 * - Nếu opportunity/keyword đã cụ thể: dùng nó + search_keywords + bổ sung seed ngành.
 * - Nếu rộng: dùng seed ngành cụ thể.
 */
export function expandVerticalQueries(
  vertical: Vertical,
  opp: { product_keyword: string; search_keywords?: string[] },
): ExpandedQueries {
  const profile = profileFor(vertical);
  const seeds = profile?.seeds ?? [];
  const userKeywords = [opp.product_keyword, ...(opp.search_keywords ?? [])]
    .map((k) => (k ?? "").trim())
    .filter(Boolean);
  const specificUser = userKeywords.filter((k) => !isBroadKeyword(k));

  let primary: string;
  let secondary: string[];
  let usedSeeds = false;

  if (specificUser.length > 0) {
    primary = specificUser[0];
    secondary = dedupe([...specificUser.slice(1), ...seeds]).slice(0, 6);
    if (specificUser.length === 1) usedSeeds = true;
  } else if (seeds.length > 0) {
    primary = seeds[0];
    secondary = seeds.slice(1, 7);
    usedSeeds = true;
  } else {
    // UNKNOWN vertical, no seeds -> fall back to the keyword itself (best effort).
    primary = userKeywords[0] ?? opp.product_keyword;
    secondary = [];
  }

  const all = dedupe([primary, ...secondary]).filter(Boolean);
  return { primary_query: primary, secondary_queries: secondary, all, used_seeds: usedSeeds };
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const key = vNorm(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Gợi ý từ khóa cụ thể hơn khi keyword quá rộng / không tìm được. */
export function suggestSpecificKeywords(vertical: Vertical): string[] {
  const profile = profileFor(vertical);
  if (profile && profile.seeds.length > 0) return profile.seeds.slice(0, 6);
  return [];
}
