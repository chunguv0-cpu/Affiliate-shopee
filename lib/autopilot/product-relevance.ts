/**
 * Phase 20 — Product relevance engine cho AI Autopilot sourcing.
 *
 * Pure (không DB, không server-only) — dùng được cả server & test.
 * 4 tầng: (1) sinh query cụ thể, (2) guardrail nhóm hàng, (3) chấm điểm
 * relevance 0-100, (4) cổng chấp nhận nghiêm ngặt (gate >= ngưỡng).
 */

export const RELEVANCE_THRESHOLD = (() => {
  const raw = typeof process !== "undefined" ? process.env?.PRODUCT_RELEVANCE_THRESHOLD?.trim() : undefined;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 65;
})();

export type RejectionReason =
  | "CATEGORY_MISMATCH"
  | "NEGATIVE_KEYWORD"
  | "LOW_RELEVANCE"
  | "DUPLICATE_RECENT"
  | "MISSING_IMAGE"
  | "LINK_CONVERSION_FAILED";

export type RelevanceComponents = {
  keyword: number;
  category: number;
  semantic: number;
  image: number;
  quality: number;
  novelty: number;
};

export type RelevanceVerdict = {
  accepted: boolean;
  score: number;
  components: RelevanceComponents;
  rejected_reason: RejectionReason | null;
  accepted_reason: string | null;
};

export type QueryPlan = {
  primary_query: string;
  secondary_queries: string[];
  category_filter: string;
  negative_keywords: string[];
};

export type RelevanceOpportunity = {
  product_keyword: string;
  category?: string | null;
  target_customer?: string | null;
  search_keywords?: string[];
  expected_content_angle?: string | null;
  suggested_price_range?: string | null;
};

export type RelevanceItem = {
  product_name: string;
  category?: string | null;
  image_urls?: string[];
  price_note?: string | null;
  rating_note?: string | null;
  sold_note?: string | null;
};

// ---------------------------------------------------------------------------
// Chuẩn hóa tiếng Việt (bỏ dấu) + token hóa.
// ---------------------------------------------------------------------------
export function stripDiacritics(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

export function normalizeText(input: string | null | undefined): string {
  return stripDiacritics((input ?? "").toLowerCase()).replace(/\s+/g, " ").trim();
}

function tokens(input: string | null | undefined): string[] {
  return normalizeText(input)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

// "stop tokens" quá chung, không tính điểm khớp.
const STOP = new Set(["do", "san", "pham", "sanpham", "loai", "cho", "va", "cac", "bo", "mini", "moi", "gia", "re", "tot", "hot", "cao", "cap", "chinh", "hang"]);

/** Độ tương đồng tiêu đề (Jaccard token) 0..1 — dùng để phát hiện trùng. */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(tokens(a).filter((t) => !STOP.has(t)));
  const tb = new Set(tokens(b).filter((t) => !STOP.has(t)));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ---------------------------------------------------------------------------
// Hồ sơ nhóm hàng (configurable). allowed = từ tích cực, negative = từ loại.
// expansionSeeds = query cụ thể khi người dùng nhập cụm quá rộng.
// ---------------------------------------------------------------------------
export type CategoryProfile = {
  key: string;
  label: string;
  allowed: string[];
  negative: string[];
  expansionSeeds: string[];
};

// Từ loại "trang trí/không liên quan" dùng chung cho nhóm công nghệ/gia dụng.
const SHARED_NEGATIVE = [
  "kim cuong",
  "da nhua",
  "trang suc",
  "vong tay",
  "vong co",
  "hoa tai",
  "bong tai",
  "lac tay",
  "mong tay",
  "nail",
  "my pham",
  "son moi",
  "phan",
  "kem duong",
  "mat na",
  "thoi trang nu",
  "vay",
  "dam",
  "ao thun",
  "do choi",
  "thu nhoi bong",
  "sticker",
  "hinh dan trang tri",
];

export const CATEGORY_PROFILES: CategoryProfile[] = [
  {
    key: "tech",
    label: "Công nghệ / thiết bị",
    allowed: [
      "den cam bien",
      "cam bien",
      "den led",
      "led",
      "sac",
      "cap sac",
      "gia do",
      "gia do dien thoai",
      "may mini",
      "may xay",
      "may hut bui",
      "quat",
      "thiet bi thong minh",
      "usb",
      "tu dong",
      "bluetooth",
      "dien tu",
      "gia dung thong minh",
      "tai nghe",
      "loa",
      "chuot",
      "ban phim",
      "webcam",
      "hub",
      "pin sac",
      "sac du phong",
      "den ngu",
    ],
    negative: [...SHARED_NEGATIVE, "op lung", "day deo", "khung anh"],
    expansionSeeds: [
      "den cam bien chuyen dong",
      "may xay mini sac usb",
      "gia do dien thoai gap gon",
      "may hut bui mini ban lam viec",
      "den led tu quan ao cam bien",
      "sac du phong mini",
      "den ngu cam bien",
      "quat mini cam tay",
    ],
  },
  {
    key: "home_organization",
    label: "Sắp xếp / lưu trữ nhà cửa",
    allowed: [
      "moc",
      "moc dan tuong",
      "ke",
      "ke nha tam",
      "hop",
      "hop dung",
      "gia treo",
      "luoi loc",
      "chan bui",
      "kep",
      "do",
      "treo tuong",
      "gap gon",
      "tui hut chan khong",
      "thanh treo",
      "khay",
      "gio",
    ],
    negative: [...SHARED_NEGATIVE],
    expansionSeeds: [
      "moc dan tuong chiu luc",
      "ke nha tam dan tuong",
      "hop dung do gap gon",
      "gia treo do da nang",
      "tui hut chan khong quan ao",
      "luoi loc cong chong mui",
    ],
  },
  {
    key: "kitchen",
    label: "Nhà bếp",
    allowed: [
      "khan lau",
      "khan lau bep",
      "dao",
      "thot",
      "hop dung thuc pham",
      "may xay",
      "loc",
      "luoi loc",
      "ve sinh bep",
      "ron kin",
      "hop tru dong",
      "do nha bep",
      "chai xit",
      "mieng rua bat",
    ],
    negative: [...SHARED_NEGATIVE],
    expansionSeeds: [
      "khan lau bep da nang",
      "hop dung thuc pham co ron kin",
      "dao got da nang",
      "may xay mini cam tay",
      "luoi loc rac bon rua",
    ],
  },
  {
    key: "generic",
    label: "Chung",
    allowed: [],
    negative: [],
    expansionSeeds: [],
  },
];

const PROFILE_BY_KEY = new Map(CATEGORY_PROFILES.map((p) => [p.key, p]));

// Cụm từ "quá rộng" — không được tìm trực tiếp, phải mở rộng thành query cụ thể.
const BROAD_TERMS = [
  "do cong nghe",
  "cong nghe",
  "do gia dung",
  "gia dung",
  "san pham hot",
  "san pham",
  "tien ich",
  "phu kien",
  "do dung",
  "hot trend",
  "do dung gia dinh",
  "gia dung thong minh",
  "do cong nghe tien ich",
];

export function isBroadKeyword(keyword: string): boolean {
  const norm = normalizeText(keyword);
  if (!norm) return true;
  if (BROAD_TERMS.includes(norm)) return true;
  // Quá ngắn / quá ít token cụ thể cũng coi là rộng.
  const meaningful = tokens(norm).filter((t) => !STOP.has(t));
  return meaningful.length <= 1 && BROAD_TERMS.some((b) => norm.includes(b));
}

/** Suy ra hồ sơ nhóm hàng phù hợp nhất cho 1 cơ hội. */
export function inferCategoryProfile(opp: RelevanceOpportunity): CategoryProfile {
  const hay = normalizeText([opp.category, opp.product_keyword, opp.expected_content_angle, ...(opp.search_keywords ?? [])].join(" "));
  if (/(cong nghe|dien tu|thong minh|led|cam bien|sac|usb|bluetooth|tai nghe|loa|may )/.test(hay)) return PROFILE_BY_KEY.get("tech")!;
  if (/(bep|dao|thot|thuc pham|nha bep|rua bat|xay)/.test(hay)) return PROFILE_BY_KEY.get("kitchen")!;
  if (/(moc|ke |luu tru|sap xep|treo|hop dung|gia treo|nha tam|nha cua|to chuc)/.test(hay)) return PROFILE_BY_KEY.get("home_organization")!;
  return PROFILE_BY_KEY.get("generic")!;
}

/** Tầng 1 — sinh query cụ thể từ một cơ hội. */
export function expandQueries(opp: RelevanceOpportunity): QueryPlan {
  const profile = inferCategoryProfile(opp);
  const userKeywords = [opp.product_keyword, ...(opp.search_keywords ?? [])]
    .map((k) => (k ?? "").trim())
    .filter(Boolean);
  const specificUserKeywords = userKeywords.filter((k) => !isBroadKeyword(k));

  let primary: string;
  let secondary: string[];

  if (specificUserKeywords.length > 0) {
    primary = specificUserKeywords[0];
    secondary = Array.from(new Set([...specificUserKeywords.slice(1), ...profile.expansionSeeds])).slice(0, 6);
  } else {
    // Cụm rộng -> dùng seed cụ thể của nhóm hàng.
    const seeds = profile.expansionSeeds.length > 0 ? profile.expansionSeeds : ["den cam bien chuyen dong", "moc dan tuong chiu luc", "hop dung thuc pham co ron kin"];
    primary = seeds[0];
    secondary = seeds.slice(1, 7);
  }

  return {
    primary_query: primary,
    secondary_queries: secondary,
    category_filter: profile.key,
    negative_keywords: profile.negative,
  };
}

function countAllowedHits(titleNorm: string, profile: CategoryProfile): number {
  if (profile.allowed.length === 0) return 0;
  return profile.allowed.reduce((acc, term) => (titleNorm.includes(term) ? acc + 1 : acc), 0);
}

function firstNegativeHit(titleNorm: string, negatives: string[]): string | null {
  for (const neg of negatives) {
    if (neg && titleNorm.includes(neg)) return neg;
  }
  return null;
}

function jaccardKeywordMatch(opp: RelevanceOpportunity, titleNorm: string): number {
  const oppTokens = new Set(
    [opp.product_keyword, ...(opp.search_keywords ?? [])]
      .flatMap((k) => tokens(k))
      .filter((t) => !STOP.has(t)),
  );
  if (oppTokens.size === 0) return 0;
  const titleTokens = new Set(tokens(titleNorm));
  let hit = 0;
  for (const t of oppTokens) if (titleTokens.has(t)) hit += 1;
  return hit / oppTokens.size;
}

export type ScoreOptions = {
  requireImage?: boolean;
  isDuplicateRecent?: boolean;
  allowRepeat?: boolean;
};

/** Tầng 2+3 — guardrail nhóm + chấm điểm 0-100. */
export function scoreRelevance(
  item: RelevanceItem,
  opp: RelevanceOpportunity,
  profile: CategoryProfile,
  options: ScoreOptions = {},
): RelevanceVerdict {
  const titleNorm = normalizeText(`${item.product_name} ${item.category ?? ""}`);
  const zero: RelevanceComponents = { keyword: 0, category: 0, semantic: 0, image: 0, quality: 0, novelty: 0 };

  // Hard reject: từ khóa loại.
  const negHit = firstNegativeHit(titleNorm, profile.negative);
  if (negHit) {
    return { accepted: false, score: 0, components: zero, rejected_reason: "NEGATIVE_KEYWORD", accepted_reason: null };
  }

  const hasImage = Array.isArray(item.image_urls) && item.image_urls.length > 0;
  if (options.requireImage && !hasImage) {
    return { accepted: false, score: 0, components: zero, rejected_reason: "MISSING_IMAGE", accepted_reason: null };
  }

  // Trùng gần đây.
  if (options.isDuplicateRecent && !options.allowRepeat) {
    return { accepted: false, score: 0, components: zero, rejected_reason: "DUPLICATE_RECENT", accepted_reason: null };
  }

  const kwRatio = jaccardKeywordMatch(opp, titleNorm);
  const keyword = Math.round(kwRatio * 30);

  const allowedHits = countAllowedHits(titleNorm, profile);
  const isGeneric = profile.key === "generic";
  const category = isGeneric ? 15 : Math.min(25, allowedHits * 12);

  // semantic fit: overlap token search_keywords (rộng hơn keyword match).
  const semTokens = new Set((opp.search_keywords ?? []).flatMap((k) => tokens(k)).filter((t) => !STOP.has(t)));
  const titleTokens = new Set(tokens(titleNorm));
  let semHit = 0;
  for (const t of semTokens) if (titleTokens.has(t)) semHit += 1;
  const semantic = semTokens.size > 0 ? Math.round((semHit / semTokens.size) * 25) : Math.min(25, keyword > 0 ? 12 : 0);

  const image = hasImage ? 10 : 0;
  const quality = (item.price_note ? 6 : 0) + (item.rating_note ? 2 : 0) + (item.sold_note ? 2 : 0);
  const novelty = options.isDuplicateRecent ? 0 : 10;

  const components: RelevanceComponents = { keyword, category, semantic, image, quality: Math.min(10, quality), novelty };
  const score = keyword + category + semantic + image + components.quality + novelty;

  // Category mismatch mạnh: nhóm cụ thể nhưng không có từ allowed nào và khớp keyword yếu.
  if (!isGeneric && allowedHits === 0 && kwRatio < 0.34) {
    return { accepted: false, score, components, rejected_reason: "CATEGORY_MISMATCH", accepted_reason: null };
  }

  if (score < RELEVANCE_THRESHOLD) {
    return { accepted: false, score, components, rejected_reason: "LOW_RELEVANCE", accepted_reason: null };
  }

  return {
    accepted: true,
    score,
    components,
    rejected_reason: null,
    accepted_reason: `Khớp từ khóa ${keyword}/30, đúng nhóm ${category}/25, score ${score}.`,
  };
}

export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  CATEGORY_MISMATCH: "Sai nhóm hàng",
  NEGATIVE_KEYWORD: "Chứa từ khóa loại trừ",
  LOW_RELEVANCE: "Độ liên quan thấp",
  DUPLICATE_RECENT: "Trùng sản phẩm gần đây",
  MISSING_IMAGE: "Thiếu ảnh sản phẩm",
  LINK_CONVERSION_FAILED: "Chuyển link thất bại",
};

/** Gợi ý từ khóa cụ thể hơn khi không tìm thấy sản phẩm đủ liên quan. */
export function suggestSpecificKeywords(opp: RelevanceOpportunity): string[] {
  const profile = inferCategoryProfile(opp);
  if (profile.expansionSeeds.length > 0) return profile.expansionSeeds.slice(0, 5);
  return ["đèn cảm biến chuyển động", "máy xay mini sạc USB", "giá đỡ điện thoại gấp gọn", "hộp đựng thực phẩm có ron kín"];
}
