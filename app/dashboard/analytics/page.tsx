import Link from "next/link";

import PageHeader from "@/components/dashboard/PageHeader";
import StatCard from "@/components/dashboard/StatCard";
import { getAnalytics } from "@/app/dashboard/analytics/actions";

export const dynamic = "force-dynamic";

function num(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
function money(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")}đ`;
}
function pct(n: number): string {
  return `${n.toFixed(2)}%`;
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; sub_id?: string }>;
}) {
  const sp = await searchParams;
  const filters = {
    from: sp.from || null,
    to: sp.to || null,
    subId: sp.sub_id || null,
  };

  const data = await getAnalytics(filters);

  const inputClass =
    "rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

  return (
    <div>
      <PageHeader
        title="Hiệu quả Affiliate"
        description="Theo dõi click, đơn, hoa hồng theo sub_id, sản phẩm, chiến dịch và bài đăng."
        action={
          <Link
            href="/dashboard/analytics/import"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Import báo cáo
          </Link>
        }
      />

      {!data.ok ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>Không tải được dữ liệu.</strong> {data.error}
        </div>
      ) : null}

      {/* Filter */}
      <form method="GET" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs text-gray-500">Từ ngày</label>
          <input type="date" name="from" defaultValue={sp.from ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Đến ngày</label>
          <input type="date" name="to" defaultValue={sp.to ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">Sub ID</label>
          <input type="text" name="sub_id" defaultValue={sp.sub_id ?? ""} list="subids" placeholder="fb_page_..." className={inputClass} />
          <datalist id="subids">
            {data.availableSubIds.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <button type="submit" className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          Lọc
        </button>
        <Link href="/dashboard/analytics" className="px-2 py-1.5 text-sm text-gray-500 hover:underline">
          Xóa lọc
        </Link>
      </form>

      {data.reportCount === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center">
          <div className="mb-3 text-4xl">📊</div>
          <h3 className="text-base font-semibold text-gray-900">Chưa có dữ liệu báo cáo</h3>
          <p className="mt-1 text-sm text-gray-500">
            Hãy <Link href="/dashboard/analytics/import" className="text-blue-600 underline">import báo cáo Affiliate</Link> để xem hiệu quả.
          </p>
        </div>
      ) : (
        <>
          {/* Cards tổng quan */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Tổng clicks" value={num(data.totals.clicks)} icon="👆" accent="blue" />
            <StatCard label="Tổng đơn" value={num(data.totals.orders)} icon="🛒" accent="green" />
            <StatCard label="Tổng hoa hồng" value={money(data.totals.commission)} icon="💰" accent="amber" />
            <StatCard label="Conversion" value={pct(data.totals.conversionRate)} icon="📈" accent="green" hint="orders / clicks" />
            <StatCard label="EPC" value={money(data.totals.epc)} icon="🎯" accent="blue" hint="hoa hồng / click" />
          </div>

          {/* Nhận xét nhanh */}
          {data.remarks.length > 0 ? (
            <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
              <h3 className="mb-2 text-base font-semibold text-gray-900">Nhận xét nhanh</h3>
              <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
                {data.remarks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Theo sub_id */}
          <h3 className="mb-3 mt-8 text-base font-semibold text-gray-900">Hiệu quả theo Sub ID</h3>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Sub ID</th>
                  <th className="px-4 py-3 text-right">Clicks</th>
                  <th className="px-4 py-3 text-right">Đơn</th>
                  <th className="px-4 py-3 text-right">Hoa hồng</th>
                  <th className="px-4 py-3 text-right">Conversion</th>
                  <th className="px-4 py-3 text-right">EPC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.bySubId.map((r) => (
                  <tr key={r.sub_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{r.sub_id}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{num(r.clicks)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{num(r.orders)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{money(r.commission)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{pct(r.conversionRate)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{money(r.epc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Theo sản phẩm */}
          <h3 className="mb-3 mt-8 text-base font-semibold text-gray-900">Hiệu quả theo sản phẩm</h3>
          {data.byProduct.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
              Chưa map được báo cáo với sản phẩm. Kiểm tra sub_id / affiliate_link của sản phẩm.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Sản phẩm</th>
                    <th className="px-4 py-3">Chiến dịch</th>
                    <th className="px-4 py-3 text-right">Clicks</th>
                    <th className="px-4 py-3 text-right">Đơn</th>
                    <th className="px-4 py-3 text-right">Hoa hồng</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.byProduct.map((r) => (
                    <tr key={r.product_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{r.product_name}</td>
                      <td className="px-4 py-3 text-gray-500">{r.campaigns.join(", ") || "—"}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{num(r.clicks)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{num(r.orders)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{money(r.commission)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Theo bài đăng */}
          <h3 className="mb-3 mt-8 text-base font-semibold text-gray-900">Hiệu quả theo bài đăng (gần đúng)</h3>
          {data.byPost.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
              Chưa map được báo cáo với bài đăng. Kiểm tra sub_id.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Sản phẩm</th>
                    <th className="px-4 py-3">Góc viết</th>
                    <th className="px-4 py-3">Chiến dịch</th>
                    <th className="px-4 py-3">Lịch / Đã đăng</th>
                    <th className="px-4 py-3 text-right">Clicks</th>
                    <th className="px-4 py-3 text-right">Đơn</th>
                    <th className="px-4 py-3 text-right">Hoa hồng</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.byPost.map((r) => (
                    <tr key={r.post_id} className="align-top hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{r.product_name}</td>
                      <td className="px-4 py-3 text-gray-600">{r.content_angle_variant ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-500">{r.campaign_name ?? "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500">
                        {fmtDateTime(r.scheduled_at)}
                        {r.published_at ? ` → ${fmtDateTime(r.published_at)}` : ""}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{num(r.clicks)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{num(r.orders)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{money(r.commission)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-4 py-2 text-xs text-gray-400">
                * Số liệu theo bài đăng là gần đúng — gộp theo sub_id của sản phẩm (nhiều bài cùng sub_id sẽ hiển thị cùng số liệu).
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
