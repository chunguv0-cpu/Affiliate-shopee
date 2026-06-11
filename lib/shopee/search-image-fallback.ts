import "server-only";

import { isLikelyProductImage, normalizeImageUrl } from "@/lib/shopee/image-url";

type SearchFallbackProvider = "auto" | "tavily" | "google_cse" | "off";
type ProviderName = "tavily" | "google_cse";

type SearchImageFallbackInput = {
  productName?: string | null;
  productUrl?: string | null;
  shopId?: string | null;
  itemId?: string | null;
};

type ImageCandidate = {
  imageUrl: string;
  sourceUrl: string | null;
  title: string | null;
  query: string;
  provider: ProviderName;
};

export type SearchImageFallbackResult = {
  ok: boolean;
  image_urls: string[];
  diagnostics: Record<string, unknown>;
};

function getProvider(): SearchFallbackProvider {
  const raw = process.env.SHOPEE_IMAGE_SEARCH_FALLBACK_PROVIDER?.trim().toLowerCase();
  if (raw === "tavily" || raw === "google_cse" || raw === "off" || raw === "auto") return raw;
  return "auto";
}

function strictMode(): boolean {
  const raw = process.env.SHOPEE_IMAGE_SEARCH_FALLBACK_STRICT?.trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}

function configuredProviders(provider: SearchFallbackProvider): ProviderName[] {
  if (provider === "off") return [];
  const hasTavily = Boolean(process.env.TAVILY_API_KEY?.trim());
  const hasGoogle = Boolean(process.env.GOOGLE_CSE_API_KEY?.trim() && process.env.GOOGLE_CSE_CX?.trim());
  if (provider === "tavily") return hasTavily ? ["tavily"] : [];
  if (provider === "google_cse") return hasGoogle ? ["google_cse"] : [];
  return [...(hasGoogle ? (["google_cse"] as const) : []), ...(hasTavily ? (["tavily"] as const) : [])];
}

function buildQueries(input: SearchImageFallbackInput): string[] {
  const name = (input.productName ?? "").trim();
  const productUrl = (input.productUrl ?? "").trim();
  const ids = [input.shopId, input.itemId].filter(Boolean).join(" ");
  const queries = [
    ids ? `${ids} shopee product` : null,
    input.itemId ? `"${input.itemId}" shopee` : null,
    productUrl ? `"${productUrl}"` : null,
    name ? `"${name}" site:shopee.vn` : null,
    name ? `"${name}" shopee` : null,
    name ? `${name} product image` : null,
  ].filter((q): q is string => Boolean(q && q.trim().length > 0));
  return Array.from(new Set(queries)).slice(0, 6);
}

function pickUrl(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["url", "link", "src", "image_url"]) {
    const v = record[key];
    if (typeof v === "string") return v;
  }
  return null;
}

function pushCandidate(out: ImageCandidate[], value: unknown, meta: Omit<ImageCandidate, "imageUrl">): void {
  const url = pickUrl(value);
  if (url) out.push({ ...meta, imageUrl: url });
}

async function searchTavilyImages(query: string, maxImages: number): Promise<{ images: ImageCandidate[]; error: string | null }> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) return { images: [], error: "missing TAVILY_API_KEY" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 5,
        search_depth: "basic",
        include_answer: false,
        include_raw_content: false,
        include_images: true,
        include_image_descriptions: true,
      }),
    });
    if (!res.ok) return { images: [], error: `tavily HTTP ${res.status}` };
    const json = (await res.json()) as Record<string, unknown>;
    const out: ImageCandidate[] = [];
    if (Array.isArray(json.images)) {
      json.images.forEach((img) => pushCandidate(out, img, { provider: "tavily", query, sourceUrl: null, title: null }));
    }
    if (Array.isArray(json.results)) {
      for (const item of json.results) {
        const result = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const sourceUrl = typeof result.url === "string" ? result.url : null;
        const title = typeof result.title === "string" ? result.title : null;
        if (Array.isArray(result.images)) {
          result.images.forEach((img) => pushCandidate(out, img, { provider: "tavily", query, sourceUrl, title }));
        }
      }
    }
    return { images: out.slice(0, maxImages), error: null };
  } catch (err) {
    return { images: [], error: err instanceof Error ? err.message.slice(0, 160) : "tavily error" };
  } finally {
    clearTimeout(timeout);
  }
}

async function searchGoogleImages(query: string, maxImages: number): Promise<{ images: ImageCandidate[]; error: string | null }> {
  const key = process.env.GOOGLE_CSE_API_KEY?.trim();
  const cx = process.env.GOOGLE_CSE_CX?.trim();
  if (!key || !cx) return { images: [], error: "missing GOOGLE_CSE_API_KEY/GOOGLE_CSE_CX" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const url =
      `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}` +
      `&cx=${encodeURIComponent(cx)}&num=${Math.min(10, maxImages)}` +
      `&searchType=image&safe=active&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!res.ok) return { images: [], error: `google_cse HTTP ${res.status}` };
    const json = (await res.json()) as { items?: unknown[] };
    const out: ImageCandidate[] = [];
    if (Array.isArray(json.items)) {
      for (const item of json.items) {
        const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        const image = record.image && typeof record.image === "object" ? (record.image as Record<string, unknown>) : {};
        const sourceUrl =
          typeof image.contextLink === "string"
            ? image.contextLink
            : typeof record.displayLink === "string"
              ? record.displayLink
              : null;
        const title = typeof record.title === "string" ? record.title : null;
        pushCandidate(out, record.link, { provider: "google_cse", query, sourceUrl, title });
      }
    }
    return { images: out.slice(0, maxImages), error: null };
  } catch (err) {
    return { images: [], error: err instanceof Error ? err.message.slice(0, 160) : "google_cse error" };
  } finally {
    clearTimeout(timeout);
  }
}

function candidateEvidence(candidate: ImageCandidate, input: SearchImageFallbackInput): string[] {
  const haystack = [candidate.imageUrl, candidate.sourceUrl, candidate.title, candidate.query]
    .filter((v): v is string => Boolean(v))
    .join(" ")
    .toLowerCase();
  const evidence: string[] = [];
  if (input.itemId && haystack.includes(input.itemId.toLowerCase())) evidence.push("item_id");
  if (input.shopId && haystack.includes(input.shopId.toLowerCase())) evidence.push("shop_id");
  if (candidate.sourceUrl && /shopee\.vn/i.test(candidate.sourceUrl) && (input.itemId || input.shopId)) evidence.push("shopee_context");
  if (/susercontent\.com|cf\.shopee\.vn|img\.susercontent\.com/i.test(candidate.imageUrl) && candidate.sourceUrl && /shopee\.vn/i.test(candidate.sourceUrl)) {
    evidence.push("shopee_cdn_with_context");
  }
  return Array.from(new Set(evidence));
}

function strictAccept(candidate: ImageCandidate, input: SearchImageFallbackInput): boolean {
  const evidence = candidateEvidence(candidate, input);
  if (input.itemId || input.shopId) {
    return evidence.includes("item_id") || (evidence.includes("shop_id") && evidence.includes("shopee_context"));
  }
  return evidence.includes("shopee_cdn_with_context");
}

function rankCandidates(candidates: ImageCandidate[], input: SearchImageFallbackInput): ImageCandidate[] {
  return [...candidates].sort((a, b) => {
    const evidenceDiff = candidateEvidence(b, input).length - candidateEvidence(a, input).length;
    if (evidenceDiff !== 0) return evidenceDiff;
    const shopeeA = /susercontent\.com|cf\.shopee\.vn|shopee/i.test(a.imageUrl) ? 0 : 1;
    const shopeeB = /susercontent\.com|cf\.shopee\.vn|shopee/i.test(b.imageUrl) ? 0 : 1;
    if (shopeeA !== shopeeB) return shopeeA - shopeeB;
    const extA = /\.(jpg|jpeg|png|webp)(?:$|[?#])/i.test(a.imageUrl) ? 0 : 1;
    const extB = /\.(jpg|jpeg|png|webp)(?:$|[?#])/i.test(b.imageUrl) ? 0 : 1;
    return extA - extB;
  });
}

export async function findProductImagesViaSearch(input: SearchImageFallbackInput): Promise<SearchImageFallbackResult> {
  const provider = getProvider();
  const providers = configuredProviders(provider);
  const queries = buildQueries(input);
  const strict = strictMode();
  const diagnostics: Record<string, unknown> = {
    imageSearchFallbackProvider: provider,
    imageSearchFallbackStrict: strict,
    imageSearchConfiguredProviders: providers,
    imageSearchQueries: queries,
    imageSearchCandidateCount: 0,
    imageSearchQualityCandidateCount: 0,
    imageSearchEvidenceCandidateCount: 0,
    imageSearchValidCount: 0,
    imageSearchErrors: [],
    imageSearchNote:
      "Search fallback is strict by default. Low-evidence generic images are rejected to avoid creating visuals for the wrong product.",
  };

  if (providers.length === 0 || queries.length === 0) {
    diagnostics.imageSearchSkipped = providers.length === 0 ? "missing_provider_key" : "missing_product_name";
    return { ok: false, image_urls: [], diagnostics };
  }

  const candidates: ImageCandidate[] = [];
  const errors: string[] = [];
  for (const p of providers) {
    for (const q of queries) {
      const result = p === "tavily" ? await searchTavilyImages(q, 8) : await searchGoogleImages(q, 8);
      candidates.push(...result.images);
      if (result.error) errors.push(`${p}: ${result.error}`);
      if (candidates.length >= 24) break;
    }
    if (candidates.length >= 24) break;
  }

  const deduped = new Map<string, ImageCandidate>();
  for (const candidate of candidates) {
    const normalized = normalizeImageUrl(candidate.imageUrl);
    if (!normalized || deduped.has(normalized)) continue;
    deduped.set(normalized, { ...candidate, imageUrl: normalized });
  }

  const dedupedCandidates = Array.from(deduped.values());
  const qualityFiltered = dedupedCandidates.filter((candidate) => isLikelyProductImage(candidate.imageUrl));
  const evidenceFiltered = strict ? qualityFiltered.filter((candidate) => strictAccept(candidate, input)) : qualityFiltered;
  const ranked = rankCandidates(evidenceFiltered, input);
  const valid = ranked.map((candidate) => candidate.imageUrl).slice(0, 8);

  diagnostics.imageSearchCandidateCount = dedupedCandidates.length;
  diagnostics.imageSearchQualityCandidateCount = qualityFiltered.length;
  diagnostics.imageSearchEvidenceCandidateCount = evidenceFiltered.length;
  diagnostics.imageSearchValidCount = valid.length;
  diagnostics.imageSearchErrors = errors.slice(0, 8);
  diagnostics.imageSearchFirstValidImages = valid.slice(0, 5);
  diagnostics.imageSearchAcceptedEvidence = ranked.slice(0, 5).map((candidate) => ({
    imageUrl: candidate.imageUrl.slice(0, 160),
    sourceUrl: candidate.sourceUrl?.slice(0, 160) ?? null,
    evidence: candidateEvidence(candidate, input),
  }));
  diagnostics.imageSearchRejectedSamples = qualityFiltered
    .filter((candidate) => !evidenceFiltered.some((accepted) => accepted.imageUrl === candidate.imageUrl))
    .slice(0, 5)
    .map((candidate) => ({
      imageUrl: candidate.imageUrl.slice(0, 160),
      sourceUrl: candidate.sourceUrl?.slice(0, 160) ?? null,
      title: candidate.title?.slice(0, 100) ?? null,
      reason: "low_evidence_for_exact_product",
    }));

  return { ok: valid.length > 0, image_urls: valid, diagnostics };
}
