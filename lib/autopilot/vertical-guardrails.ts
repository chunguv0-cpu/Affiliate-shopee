/**
 * Phase 21 — Vertical relevance gate. The locked vertical + user keyword are
 * HARD constraints. Raw Shopee/API results are NEVER accepted directly.
 */

import {
  classifyProductVertical,
  profileFor,
  vNorm,
  type Vertical,
} from "@/lib/autopilot/campaign-vertical";

export type VerticalRejectionReason =
  | "OUT_OF_KEYWORD_SCOPE"
  | "BLOCKED_TERM"
  | "CATEGORY_MISMATCH"
  | "TOO_GENERIC"
  | "LOW_RELEVANCE"
  | "DUPLICATE_RECENT"
  | "MISSING_IMAGE"
  | "PROVIDER_ERROR";

export const VERTICAL_REJECTION_LABELS: Record<VerticalRejectionReason, string> = {
  OUT_OF_KEYWORD_SCOPE: "Ngoài phạm vi từ khóa",
  BLOCKED_TERM: "Chứa từ khóa bị chặn",
  CATEGORY_MISMATCH: "Sai ngành hàng",
  TOO_GENERIC: "Quá chung chung",
  LOW_RELEVANCE: "Độ liên quan thấp",
  DUPLICATE_RECENT: "Trùng sản phẩm gần đây",
  MISSING_IMAGE: "Thiếu ảnh sản phẩm",
  PROVIDER_ERROR: "Lỗi nhà cung cấp",
};

export type GuardrailItem = {
  product_name: string;
  category?: string | null;
  image_urls?: string[];
  price_note?: string | null;
  rating_note?: string | null;
  sold_note?: string | null;
};

export type GuardrailOpportunity = {
  product_keyword: string;
  search_keywords?: string[];
};

export type GuardrailOptions = {
  requireImage?: boolean;
  isDuplicateRecent?: boolean;
  allowRepeat?: boolean;
  /** Keyword người dùng rộng -> ngưỡng cao hơn (70). */
  broadKeyword?: boolean;
};

export type GuardrailVerdict = {
  accepted: boolean;
  score: number;
  components: { keyword: number; vertical: number; semantic: number; image: number; quality: number; novelty: number };
  matched_terms: string[];
  blocked_terms: string[];
  rejected_reason: VerticalRejectionReason | null;
  accepted_reason: string | null;
};

const STOP = new Set(["do", "san", "pham", "loai", "cho", "va", "cac", "bo", "moi", "gia", "re", "tot", "hot", "cao", "cap", "chinh", "hang", "set", "combo"]);

function tokens(input: string | null | undefined): string[] {
  return vNorm(input)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

/**
 * Chấm điểm + cổng chấp nhận một sản phẩm theo NGÀNH KHÓA.
 */
export function scoreProductForVertical(
  item: GuardrailItem,
  vertical: Vertical,
  opp: GuardrailOpportunity,
  options: GuardrailOptions = {},
): GuardrailVerdict {
  const profile = profileFor(vertical);
  const titleNorm = vNorm(`${item.product_name} ${item.category ?? ""}`);
  const zero = { keyword: 0, vertical: 0, semantic: 0, image: 0, quality: 0, novelty: 0 };
  const threshold = options.broadKeyword ? 70 : 65;

  // 1) Từ khóa bị chặn (hard reject).
  const blocked: string[] = [];
  if (profile) {
    for (const neg of profile.negative) {
      if (neg && titleNorm.includes(neg)) blocked.push(neg);
    }
  }
  if (blocked.length > 0) {
    return { accepted: false, score: 0, components: zero, matched_terms: [], blocked_terms: blocked, rejected_reason: "BLOCKED_TERM", accepted_reason: null };
  }

  // 2) Ảnh bắt buộc.
  const hasImage = Array.isArray(item.image_urls) && item.image_urls.length > 0;
  if (options.requireImage && !hasImage) {
    return { accepted: false, score: 0, components: zero, matched_terms: [], blocked_terms: [], rejected_reason: "MISSING_IMAGE", accepted_reason: null };
  }

  // 3) Trùng gần đây.
  if (options.isDuplicateRecent && !options.allowRepeat) {
    return { accepted: false, score: 0, components: zero, matched_terms: [], blocked_terms: [], rejected_reason: "DUPLICATE_RECENT", accepted_reason: null };
  }

  // 4) Lệch ngành: sản phẩm khớp ngành KHÁC mạnh nhưng không khớp ngành khóa.
  const matched: string[] = [];
  let verticalHits = 0;
  if (profile) {
    for (const term of profile.allowed) {
      if (term && titleNorm.includes(term)) {
        verticalHits += term.includes(" ") ? 2 : 1;
        matched.push(term);
      }
    }
  }
  if (vertical !== "UNKNOWN") {
    const prodV = classifyProductVertical(item.product_name);
    if (prodV.vertical !== vertical && prodV.vertical !== "UNKNOWN" && prodV.score >= 2 && verticalHits === 0) {
      return { accepted: false, score: 0, components: zero, matched_terms: [], blocked_terms: [], rejected_reason: "CATEGORY_MISMATCH", accepted_reason: null };
    }
  }

  // 5) Chấm điểm.
  const oppTokens = new Set([opp.product_keyword, ...(opp.search_keywords ?? [])].flatMap((k) => tokens(k)));
  const titleTokens = new Set(tokens(titleNorm));
  let kwHit = 0;
  for (const t of oppTokens) if (titleTokens.has(t)) kwHit += 1;
  const keyword = oppTokens.size > 0 ? Math.round((kwHit / oppTokens.size) * 30) : 0;

  const vertical25 = vertical === "UNKNOWN" ? 12 : Math.min(25, verticalHits * 10);

  const semTokens = new Set((opp.search_keywords ?? []).flatMap((k) => tokens(k)));
  let semHit = 0;
  for (const t of semTokens) if (titleTokens.has(t)) semHit += 1;
  const semantic = semTokens.size > 0 ? Math.round((semHit / semTokens.size) * 25) : Math.min(25, keyword > 0 ? 12 : 0);

  const image = hasImage ? 10 : 0;
  const quality = Math.min(10, (item.price_note ? 6 : 0) + (item.rating_note ? 2 : 0) + (item.sold_note ? 2 : 0));
  const novelty = options.isDuplicateRecent ? 0 : 10;

  const components = { keyword, vertical: vertical25, semantic, image, quality, novelty };
  const score = keyword + vertical25 + semantic + image + quality + novelty;

  // 6) Không có tín hiệu ngành nào và keyword khớp yếu -> ngoài phạm vi.
  if (vertical !== "UNKNOWN" && verticalHits === 0 && keyword < 10) {
    return { accepted: false, score, components, matched_terms: matched, blocked_terms: [], rejected_reason: "OUT_OF_KEYWORD_SCOPE", accepted_reason: null };
  }

  if (score < threshold) {
    return { accepted: false, score, components, matched_terms: matched, blocked_terms: [], rejected_reason: "LOW_RELEVANCE", accepted_reason: null };
  }

  return {
    accepted: true,
    score,
    components,
    matched_terms: matched,
    blocked_terms: [],
    rejected_reason: null,
    accepted_reason: `Đúng ngành ${vertical} (${vertical25}/25), khớp từ khóa ${keyword}/30, score ${score}.`,
  };
}
