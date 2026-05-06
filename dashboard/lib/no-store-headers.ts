/** 브라우저·CDN(Cloudflare 등)이 JSON/HTML을 캐시하지 않도록 하는 공통 헤더. */
export const noStoreResponseHeaders: Record<string, string> = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  Vary: "Cookie"
};
