import Link from "next/link";

import CampaignForm from "@/components/dashboard/CampaignForm";
import EmptyState from "@/components/dashboard/EmptyState";
import PageHeader from "@/components/dashboard/PageHeader";
import { getActiveProducts, getCampaigns } from "@/app/dashboard/campaigns/actions";
import { CAMPAIGN_STATUS_LABELS } from "@/lib/types";
import { formatDateTimeVi } from "@/lib/utils/date";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  ACTIVE: "bg-green-50 text-green-700",
  COMPLETED: "bg-blue-50 text-blue-700",
  PAUSED: "bg-amber-50 text-amber-700",
};

export default async function CampaignsPage() {
  const [productsRes, campaignsRes] = await Promise.all([
    getActiveProducts(),
    getCampaigns(),
  ]);

  const products = productsRes.ok ? productsRes.products : [];
  const items = campaignsRes.ok ? campaignsRes.items : [];

  return (
    <div>
      <PageHeader
        title="Chiến dịch đăng bài"
        description="Chọn nhiều sản phẩm, AI tạo caption và tự phân bổ lịch đăng hàng loạt. Cron sẽ tự đăng khi đến giờ."
      />

      {!productsRes.ok ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {productsRes.error}
        </div>
      ) : null}

      <div className="mb-8 rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-4 text-base font-semibold text-gray-900">Tạo chiến dịch mới</h3>
        <CampaignForm products={products} />
      </div>

      <h3 className="mb-3 text-base font-semibold text-gray-900">Danh sách chiến dịch</h3>

      {!campaignsRes.ok ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {campaignsRes.error}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="🚀"
          title="Chưa có chiến dịch nào"
          description="Tạo chiến dịch đầu tiên để AI tự phân bổ lịch đăng."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Tên chiến dịch</th>
                <th className="px-4 py-3">Trạng thái</th>
                <th className="px-4 py-3">Bắt đầu → Kết thúc</th>
                <th className="px-4 py-3 text-center">Tổng bài</th>
                <th className="px-4 py-3 text-center">READY</th>
                <th className="px-4 py-3 text-center">PUBLISHED</th>
                <th className="px-4 py-3 text-center">FAILED</th>
                <th className="px-4 py-3 text-right">Xem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map(({ campaign, stats }) => (
                <tr key={campaign.id} className="align-top hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{campaign.name}</p>
                    {campaign.description ? (
                      <p className="mt-0.5 text-xs text-gray-400">{campaign.description}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        STATUS_STYLES[campaign.status] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {CAMPAIGN_STATUS_LABELS[campaign.status] ?? campaign.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                    {formatDateTimeVi(campaign.start_at)}
                    <br />
                    {formatDateTimeVi(campaign.end_at)}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-700">{stats.total}</td>
                  <td className="px-4 py-3 text-center text-green-700">{stats.ready}</td>
                  <td className="px-4 py-3 text-center text-blue-700">{stats.published}</td>
                  <td className="px-4 py-3 text-center text-red-700">{stats.failed}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href="/dashboard/posts" className="text-xs font-medium text-blue-600 hover:underline">
                      Xem bài →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
