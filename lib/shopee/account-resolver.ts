import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ShopeeApiCredential } from "@/lib/shopee/affiliate-api";

/**
 * Phase 21 — Resolve Shopee API credential server-side.
 * Order: campaign.shopee_account_id -> default active shopee_accounts.
 * Credential vẫn dùng app_id/app_secret (Shopee Affiliate Open API ký SHA256).
 * KHÔNG log token/secret.
 */

export type ResolvedShopeeAccount = {
  account_id: string | null;
  credential: ShopeeApiCredential | null;
  source: "campaign" | "default" | "none";
};

function toCredential(row: Record<string, unknown> | undefined | null): ShopeeApiCredential | null {
  if (!row) return null;
  const appId = (row.app_id as string | null)?.trim();
  const secret = (row.app_secret as string | null)?.trim();
  if (!appId || !secret) return null;
  return { app_id: appId, app_secret: secret, api_endpoint: (row.api_endpoint as string | null) ?? null };
}

export async function resolveShopeeAccount(
  supabase: SupabaseClient,
  accountId?: string | null,
): Promise<ResolvedShopeeAccount> {
  if (accountId) {
    const { data } = await supabase
      .from("shopee_accounts")
      .select("id, app_id, app_secret, api_endpoint, status")
      .eq("id", accountId)
      .limit(1)
      .maybeSingle();
    if (data && data.status === "ACTIVE") {
      const cred = toCredential(data as Record<string, unknown>);
      if (cred) return { account_id: String(data.id), credential: cred, source: "campaign" };
    }
  }
  const { data: rows } = await supabase
    .from("shopee_accounts")
    .select("id, app_id, app_secret, api_endpoint, status, is_default, last_used_at")
    .eq("status", "ACTIVE")
    .order("is_default", { ascending: false })
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .limit(1);
  const row = rows?.[0];
  const cred = toCredential(row as Record<string, unknown> | undefined);
  if (cred && row) return { account_id: String(row.id), credential: cred, source: "default" };
  return { account_id: null, credential: null, source: "none" };
}
