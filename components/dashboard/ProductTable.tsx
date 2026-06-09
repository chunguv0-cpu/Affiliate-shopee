"use client";

import { useState, useTransition } from "react";

import EmptyState from "@/components/dashboard/EmptyState";
import GeneratePostButton from "@/components/dashboard/GeneratePostButton";
import ProductForm from "@/components/dashboard/ProductForm";
import ProductStatusBadge from "@/components/dashboard/ProductStatusBadge";
import { deleteProduct } from "@/app/dashboard/products/actions";
import type { Product } from "@/lib/types";

/** Định dạng ngày dạng dd/MM/yyyy (tránh lệch locale server/client). */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export default function ProductTable({ products }: { products: Product[] }) {
  const [editing, setEditing] = useState<Product | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
      if (!result.ok) {
        setError(result.error);
      }
    });
  }

  if (products.length === 0) {
    return (
      <EmptyState
        icon="🛍️"
        title="Chưa có sản phẩm nào"
        description="Dùng biểu mẫu phía trên để thêm sản phẩm affiliate đầu tiên."
      />
    );
  }

  return (
    <>
      {error ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Tên sản phẩm</th>
              <th className="px-4 py-3">Link affiliate</th>
              <th className="px-4 py-3">Ghi chú giá</th>
              <th className="px-4 py-3">Tệp khách</th>
              <th className="px-4 py-3">Góc bán hàng</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Ngày tạo</th>
              <th className="px-4 py-3 text-right">Hành động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {products.map((p) => (
              <tr key={p.id} className="align-top hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {p.product_name}
                </td>
                <td className="px-4 py-3">
                  <a
                    href={p.affiliate_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block max-w-[200px] truncate text-blue-600 hover:underline"
                    title={p.affiliate_link}
                  >
                    {p.affiliate_link}
                  </a>
                </td>
                <td className="px-4 py-3 text-gray-600">{p.price_note ?? "—"}</td>
                <td className="px-4 py-3 text-gray-600">
                  {p.target_customer ?? "—"}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {p.product_angle ?? "—"}
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
                    <GeneratePostButton productId={p.id} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal sửa sản phẩm */}
      {editing ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="mt-10 w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">
                Sửa sản phẩm
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Đóng"
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <ProductForm
              mode="edit"
              product={editing}
              onDone={() => setEditing(null)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
