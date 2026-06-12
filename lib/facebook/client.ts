import "server-only";

/**
 * Facebook Client (Phase 6) — đăng bài thật lên Facebook Page qua Graph API.
 *
 * BẢO MẬT:
 * - File này import "server-only" → KHÔNG bao giờ bị bundle vào client.
 * - FACEBOOK_PAGE_ACCESS_TOKEN chỉ đọc tại đây (server-side).
 * - KHÔNG log token, KHÔNG đưa token vào error message.
 */

/** Thông tin Page để đăng (Phase 21 — cho phép chọn Page, fallback env). */
export type FacebookPageCredential = {
  pageId: string;
  accessToken: string;
};

/** Dữ liệu đầu vào để đăng một bài lên Facebook Page. */
export type FacebookPublishInput = {
  caption: string;
  affiliateLink?: string | null;
  /** Phase 21 — Page cụ thể. Nếu thiếu sẽ fallback env FACEBOOK_PAGE_ID/TOKEN. */
  page?: FacebookPageCredential | null;
};

/** Lấy credential Page: ưu tiên tham số, fallback env. KHÔNG log token. */
function resolvePageCreds(page?: FacebookPageCredential | null): { pageId: string | undefined; accessToken: string | undefined } {
  const pageId = page?.pageId?.trim() || process.env.FACEBOOK_PAGE_ID?.trim();
  const accessToken = page?.accessToken?.trim() || process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim();
  return { pageId, accessToken };
}

/** Dữ liệu đầu vào để đăng một bài ẢNH (Phase 17). */
export type FacebookPhotoPublishInput = FacebookPublishInput & {
  imageUrl: string;
};

/** Dữ liệu đầu vào để đăng bài NHIỀU ẢNH (Phase 17 V2). */
export type FacebookAlbumPublishInput = FacebookPublishInput & {
  imageUrls: string[];
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
  const { pageId, accessToken } = resolvePageCreds(input.page);

  if (!pageId || !accessToken) {
    throw new Error("Thiếu cấu hình Facebook Page (chưa chọn Page và chưa có env fallback).");
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

/** Đọc body JSON an toàn + ném lỗi tiếng Việt nếu Facebook từ chối. */
async function readFbJson(response: Response, action: string): Promise<Record<string, unknown>> {
  const rawText = await response.text();
  let rawJson: unknown = rawText;
  try {
    rawJson = JSON.parse(rawText);
  } catch {
    /* giữ text */
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
    throw new Error(`Facebook từ chối ${action}: ${fbMessage}`);
  }
  return rawJson && typeof rawJson === "object" ? (rawJson as Record<string, unknown>) : {};
}

/**
 * Đăng MỘT bài với NHIỀU ảnh (Phase 17 V2 — PHOTO_ALBUM).
 * Bước 1: upload từng ảnh ở chế độ unpublished (published=false) -> lấy media_fbid.
 * Bước 2: tạo 1 bài /feed với attached_media[] + message. KHÔNG đăng nhiều bài rời.
 */
export async function publishPhotoAlbumToFacebookPage(
  input: FacebookAlbumPublishInput,
): Promise<FacebookPublishResult> {
  const { pageId, accessToken } = resolvePageCreds(input.page);
  if (!pageId || !accessToken) {
    throw new Error("Thiếu cấu hình Facebook Page (chưa chọn Page và chưa có env fallback).");
  }
  const caption = input.caption?.trim();
  if (!caption) throw new Error("Caption rỗng, không thể đăng.");

  const urls = (input.imageUrls ?? []).map((u) => (u ?? "").trim()).filter((u) => /^https?:\/\//i.test(u));
  if (urls.length < 2) {
    throw new Error("Cần ít nhất 2 ảnh hợp lệ để đăng album.");
  }

  let message = caption;
  const link = input.affiliateLink?.trim();
  if (link && !message.includes(link)) message = `${message}\n\n${link}`;

  const base = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(pageId)}`;

  // Bước 1: upload ảnh unpublished.
  const mediaFbids: string[] = [];
  for (const url of urls) {
    let res: Response;
    try {
      const body = new URLSearchParams();
      body.set("url", url);
      body.set("published", "false");
      body.set("access_token", accessToken);
      res = await fetch(`${base}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        cache: "no-store",
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "không rõ nguyên nhân";
      throw new Error(`Không upload được ảnh: ${reason}`);
    }
    const json = await readFbJson(res, "upload ảnh");
    const id = typeof json.id === "string" ? json.id : null;
    if (!id) throw new Error("Facebook không trả về id ảnh khi upload.");
    mediaFbids.push(id);
  }

  // Bước 2: tạo 1 bài feed đính kèm nhiều ảnh.
  let feedRes: Response;
  try {
    const body = new URLSearchParams();
    body.set("message", message);
    body.set("access_token", accessToken);
    mediaFbids.forEach((id, i) => {
      body.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: id }));
    });
    feedRes = await fetch(`${base}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "không rõ nguyên nhân";
    throw new Error(`Không tạo được bài album: ${reason}`);
  }
  const feedJson = await readFbJson(feedRes, "đăng album");
  const postId = typeof feedJson.id === "string" ? feedJson.id : null;
  if (!postId) throw new Error("Facebook không trả về ID bài album.");

  return {
    postId,
    postUrl: `https://www.facebook.com/${postId}`,
    rawResponse: { post_id: postId, photo_count: mediaFbids.length },
  };
}

/**
 * Đăng một bài ẢNH lên Facebook Page bằng URL ảnh từ xa (Phase 17).
 * Dùng edge /{page-id}/photos với tham số `url` + `caption`.
 * KHÔNG upload binary. Ném Error (tiếng Việt) nếu thiếu cấu hình / Facebook từ chối.
 */
export async function publishPhotoToFacebookPage(
  input: FacebookPhotoPublishInput,
): Promise<FacebookPublishResult> {
  const { pageId, accessToken } = resolvePageCreds(input.page);

  if (!pageId || !accessToken) {
    throw new Error("Thiếu cấu hình Facebook Page (chưa chọn Page và chưa có env fallback).");
  }
  const caption = input.caption?.trim();
  if (!caption) {
    throw new Error("Caption rỗng, không thể đăng.");
  }
  const imageUrl = input.imageUrl?.trim();
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    throw new Error("Thiếu URL ảnh hợp lệ để đăng bài ảnh.");
  }

  let message = caption;
  const link = input.affiliateLink?.trim();
  if (link && !message.includes(link)) {
    message = `${message}\n\n${link}`;
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(pageId)}/photos`;

  let response: Response;
  try {
    const body = new URLSearchParams();
    body.set("url", imageUrl);
    body.set("caption", message);
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

  const rawText = await response.text();
  let rawJson: unknown = rawText;
  try {
    rawJson = JSON.parse(rawText);
  } catch {
    /* giữ nguyên text */
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
    throw new Error(`Facebook từ chối đăng ảnh: ${fbMessage}`);
  }

  // /photos trả về { id, post_id }. Ưu tiên post_id (id của bài trên feed).
  const obj = rawJson && typeof rawJson === "object" ? (rawJson as Record<string, unknown>) : {};
  const postId =
    (typeof obj.post_id === "string" && obj.post_id) ||
    (typeof obj.id === "string" && obj.id) ||
    null;
  if (!postId) {
    throw new Error("Facebook không trả về ID bài ảnh.");
  }

  return {
    postId,
    postUrl: `https://www.facebook.com/${postId}`,
    rawResponse: rawJson,
  };
}
