import PageHeader from "@/components/dashboard/PageHeader";
import ProductForm from "@/components/dashboard/ProductForm";
import ProductTable from "@/components/dashboard/ProductTable";
import { getProducts } from "@/app/dashboard/products/actions";

// Luôn lấy dữ liệu mới từ database mỗi lần truy cập.
export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const result = await getProducts();
  const products = result.ok ? result.products : [];
  const captureSecret = process.env.PRODUCT_CAPTURE_SECRET?.trim() || null;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";

  return (
    <div>
      <PageHeader
        title="Quản lý sản phẩm Affiliate"
        description="Thêm link Shopee Affiliate, ghi chú ưu đãi và chuẩn bị dữ liệu cho AI tạo bài."
      />

      {!result.ok ? (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>Không tải được dữ liệu.</strong> {result.error}
          <p className="mt-1 text-red-600">
            Kiểm tra lại biến môi trường Supabase trong <code>.env.local</code> và
            đảm bảo đã chạy <code>supabase/schema.sql</code>.
          </p>
        </div>
      ) : null}

      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-4 text-base font-semibold text-gray-900">
          Thêm sản phẩm
        </h3>
        <ProductForm mode="create" />
      </div>

      <ProductTable products={products} captureSecret={captureSecret} appUrl={appUrl} />
    </div>
  );
}
