import "server-only";

/**
 * Facebook Client (Phase 6) — đăng bài thật lên Facebook Page qua Graph API.
 *
 * BẢO MẬT:
 * - File này import "server-only" → KHÔNG bao giờ bị bundle vào client.
 * - FACEBOOK_PAGE_ACCESS_TOKEN chỉ đọc tại đây (server-side).
 * - KHÔNG log token, KHÔNG đưa token vào error message.
 */

/** Dữ liệu đầu vào để đăng một bài lên Facebook Page. */
export type FacebookPublishInput = {
  caption: string;
  affiliateLink?: string | null;
};

/** Kết quả trả về sau khi đăng bài. */
export type FacebookPublishResult = {
  postId: string;
  postUrl?: string | null;
  rawResponse: unknown;
};

const GRAPH_API_VERSION = "v24.0";

/**
 * Đăng một bài (text) lên Facebook Page.
 * Ném Error (tiếng Việt) nếu thiếu cấu hình hoặc Facebook từ chối.
 */
export async function publishToFacebookPage(
  input: FacebookPublishInput,
): Promise<FacebookPublishResult> {
  const pageId = process.env.FACEBOOK_PAGE_ID?.trim();
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim();

  if (!pageId || !accessToken) {
    throw new Error("Thiếu FACEBOOK_PAGE_ID hoặc FACEBOOK_PAGE_ACCESS_TOKEN.");
  }

  const caption = input.caption?.trim();
  if (!caption) {
    throw new Error("Caption rỗng, không thể đăng.");
  }

  // Ghép link affiliate vào cuối nếu caption chưa chứa link đó.
  let message = caption;
  const link = input.affiliateLink?.trim();
  if (link && !message.includes(link)) {
    message = `${message}\n\n${link}`;
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(pageId)}/feed`;

  let response: Response;
  try {
    const body = new URLSearchParams();
    body.set("message", message);
    body.set("access_token", accessToken);

    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "không rõ nguyên nhân";
    throw new Error(`Không gọi được Facebook Graph API: ${reason}`);
  }

  // Đọc body và parse JSON an toàn.
  const rawText = await response.text();
  let rawJson: unknown = rawText;
  try {
    rawJson = JSON.parse(rawText);
  } catch {
    // Giữ nguyên text nếu không phải JSON.
  }

  if (!response.ok) {
    let fbMessage = `HTTP ${response.status}`;
    if (
      rawJson &&
      typeof rawJson === "object" &&
      "error" in rawJson &&
      typeof (rawJson as { error?: { message?: unknown } }).error?.message === "string"
    ) {
      fbMessage = (rawJson as { error: { message: string } }).error.message;
    }
    // Không bao giờ đưa token vào error message.
    throw new Error(`Facebook từ chối đăng bài: ${fbMessage}`);
  }

  // Thành công: lấy id bài đăng.
  let postId: string | null = null;
  if (rawJson && typeof rawJson === "object" && "id" in rawJson) {
    const id = (rawJson as { id?: unknown }).id;
    if (typeof id === "string" && id.length > 0) {
      postId = id;
    }
  }

  if (!postId) {
    throw new Error("Facebook không trả về ID bài đăng.");
  }

  return {
    postId,
    postUrl: `https://www.facebook.com/${postId}`,
    rawResponse: rawJson,
  };
}
