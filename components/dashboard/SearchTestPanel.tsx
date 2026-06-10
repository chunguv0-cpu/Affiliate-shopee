"use client";

import { useState, type FormEvent } from "react";

type SearchItem = { title: string; url: string; snippet?: string | null };

export default function SearchTestPanel({ provider }: { provider: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchItem[] | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResults(null);
    const fd = new FormData(event.currentTarget);
    const query = String(fd.get("query") ?? "");
    try {
      const res = await fetch("/api/research/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Lỗi không xác định.");
        return;
      }
      setResults(json.results ?? []);
    } catch {
      setError("Không gọi được API.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">Kiểm tra Search</h3>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
          Provider: {provider}
        </span>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
        <input
          name="query"
          type="text"
          required
          defaultValue="mẹ bỉm nên mua gì khi săn sale shopee"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading}
          className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Đang tìm..." : "Test Search"}
        </button>
      </form>

      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      {results ? (
        results.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">Không có kết quả.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {results.map((r, i) => (
              <li key={i} className="border-b border-gray-100 pb-2 last:border-0">
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline">
                  {r.title || r.url}
                </a>
                {r.snippet ? <p className="mt-0.5 text-xs text-gray-500">{r.snippet}</p> : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
