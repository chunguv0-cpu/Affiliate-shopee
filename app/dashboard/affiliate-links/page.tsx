import AffiliateLinkRow from "@/components/dashboard/AffiliateLinkRow";
import CsvImportPanel from "@/components/dashboard/CsvImportPanel";
import EmptyState from "@/components/dashboard/EmptyState";
import PageHeader from "@/components/dashboard/PageHeader";
import { getProducts } from "@/app/dashboard/products/actions";
import { generateSubId } from "@/lib/affiliate";

export const dynamic = "force-dynamic";

export default async function AffiliateLinksPage() {
  const result = await getProducts();
  const products = result.ok ? result.products : [];

  // Sản phẩm cần xử lý link (chưa READY).
  const needLink = products.filter((p) => p.link_status !== "READY");

  return (
    <div>
      <PageHeader
        title="Affiliate Link Manager"
        description="Chuyển link gốc Shopee thành link affiliate hợp lệ (s.shopee.vn / shope.ee) trước khi tạo bài."
      />

      {!result.ok ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>Không tải được dữ liệu.</strong> {result.error}
        </div>
      ) : null}

      <div className="mb-8">
        <CsvImportPanel />
      </div>

      <h3 className="mb-3 text-base font-semibold text-gray-900">
        Cần chuyển link{" "}
        <span className="font-normal text-gray-400">({needLink.length})</span>
      </h3>

      {needLink.length === 0 ? (
        <EmptyState
          icon="🔗"
          title="Tất cả sản phẩm đã có link affiliate hợp lệ"
          description="Không có sản phẩm nào cần chuyển link. Bạn có thể thêm sản phẩm mới ở mục Sản phẩm."
        />
      ) : (
        <div className="space-y-3">
          {needLink.map((p) => (
            <AffiliateLinkRow
              key={p.id}
              product={p}
              suggestedSubId={generateSubId(p.product_name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
