import AffiliateLinksImportForm from "@/components/dashboard/AffiliateLinksImportForm";
import PageHeader from "@/components/dashboard/PageHeader";

export const dynamic = "force-dynamic";

export default function ImportProductsPage() {
  return (
    <div>
      <PageHeader
        title="Nhập link Affiliate hàng loạt"
        description="Dán mỗi dòng một link Affiliate Shopee đã chuyển đổi. Hệ thống sẽ tự đọc link và dùng AI để điền thông tin sản phẩm."
      />

      <AffiliateLinksImportForm />

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
        <p className="font-medium text-gray-700">Lưu ý an toàn:</p>
        <ul className="mt-1 list-disc pl-5">
          <li>Chỉ enrich metadata công khai (Open Graph) — không login, không cookie, không tự động hóa trình duyệt.</li>
          <li>Shopee có thể chặn bot nên metadata có thể thiếu; khi đó AI suy luận từ link và đặt confidence thấp.</li>
          <li>Sản phẩm import có <strong>link_status = READY</strong>, <strong>status = ACTIVE</strong>; không tự tạo caption/chiến dịch.</li>
          <li>Confidence &lt; 60 sẽ được đánh dấu “cần kiểm tra lại” trong ghi chú link.</li>
        </ul>
      </div>
    </div>
  );
}
