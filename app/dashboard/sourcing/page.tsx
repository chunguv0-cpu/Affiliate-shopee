import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Phase 20 — đã gộp vào "Công cụ thủ công" (tab Tìm link). Giữ route để tương thích ngược. */
export default async function SourcingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  redirect(status ? `/dashboard/manual-tools?tab=sourcing&status=${status}` : "/dashboard/manual-tools?tab=sourcing");
}
