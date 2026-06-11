"use client";

import { useState } from "react";

/**
 * Phase 17.7 — Capture ảnh sản phẩm Shopee từ trình duyệt thật của user.
 * Sinh bookmarklet riêng cho product (đã nhúng product_id + endpoint + secret).
 */
function buildInnerScript(endpoint: string, secret: string, productId: string): string {
  // KHÔNG dùng dấu backslash trong chuỗi này (tránh lỗi escape khi nhúng bookmarklet).
  return (
    "(function(){try{" +
    "var u=[];function p(x){if(x&&typeof x==='string')u.push(x);}" +
    "document.querySelectorAll('img').forEach(function(i){['src','data-src','data-original','data-lazy-src'].forEach(function(a){p(i.getAttribute(a));});var s=i.getAttribute('srcset');if(s)s.split(',').forEach(function(z){p(z.trim().split(' ')[0]);});});" +
    "document.querySelectorAll('picture source').forEach(function(e){var s=e.getAttribute('srcset');if(s)s.split(',').forEach(function(z){p(z.trim().split(' ')[0]);});});" +
    "document.querySelectorAll('[style]').forEach(function(e){var b=e.style&&e.style.backgroundImage;if(b&&b.indexOf('url(')===0){p(b.slice(4,-1).replace(/[\"']/g,''));}});" +
    "var imgs=[];var seen={};u.forEach(function(x){if(!x)return;x=x.indexOf('//')===0?'https:'+x:x;if(/susercontent.com|cf.shopee.vn/i.test(x)&&!/(logo|favicon|sprite|icon|avatar|placeholder)/i.test(x)&&!seen[x]){seen[x]=1;imgs.push(x);}});" +
    "if(!imgs.length){alert('Khong tim thay anh san pham Shopee. Hay cuon trang cho anh hien ra roi chay lai.');return;}" +
    "fetch('" + endpoint + "',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify({capture_secret:'" + secret + "',product_id:'" + productId + "',page_url:location.href,title:document.title,images:imgs,source:'bookmarklet'})}).then(function(r){return r.json();}).then(function(j){alert(j.ok?('Da gui '+j.saved+' anh ve app. Quay lai app va bam Lam moi.'):('Loi: '+(j.error||'?')));}).catch(function(e){alert('Loi gui: '+e);});" +
    "}catch(e){alert('Loi: '+e);}})();"
  );
}

export default function CaptureSourceButton({
  productId,
  productName,
  affiliateLink,
  captureSecret,
  appUrl,
  captured,
}: {
  productId: string;
  productName: string;
  affiliateLink: string | null;
  captureSecret: string | null;
  appUrl: string;
  captured: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const endpoint = `${appUrl.replace(/\/$/, "")}/api/products/capture-source-images`;
  const configured = !!captureSecret;
  const inner = configured ? buildInnerScript(endpoint, captureSecret as string, productId) : "";
  const bookmarklet = configured ? "javascript:" + encodeURIComponent(inner) : "";

  function copy(text: string, label: string) {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => {
          setCopied(label);
          setTimeout(() => setCopied(null), 2000);
        },
        () => setCopied(null),
      );
    }
  }

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
      >
        {captured ? "📸 Ảnh nguồn ✓" : "📸 Capture ảnh từ Shopee"}
      </button>

      {open ? (
        <div className="mt-2 w-[320px] max-w-[80vw] rounded-lg border border-gray-200 bg-white p-3 text-left text-xs shadow-lg">
          <p className="mb-1 font-medium text-gray-900">{productName}</p>
          {!configured ? (
            <p className="text-red-600">Chưa cấu hình <code>PRODUCT_CAPTURE_SECRET</code> trên server. Hãy thêm env rồi thử lại.</p>
          ) : (
            <>
              <ol className="list-decimal space-y-1 pl-4 text-gray-600">
                <li>Copy <strong>bookmarklet</strong> bên dưới, tạo 1 Bookmark mới và dán vào ô URL.</li>
                <li>
                  {affiliateLink ? (
                    <a href={affiliateLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                      Mở trang sản phẩm Shopee
                    </a>
                  ) : (
                    "Mở trang sản phẩm Shopee"
                  )}{" "}
                  trong trình duyệt, cuộn cho ảnh hiện ra.
                </li>
                <li>Bấm bookmark vừa tạo → ảnh được gửi về app.</li>
                <li>Quay lại đây, bấm <strong>Làm mới</strong> trang.</li>
              </ol>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => copy(bookmarklet, "bm")}
                  className="rounded border border-blue-300 bg-blue-50 px-2 py-1 font-medium text-blue-700 hover:bg-blue-100"
                >
                  {copied === "bm" ? "Đã copy ✓" : "Copy bookmarklet"}
                </button>
                <button
                  type="button"
                  onClick={() => copy(inner, "console")}
                  className="rounded border border-gray-300 px-2 py-1 font-medium text-gray-700 hover:bg-gray-50"
                >
                  {copied === "console" ? "Đã copy ✓" : "Copy script (Console)"}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-gray-400">
                Hoặc dán &quot;script (Console)&quot; vào DevTools Console của tab Shopee rồi Enter.
              </p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
