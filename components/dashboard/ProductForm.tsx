"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";

import { createProduct, updateProduct } from "@/app/dashboard/products/actions";
import { PRODUCT_STATUSES, PRODUCT_STATUS_LABELS, type Product } from "@/lib/types";

type ProductFormProps = {
  mode: "create" | "edit";
  /** Sản phẩm cần sửa (bắt buộc khi mode = "edit"). */
  product?: Product;
  /** Gọi khi thao tác thành công (ví dụ đóng modal sửa). */
  onDone?: () => void;
};

const inputClass =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";
const labelClass = "mb-1 block text-sm font-medium text-gray-700";

export default function ProductForm({ mode, product, onDone }: ProductFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result =
        mode === "edit" && product
          ? await updateProduct(product.id, formData)
          : await createProduct(formData);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      if (mode === "create") {
        formRef.current?.reset();
      }
      onDone?.();
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="product_name">
            Tên sản phẩm <span className="text-red-500">*</span>
          </label>
          <input
            id="product_name"
            name="product_name"
            type="text"
            required
            defaultValue={product?.product_name ?? ""}
            placeholder="VD: Tai nghe Bluetooth XYZ"
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="original_url">
            Link gốc Shopee (original_url)
          </label>
          <input
            id="original_url"
            name="original_url"
            type="url"
            defaultValue={product?.original_url ?? ""}
            placeholder="https://shopee.vn/..."
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="affiliate_link">
            Link affiliate (s.shopee.vn / shope.ee)
          </label>
          <input
            id="affiliate_link"
            name="affiliate_link"
            type="url"
            defaultValue={product?.affiliate_link ?? ""}
            placeholder="https://s.shopee.vn/..."
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-400">
            Cần Link gốc HOẶC Link affiliate. Trạng thái link tự xác định theo link
            affiliate (s.shopee.vn / shope.ee = Sẵn sàng).
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="sub_id">
            Sub ID (để trống sẽ tự sinh)
          </label>
          <input
            id="sub_id"
            name="sub_id"
            type="text"
            defaultValue={product?.sub_id ?? ""}
            placeholder="fb_page_ten-sp_20260610"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="link_note">
            Ghi chú link
          </label>
          <input
            id="link_note"
            name="link_note"
            type="text"
            defaultValue={product?.link_note ?? ""}
            placeholder="VD: chờ chuyển link, link hết hạn..."
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="price_note">
            Ghi chú giá / ưu đãi
          </label>
          <input
            id="price_note"
            name="price_note"
            type="text"
            defaultValue={product?.price_note ?? ""}
            placeholder="VD: Giảm 30%, freeship"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="target_customer">
            Tệp khách hàng
          </label>
          <input
            id="target_customer"
            name="target_customer"
            type="text"
            defaultValue={product?.target_customer ?? ""}
            placeholder="VD: Dân văn phòng, sinh viên"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="product_angle">
            Góc bán hàng
          </label>
          <input
            id="product_angle"
            name="product_angle"
            type="text"
            defaultValue={product?.product_angle ?? ""}
            placeholder="VD: Tiết kiệm thời gian"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="image_url">
            Link ảnh
          </label>
          <input
            id="image_url"
            name="image_url"
            type="url"
            defaultValue={product?.image_url ?? ""}
            placeholder="https://..."
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="status">
            Trạng thái
          </label>
          <select
            id="status"
            name="status"
            defaultValue={product?.status ?? "NEW"}
            className={inputClass}
          >
            {PRODUCT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PRODUCT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        {mode === "edit" ? (
          <button
            type="button"
            onClick={() => onDone?.()}
            disabled={pending}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Hủy
          </button>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending
            ? "Đang lưu..."
            : mode === "edit"
              ? "Lưu thay đổi"
              : "Thêm sản phẩm"}
        </button>
      </div>
    </form>
  );
}
