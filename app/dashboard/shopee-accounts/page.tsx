import PageHeader from "@/components/dashboard/PageHeader";
import ShopeeAccountManager from "@/components/dashboard/ShopeeAccountManager";
import { getShopeeAccounts } from "@/app/dashboard/shopee-accounts/actions";

export const dynamic = "force-dynamic";

export default async function ShopeeAccountsPage() {
  const res = await getShopeeAccounts();
  const accounts = res.ok ? res.accounts : [];

  return (
    <div>
      <PageHeader
        title="Tài khoản Shopee"
        description="Thêm nhiều tài khoản Shopee với API riêng. AI dùng đúng API của từng tài khoản để tự quét sản phẩm, lấy link affiliate + ảnh thật, rồi tạo bài."
      />

      {!res.ok ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {res.error}
          <p className="mt-1 text-red-600">Kiểm tra đã chạy migration <code>add_shopee_accounts.sql</code> chưa.</p>
        </div>
      ) : null}

      <ShopeeAccountManager accounts={accounts} />
    </div>
  );
}
