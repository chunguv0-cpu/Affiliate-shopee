import "server-only";

import { isLikelyProductImage, normalizeImageUrl } from "@/lib/shopee/image-url";

type SearchFallbackProvider = "auto" | "tavily" | "google_cse" | "off";

type SearchImageFallbackInput = {
  productName?: string | null;
  productUrl?: string | null;
  shopId?: string | null;
  itemId?: string | null;
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

function configuredProviders(provider: SearchFallbackProvider): Array<"tavily" | "google_cse"> {
  if (provider === "off") return [];
  const hasTavily = Boolean(process.env.TAVILY_API_KEY?.trim());
  const hasGoogle = Boolean(process.env.GOOGLE_CSE_API_KEY?.trim() && process.env.GOOGLE_CSE_CX?.trim());
  if (provider === "tavily") return hasTavily ? ["tavily"] : [];
  if (provider === "google_cse") return hasGoogle ? ["google_cse"] : [];
  return [...(hasTavily ? (["tavily"] as const) : []), ...(hasGoogle ? (["google_cse"] as const) : [])];
}

function buildQueries(input: SearchImageFallbackInput): string[] {
  const name = (input.productName ?? "").trim();
  const ids = [input.shopId, input.itemId].filter(Boolean).join(" ");
  const queries = [
    name ? `"${name}" shopee` : null,
    name ? `${name} site:shopee.vn` : null,
    name ? `${name} ảnh sản phẩm` : null,
    ids ? `${ids} shopee product` : null,
  ].filter((q): q is string => Boolean(q && q.trim().length > 0));
  return Array.from(new Set(queries)).slice(0, 4);
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

function pushCandidate(out: string[], value: unknown): void {
  const url = pickUrl(value);
  if (url) out.push(url);
}

async function searchTavilyImages(query: string, maxImages: number): Promise<{ images: string[]; error: string | null }> {
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
    const out: string[] = [];
    if (Array.isArray(json.images)) json.images.forEach((img) => pushCandidate(out, img));
    if (Array.isArray(json.results)) {
      for (const item of json.results) {
        const result = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        if (Array.isArray(result.images)) result.images.forEach((img) => pushCandidate(out, img));
      }
    }
    return { images: out.slice(0, maxImages), error: null };
  } catch (err) {
    return { images: [], error: err instanceof Error ? err.message.slice(0, 160) : "tavily error" };
  } finally {
    clearTimeout(timeout);
  }
}

async function searchGoogleImages(query: string, maxImages: number): Promise<{ images: string[]; error: string | null }> {
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
    const out: string[] = [];
    if (Array.isArray(json.items)) {
      for (const item of json.items) {
        const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        pushCandidate(out, record.link);
      }
    }
    return { images: out.slice(0, maxImages), error: null };
  } catch (err) {
    return { images: [], error: err instanceof Error ? err.message.slice(0, 160) : "google_cse error" };
  } finally {
    clearTimeout(timeout);
  }
}

function rankImages(urls: string[]): string[] {
  return [...urls].sort((a, b) => {
    const shopeeA = /susercontent\.com|cf\.shopee\.vn|shopee/i.test(a) ? 0 : 1;
    const shopeeB = /susercontent\.com|cf\.shopee\.vn|shopee/i.test(b) ? 0 : 1;
    if (shopeeA !== shopeeB) return shopeeA - shopeeB;
    const jpgA = /\.(jpg|jpeg|png|webp)(?:$|[?#])/i.test(a) ? 0 : 1;
    const jpgB = /\.(jpg|jpeg|png|webp)(?:$|[?#])/i.test(b) ? 0 : 1;
    return jpgA - jpgB;
  });
}

export async function findProductImagesViaSearch(input: SearchImageFallbackInput): Promise<SearchImageFallbackResult> {
  const provider = getProvider();
  const providers = configuredProviders(provider);
  const queries = buildQueries(input);
  const diagnostics: Record<string, unknown> = {
    imageSearchFallbackProvider: provider,
    imageSearchConfiguredProviders: providers,
    imageSearchQueries: queries,
    imageSearchCandidateCount: 0,
    imageSearchValidCount: 0,
    imageSearchErrors: [],
    imageSearchNote: "Fallback ảnh qua search có thể là ảnh sản phẩm tương tự, không đảm bảo đúng tuyệt đối như ảnh Shopee gốc.",
  };

  if (providers.length === 0 || queries.length === 0) {
    diagnostics.imageSearchSkipped = providers.length === 0 ? "missing_provider_key" : "missing_product_name";
    return { ok: false, image_urls: [], diagnostics };
  }

  const candidates: string[] = [];
  const errors: string[] = [];
  for (const p of providers) {
    for (const q of queries) {
      const result = p === "tavily" ? await searchTavilyImages(q, 8) : await searchGoogleImages(q, 8);
      candidates.push(...result.images);
      if (result.error) errors.push(`${p}: ${result.error}`);
      if (candidates.length >= 16) break;
    }
    if (candidates.length >= 16) break;
  }

  const deduped = Array.from(new Set(candidates.map(normalizeImageUrl).filter(Boolean)));
  const valid = rankImages(deduped.filter(isLikelyProductImage)).slice(0, 8);
  diagnostics.imageSearchCandidateCount = deduped.length;
  diagnostics.imageSearchValidCount = valid.length;
  diagnostics.imageSearchErrors = errors.slice(0, 8);
  diagnostics.imageSearchFirstValidImages = valid.slice(0, 5);

  return { ok: valid.length > 0, image_urls: valid, diagnostics };
}
