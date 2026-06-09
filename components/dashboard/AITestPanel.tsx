"use client";

import { useState, type FormEvent } from "react";

type CaptionData = {
  caption: string;
  hook: string;
  score: number;
  safety_notes: string;
  should_publish: boolean;
};

type ApiResponse =
  | { ok: true; provider: string; data: CaptionData }
  | { ok: false; error: string };

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
const labelClass = "mb-1 block text-sm font-medium text-gray-700";

export default function AITestPanel({ provider }: { provider: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ provider: string; data: CaptionData } | null>(
    null,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    const formData = new FormData(event.currentTarget);
    const payload = {
      product_name: String(formData.get("product_name") ?? ""),
      affiliate_link: String(formData.get("affiliate_link") ?? ""),
      price_note: String(formData.get("price_note") ?? ""),
      target_customer: String(formData.get("target_customer") ?? ""),
      product_angle: String(formData.get("product_angle") ?? ""),
    };

    try {
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json: ApiResponse = await res.json();

      if (!json.ok) {
        setError(json.error);
        return;
      }
      setResult({ provider: json.provider, data: json.data });
    } catch {
      setError("Không gọi được API. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">
          Kiểm tra AI Agent
        </h3>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
          🤖 Provider: {provider}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="ai_product_name">
              Tên sản phẩm <span className="text-red-500">*</span>
            </label>
            <input
              id="ai_product_name"
              name="product_name"
              type="text"
              required
              defaultValue="Khăn ướt"
              className={inputClass}
            />
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="ai_affiliate_link">
              Link affiliate <span className="text-red-500">*</span>
            </label>
            <input
              id="ai_affiliate_link"
              name="affiliate_link"
              type="url"
              required
              defaultValue="https://s.shopee.vn/6AiQkcl6UH"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="ai_price_note">
              Ghi chú giá / ưu đãi
            </label>
            <input
              id="ai_price_note"
              name="price_note"
              type="text"
              defaultValue="khoảng 1k-9k, giá có thể thay đổi theo thời điểm"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="ai_target_customer">
              Tệp khách hàng
            </label>
            <input
              id="ai_target_customer"
              name="target_customer"
              type="text"
              defaultValue="mẹ bỉm, gia đình có em bé"
              className={inputClass}
            />
          </div>

          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="ai_product_angle">
              Góc bán hàng
            </label>
            <input
              id="ai_product_angle"
              name="product_angle"
              type="text"
              defaultValue="deal rẻ, mua dự trữ"
              className={inputClass}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Đang tạo caption..." : "Test tạo caption"}
        </button>
      </form>

      {error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-5 space-y-4 border-t border-gray-100 pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              Provider: {result.provider}
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                result.data.score >= 80
                  ? "bg-green-50 text-green-700"
                  : result.data.score >= 60
                    ? "bg-amber-50 text-amber-700"
                    : "bg-red-50 text-red-700"
              }`}
            >
              Điểm: {result.data.score}
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                result.data.should_publish
                  ? "bg-green-50 text-green-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {result.data.should_publish ? "Nên đăng ✅" : "Chưa nên đăng ⛔"}
            </span>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Hook
            </p>
            <p className="mt-1 text-sm text-gray-900">{result.data.hook || "—"}</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Caption
            </p>
            <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-sm text-gray-800">
              {result.data.caption || "—"}
            </pre>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Ghi chú an toàn
            </p>
            <p className="mt-1 text-sm text-gray-600">
              {result.data.safety_notes || "—"}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
