"use client";

import { useMemo, useState, useTransition } from "react";

import CaptureSourceButton from "@/components/dashboard/CaptureSourceButton";
import EmptyState from "@/components/dashboard/EmptyState";
import GeneratePostButton from "@/components/dashboard/GeneratePostButton";
import LinkStatusBadge from "@/components/dashboard/LinkStatusBadge";
import ProductForm from "@/components/dashboard/ProductForm";
import ProductStatusBadge from "@/components/dashboard/ProductStatusBadge";
import { deleteProduct, revalidateAllProductLinks, revalidateProductLink } from "@/app/dashboard/products/actions";
import { PRODUCT_LIFE_STATUS_LABELS, type Product } from "@/lib/types";
import { isProductDead, isProductReady } from "@/lib/affiliate";
import { hasValidProductImage } from "@/lib/shopee/image-url";

type LinkFilter = "ALL" | "NEED_CONVERT" | "READY" | "ERROR";

// "Sẵn sàng" = link READY + sản phẩm không chết. "Link lỗi" gộp cả link sai LẪN sản phẩm chết.
const FILTER_PREDICATE: Record<Exclude<LinkFilter, "ALL">, (p: Product) => boolean> = {
  NEED_CONVERT: (p) => p.link_status === "NEED_CONVERT",
  READY: (p) => isProductReady(p),
  ERROR: (p) => p.link_status === "INVALID" || isProductDead(p.product_status),
};

const FILTERS: { key: LinkFilter; label: string }[] = [
  { key: "ALL", label: "Tất cả" },
  { key: "NEED_CONVERT", label: "Cần chuyển link" },
  { key: "READY", label: "Sẵn sàng" },
  { key: "ERROR", label: "Link lỗi" },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export default function ProductTable({
  products,
  captureSecret,
  appUrl,
}: {
  products: Product[];
  captureSecret: string | null;
  appUrl: string;
}) {
  const [editing, setEditing] = useState<Product | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [revalidatingId, setRevalidatingId] = useState<string | null>(null);
  const [revalidatingAll, setRevalidatingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<LinkFilter>("ALL");
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(
    () => (filter === "ALL" ? products : products.filter((p) => FILTER_PREDICATE[filter](p))),
    [products, filter],
  );

  function handleDelete(product: Product) {
    const confirmed = window.confirm(
      `Bạn có chắc muốn xóa sản phẩm "${product.product_name}"? Hành động này không thể hoàn tác.`,
    );
    if (!confirmed) return;
    setError(null);
    setDeletingId(product.id);
    startTransition(async () => {
      const result = await deleteProduct(product.id);
      setDeletingId(null);
      if (!result.ok) setError(result.error);
    });
  }

  function handleRevalidate(product: Product) {
    setError(null);
    setNotice(null);
    setRevalidatingId(product.id);
    startTransition(async () => {
      const result = await revalidateProductLink(product.id);
      setRevalidatingId(null);
      if (result.ok) setNotice(`"${product.product_name}": ${result.message}`);
      else setError(result.error);
    });
  }

  function handleRevalidateAll() {
    setError(null);
    setNotice(null);
    setRevalidatingAll(true);
    startTransition(async () => {
      const result = await revalidateAllProductLinks();
      setRevalidatingAll(false);
      if (result.ok) {
        setNotice(`Đã kiểm tra ${result.checked} link: ${result.active} còn sống, ${result.dead} chết, ${result.unknown} chưa rõ.`);
      } else setError(result.error);
    });
  }

  return (
    <>
      {/* Filter theo trạng thái link + nút kiểm tra lại toàn bộ */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const count =
              f.key === "ALL" ? products.length : products.filter((p) => FILTER_PREDICATE[f.key as Exclude<LinkFilter, "ALL">](p)).length;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  active ? "bg-blue-600 text-white" : "border border-gray-300 text-gray-700 hover:bg-gray-50"
                }`}
              >
                {f.label} <span className={active ? "text-blue-100" : "text-gray-400"}>({count})</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={handleRevalidateAll}
          disabled={revalidatingAll || pending}
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
          title="Kiểm tra lại theo batch nhỏ: link sống → Sẵn sàng, link chết → chuyển sang Link lỗi."
        >
          {revalidatingAll ? "Đang kiểm tra..." : "🔁 Kiểm tra lại toàn bộ link"}
        </button>
      </div>

      {notice ? (
        <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          icon="🛍️"
          title="Không có sản phẩm"
          description="Không có sản phẩm nào khớp bộ lọc hiện tại."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Tên sản phẩm</th>
                <th className="px-4 py-3">Link</th>
                <th className="px-4 py-3">Sub ID</th>
                <th className="px-4 py-3">Trạng thái link</th>
                <th className="px-4 py-3">Trạng thái</th>
                <th className="px-4 py-3">Ngày tạo</th>
                <th className="px-4 py-3 text-right">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((p) => (
                <tr key={p.id} className="align-top hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{p.product_name}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      {p.affiliate_link ? (
                        <a
                          href={p.affiliate_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="max-w-[220px] truncate text-blue-600 hover:underline"
                          title={p.affiliate_link}
                        >
                          aff: {p.affiliate_link}
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400">aff: (chưa có)</span>
                      )}
                      {p.original_url ? (
                        <a
                          href={p.original_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="max-w-[220px] truncate text-xs text-gray-500 hover:underline"
                          title={p.original_url}
                        >
                          gốc: {p.original_url}
                        </a>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{p.sub_id ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <LinkStatusBadge status={p.link_status} />
                      {isProductDead(p.product_status) ? (
                        <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                          ⚠️ Sản phẩm không tồn tại
                        </span>
                      ) : p.product_status === "ACTIVE" && isProductReady(p) ? (
                        <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                          ✓ Sẵn sàng
                        </span>
                      ) : p.product_status && p.product_status !== "ACTIVE" ? (
                        <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
                          {PRODUCT_LIFE_STATUS_LABELS[p.product_status] ?? "Chưa kiểm chứng"}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <ProductStatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                    {formatDate(p.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(p)}
                          className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                        >
                          Sửa
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(p)}
                          disabled={pending && deletingId === p.id}
                          className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          {pending && deletingId === p.id ? "Đang xóa..." : "Xóa"}
                        </button>
                      </div>
                      <CaptureSourceButton
                        productId={p.id}
                        productName={p.product_name}
                        affiliateLink={p.affiliate_link}
                        captureSecret={captureSecret}
                        appUrl={appUrl}
                        captured={hasValidProductImage(p.source_product_images, p.image_url)}
                      />
                      <button
                        type="button"
                        onClick={() => handleRevalidate(p)}
                        disabled={pending && revalidatingId === p.id}
                        className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        title="Kiểm tra lại sản phẩm còn tồn tại trên Shopee không."
                      >
                        {pending && revalidatingId === p.id ? "Đang kiểm tra..." : "🔍 Kiểm tra lại"}
                      </button>
                      <GeneratePostButton
                        productId={p.id}
                        disabled={isProductDead(p.product_status) || !isProductReady(p)}
                        disabledReason={
                          isProductDead(p.product_status)
                            ? "Sản phẩm không tồn tại — không thể tạo bài."
                            : !isProductReady(p)
                              ? "Cần link affiliate hợp lệ trước khi tạo bài."
                              : undefined
                        }
                      />
                      {isProductDead(p.product_status) && p.affiliate_link ? (
                        <button
                          type="button"
                          onClick={() => setEditing(p)}
                          className="rounded-md border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
                          title="Sửa link / tìm sản phẩm thay thế."
                        >
                          ✏️ Sửa link
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="mt-10 w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Sửa sản phẩm</h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Đóng"
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <ProductForm mode="edit" product={editing} onDone={() => setEditing(null)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
