import Link from "next/link";

import AffiliateLinkRow from "@/components/dashboard/AffiliateLinkRow";
import AffiliateLinksImportForm from "@/components/dashboard/AffiliateLinksImportForm";
import CsvImportPanel from "@/components/dashboard/CsvImportPanel";
import EmptyState from "@/components/dashboard/EmptyState";
import GeneratePostButton from "@/components/dashboard/GeneratePostButton";
import LinkStatusBadge from "@/components/dashboard/LinkStatusBadge";
import PageHeader from "@/components/dashboard/PageHeader";
import SourcingCandidateCard from "@/components/dashboard/SourcingCandidateCard";
import { getProducts } from "@/app/dashboard/products/actions";
import { getSourcingCandidates } from "@/app/dashboard/sourcing/actions";
import { generateSubId } from "@/lib/affiliate";
import type { SourcingStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "import", label: "Nhập link affiliate" },
  { key: "affiliate-links", label: "Quản lý affiliate links" },
  { key: "sourcing", label: "Tìm link thủ công" },
  { key: "products", label: "Sản phẩm lỗi / thiếu dữ liệu" },
  { key: "create-post", label: "Tạo bài thủ công" },
];

const SOURCING_FILTERS: { key: string; label: string; status?: SourcingStatus }[] = [
  { key: "all", label: "Tất cả" },
  { key: "NEW", label: "Mới", status: "NEW" },
  { key: "NEEDS_LINK", label: "Cần tìm link", status: "NEEDS_LINK" },
  { key: "SOURCING", label: "Đang tìm", status: "SOURCING" },
  { key: "PROVIDER_MISSING", label: "Thiếu provider", status: "PROVIDER_MISSING" },
  { key: "LINK_CONVERSION_FAILED", label: "Chuyển link lỗi", status: "LINK_CONVERSION_FAILED" },
  { key: "MANUAL_REQUIRED", label: "Cần xử lý tay", status: "MANUAL_REQUIRED" },
  { key: "LINK_READY", label: "Đã có link", status: "LINK_READY" },
  { key: "IMPORTED", label: "Đã import", status: "IMPORTED" },
  { key: "REJECTED", label: "Bỏ qua", status: "REJECTED" },
];

export default async function ManualToolsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; status?: string }>;
}) {
  const { tab, status } = await searchParams;
  const activeTab = TABS.find((t) => t.key === tab)?.key ?? "import";

  return (
    <div>
      <PageHeader
        title="Công cụ thủ công"
        description="Nhập link, quản lý affiliate link, tìm link thủ công và xử lý sản phẩm — dùng khi cần can thiệp tay. Workflow chính nằm ở AI Autopilot."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const isActive = t.key === activeTab;
          return (
            <Link
              key={t.key}
              href={`/dashboard/manual-tools?tab=${t.key}`}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive ? "bg-blue-600 text-white" : "border border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {activeTab === "import" ? <ImportTab /> : null}
      {activeTab === "affiliate-links" ? <AffiliateLinksTab /> : null}
      {activeTab === "sourcing" ? <SourcingTab statusKey={status} /> : null}
      {activeTab === "products" ? <ProductsTab /> : null}
      {activeTab === "create-post" ? <CreatePostTab /> : null}
    </div>
  );
}

function ImportTab() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-2 text-base font-semibold text-gray-900">Nhập link Affiliate hàng loạt</h3>
        <AffiliateLinksImportForm />
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="mb-2 text-base font-semibold text-gray-900">Import CSV nâng cao</h3>
        <CsvImportPanel />
      </div>
      <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
        <p className="font-medium text-gray-700">Lưu ý an toàn:</p>
        <ul className="mt-1 list-disc pl-5">
          <li>Chỉ enrich metadata công khai (Open Graph) — không login, không cookie.</li>
          <li>Sản phẩm import có <strong>link_status = READY</strong>, <strong>status = ACTIVE</strong>.</li>
          <li>Confidence &lt; 60 sẽ được đánh dấu “cần kiểm tra lại”.</li>
        </ul>
      </div>
    </div>
  );
}

async function AffiliateLinksTab() {
  const result = await getProducts();
  const products = result.ok ? result.products : [];
  const needLink = products.filter((p) => p.link_status !== "READY");
  return (
    <div className="space-y-5">
      {!result.ok ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>Không tải được dữ liệu.</strong> {result.error}
        </div>
      ) : null}
      <div>
        <h3 className="mb-3 text-base font-semibold text-gray-900">
          Affiliate links <span className="font-normal text-gray-400">({products.length})</span>
        </h3>
        {products.length === 0 ? (
          <EmptyState icon="🔗" title="Chưa có sản phẩm/link" description="Nhập link affiliate hoặc CSV ở tab đầu tiên." />
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2">Sản phẩm</th>
                  <th className="px-4 py-2">Trạng thái</th>
                  <th className="px-4 py-2">Sub ID</th>
                  <th className="px-4 py-2">Original URL</th>
                  <th className="px-4 py-2">Affiliate link</th>
                  <th className="px-4 py-2">Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {products.slice(0, 150).map((p) => (
                  <tr key={p.id} className="border-t border-gray-100 align-top">
                    <td className="px-4 py-2 text-gray-800">{p.product_name}</td>
                    <td className="px-4 py-2"><LinkStatusBadge status={p.link_status} /></td>
                    <td className="px-4 py-2 text-xs text-gray-600">{p.sub_id ?? "—"}</td>
                    <td className="px-4 py-2">
                      {p.original_url ? (
                        <a href={p.original_url} target="_blank" rel="noopener noreferrer" className="block max-w-[220px] truncate text-xs text-gray-500 hover:underline">
                          {p.original_url}
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {p.affiliate_link ? (
                        <a href={p.affiliate_link} target="_blank" rel="noopener noreferrer" className="block max-w-[240px] truncate text-blue-600 hover:underline">
                          {p.affiliate_link}
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">{p.link_note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-3 text-base font-semibold text-gray-900">
          Cần chuyển link <span className="font-normal text-gray-400">({needLink.length})</span>
        </h3>
        {needLink.length === 0 ? (
          <EmptyState icon="✅" title="Tất cả sản phẩm đã có link affiliate hợp lệ" description="Không có sản phẩm nào cần chuyển link." />
        ) : (
          <div className="space-y-3">
            {needLink.map((p) => (
              <AffiliateLinkRow key={p.id} product={p} suggestedSubId={generateSubId(p.product_name)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

async function SourcingTab({ statusKey }: { statusKey?: string }) {
  const active = SOURCING_FILTERS.find((f) => f.key === statusKey) ?? SOURCING_FILTERS[0];
  const res = await getSourcingCandidates(active.status);
  const items = res.ok ? res.items : [];
  return (
    <div>
      <h3 className="mb-1 text-base font-semibold text-gray-900">Tìm link thủ công / cần xử lý</h3>
      <p className="mb-3 text-sm text-gray-500">
        Gồm sản phẩm AI gợi ý cần tìm link, và các cơ hội từ AI Autopilot bị thiếu provider / chuyển link thất bại (xem ghi chú từng thẻ).
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        {SOURCING_FILTERS.map((f) => {
          const isActive = f.key === active.key;
          const href = f.key === "all" ? "/dashboard/manual-tools?tab=sourcing" : `/dashboard/manual-tools?tab=sourcing&status=${f.key}`;
          return (
            <Link
              key={f.key}
              href={href}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
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
        <EmptyState icon="🧲" title="Chưa có sản phẩm cần tìm link" description="Các cơ hội cần xử lý thủ công từ AI Autopilot sẽ xuất hiện ở đây." />
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

async function ProductsTab() {
  const result = await getProducts();
  const products = result.ok ? result.products : [];
  const needsAttention = products.filter((p) => {
    const hasImage = !!p.image_url || (Array.isArray(p.source_product_images) && p.source_product_images.length > 0);
    return p.link_status !== "READY" || !hasImage;
  });
  return (
    <div>
      <h3 className="mb-1 text-base font-semibold text-gray-900">
        Sản phẩm cần xử lý thủ công <span className="font-normal text-gray-400">({needsAttention.length})</span>
      </h3>
      <p className="mb-3 text-sm text-gray-500">Sản phẩm thiếu link hợp lệ hoặc thiếu ảnh nguồn. Bấm để mở trang Sản phẩm và chỉnh sửa.</p>
      {needsAttention.length === 0 ? (
        <EmptyState icon="✅" title="Không có sản phẩm cần xử lý" description="Tất cả sản phẩm đều có link READY và ảnh nguồn." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">Sản phẩm</th>
                <th className="px-4 py-2">Vấn đề</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {needsAttention.slice(0, 100).map((p) => {
                const hasImage = !!p.image_url || (Array.isArray(p.source_product_images) && p.source_product_images.length > 0);
                const issues = [p.link_status !== "READY" ? "Thiếu link READY" : null, !hasImage ? "Thiếu ảnh" : null].filter(Boolean).join(", ");
                return (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-4 py-2 text-gray-800">{p.product_name}</td>
                    <td className="px-4 py-2 text-amber-700">{issues}</td>
                    <td className="px-4 py-2 text-right">
                      <Link href="/dashboard/products" className="text-blue-600 hover:underline">
                        Sửa
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

async function CreatePostTab() {
  const result = await getProducts();
  const products = result.ok ? result.products : [];
  const readyProducts = products.filter((p) => p.link_status === "READY" && !!p.affiliate_link && p.status !== "ARCHIVED");
  return (
    <div>
      {!result.ok ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>Không tải được dữ liệu.</strong> {result.error}
        </div>
      ) : null}
      <h3 className="mb-1 text-base font-semibold text-gray-900">
        Tạo bài thủ công <span className="font-normal text-gray-400">({readyProducts.length})</span>
      </h3>
      <p className="mb-3 text-sm text-gray-500">
        Dùng khi cần tạo bài riêng cho một sản phẩm READY mà không đi qua AI Autopilot.
      </p>
      {readyProducts.length === 0 ? (
        <EmptyState icon="📝" title="Chưa có sản phẩm READY" description="Sản phẩm cần có link affiliate hợp lệ trước khi tạo bài." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2">Sản phẩm</th>
                <th className="px-4 py-2">Link affiliate</th>
                <th className="px-4 py-2 text-right">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {readyProducts.slice(0, 100).map((p) => (
                <tr key={p.id} className="border-t border-gray-100 align-top">
                  <td className="px-4 py-2 text-gray-800">{p.product_name}</td>
                  <td className="px-4 py-2">
                    {p.affiliate_link ? (
                      <a href={p.affiliate_link} target="_blank" rel="noopener noreferrer" className="block max-w-[360px] truncate text-blue-600 hover:underline">
                        {p.affiliate_link}
                      </a>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">
                    <GeneratePostButton productId={p.id} />
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
