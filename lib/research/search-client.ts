import "server-only";

/**
 * Search client cho Market Research (Phase 13.1).
 * AN TOÀN: chỉ dùng Search API công khai (Tavily / Google CSE). KHÔNG scrape,
 * KHÔNG cookie, KHÔNG headless browser. Không bao giờ throw — lỗi -> trả [].
 */

export type SearchProvider = "mock" | "tavily" | "google_cse";

export type SearchResult = {
  title: string;
  url: string;
  snippet?: string | null;
  content?: string | null;
  source_type?: string | null;
  relevance_score?: number | null;
};

export function getSearchProvider(): SearchProvider {
  const raw = process.env.SEARCH_PROVIDER?.trim().toLowerCase();
  if (raw === "tavily" || raw === "google_cse" || raw === "mock") return raw;
  return "mock";
}

function mockResults(query: string, maxResults: number): SearchResult[] {
  const base: SearchResult[] = [
    {
      title: `Xu hướng mua sắm liên quan: ${query}`,
      url: "https://example.com/xu-huong",
      snippet: "Dữ liệu mẫu (mock): người dùng quan tâm giá hợp lý, review thật và tiện lợi hằng ngày.",
      source_type: "mock",
      relevance_score: 0.8,
    },
    {
      title: `Kinh nghiệm chọn mua: ${query}`,
      url: "https://example.com/kinh-nghiem",
      snippet: "Dữ liệu mẫu (mock): khách thường so sánh nhiều lựa chọn và ưu tiên đánh giá thực tế.",
      source_type: "mock",
      relevance_score: 0.7,
    },
    {
      title: `Cách viết nội dung kéo tương tác: ${query}`,
      url: "https://example.com/content-hook",
      snippet: "Dữ liệu mẫu (mock): hook đặt câu hỏi mở, gợi nhu cầu thực tế, CTA mềm dạng lưu bài.",
      source_type: "mock",
      relevance_score: 0.6,
    },
  ];
  return base.slice(0, Math.max(1, maxResults));
}

async function searchTavily(query: string, maxResults: number, timeoutMs = 8000): Promise<SearchResult[] | null> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false,
      }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { results?: unknown[] };
    const items = Array.isArray(json.results) ? json.results : [];
    return items.map((it) => {
      const r = (it ?? {}) as Record<string, unknown>;
      return {
        title: typeof r.title === "string" ? r.title : "",
        url: typeof r.url === "string" ? r.url : "",
        snippet: typeof r.content === "string" ? r.content.slice(0, 400) : null,
        content: null,
        source_type: "tavily",
        relevance_score: typeof r.score === "number" ? r.score : null,
      };
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function searchGoogleCse(query: string, maxResults: number, timeoutMs = 8000): Promise<SearchResult[] | null> {
  const key = process.env.GOOGLE_CSE_API_KEY?.trim();
  const cx = process.env.GOOGLE_CSE_CX?.trim();
  if (!key || !cx) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url =
      `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}` +
      `&cx=${encodeURIComponent(cx)}&num=${Math.min(10, maxResults)}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: unknown[] };
    const items = Array.isArray(json.items) ? json.items : [];
    return items.map((it) => {
      const r = (it ?? {}) as Record<string, unknown>;
      return {
        title: typeof r.title === "string" ? r.title : "",
        url: typeof r.link === "string" ? r.link : "",
        snippet: typeof r.snippet === "string" ? r.snippet : null,
        content: null,
        source_type: "google_cse",
        relevance_score: null,
      };
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Tìm kiếm web theo provider hiện tại. Thiếu key -> fallback mock.
 */
export async function searchWeb(
  query: string,
  options?: { maxResults?: number; timeoutMs?: number },
): Promise<SearchResult[]> {
  const maxResults = options?.maxResults ?? 5;
  const timeoutMs = options?.timeoutMs ?? 8000;
  const provider = getSearchProvider();

  if (provider === "tavily") {
    const r = await searchTavily(query, maxResults, timeoutMs);
    return r ?? mockResults(query, maxResults); // thiếu key -> mock
  }
  if (provider === "google_cse") {
    const r = await searchGoogleCse(query, maxResults, timeoutMs);
    return r ?? mockResults(query, maxResults);
  }
  return mockResults(query, maxResults);
}
