import { PRODUCT_STATUS_LABELS, type ProductStatus } from "@/lib/types";

const STATUS_STYLES: Record<ProductStatus, string> = {
  NEW: "bg-blue-50 text-blue-700",
  ACTIVE: "bg-green-50 text-green-700",
  PAUSED: "bg-amber-50 text-amber-700",
  ARCHIVED: "bg-gray-100 text-gray-600",
};

export default function ProductStatusBadge({
  status,
}: {
  status: ProductStatus;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {PRODUCT_STATUS_LABELS[status]}
    </span>
  );
}
