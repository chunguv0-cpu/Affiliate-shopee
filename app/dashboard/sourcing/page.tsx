import Link from "next/link";

import EmptyState from "@/components/dashboard/EmptyState";
import PageHeader from "@/components/dashboard/PageHeader";
import SourcingCandidateCard from "@/components/dashboard/SourcingCandidateCard";
import { getSourcingCandidates } from "@/app/dashboard/sourcing/actions";
import type { SourcingStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const FILTERS: { key: string; label: string; status?: SourcingStatus }[] = [
  { key: "all", label: "Tất cả" },
  { key: "NEW", label: "Mới", status: "NEW" },
  { key: "SOURCING", label: "Đang tìm", status: "SOURCING" },
  { key: "LINK_READY", label: "Đã có link", status: "LINK_READY" },
  { key: "IMPORTED", label: "Đã import", status: "IMPORTED" },
  { key: "REJECTED", label: "Bỏ qua", status: "REJECTED" },
];

export default async function SourcingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  const res = await getSourcingCandidates(active.status);
  const items = res.ok ? res.items : [];

  return (
    <div>
      <PageHeader
        title="Danh sách tìm link affiliate"
        description="Theo dõi các sản phẩm AI gợi ý, tìm link affiliate, gắn sub_id và chuyển thành sản phẩm READY."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const isActive = f.key === active.key;
          const href = f.key === "all" ? "/dashboard/sourcing" : `/dashboard/sourcing?status=${f.key}`;
          return (
            <Link
              key={f.key}
              href={href}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive ? "bg-blue-600 text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {!res.ok ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{res.error}</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="🧲"
          title="Chưa có sản phẩm cần tìm link"
          description="Vào Gợi ý AI → mở một kế hoạch DISCOVERY → bấm 'Lưu vào danh sách tìm link' để thêm sản phẩm vào đây."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {items.map((c) => (
            <SourcingCandidateCard key={c.id} candidate={c} />
          ))}
        </div>
      )}
    </div>
  );
}
