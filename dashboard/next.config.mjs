/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none';"
  }
];

/** 대시보드·API는 항상 최신 데이터; 중간 캐시(특히 CF)가 오래된 JSON/HTML을 주지 않도록 한다. */
const noStoreHeaders = [
  { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
  { key: "CDN-Cache-Control", value: "no-store" },
  { key: "Vary", value: "Cookie" }
];

const nextConfig = {
  async headers() {
    return [
      { source: "/api/:path*", headers: noStoreHeaders },
      { source: "/dashboard", headers: [...securityHeaders, ...noStoreHeaders] },
      { source: "/login", headers: [...securityHeaders, ...noStoreHeaders] },
      { source: "/devices", headers: [...securityHeaders, ...noStoreHeaders] },
      { source: "/devices/:path*", headers: [...securityHeaders, ...noStoreHeaders] },
      { source: "/streams", headers: [...securityHeaders, ...noStoreHeaders] },
      { source: "/streams/:path*", headers: [...securityHeaders, ...noStoreHeaders] },
      { source: "/sessions", headers: [...securityHeaders, ...noStoreHeaders] },
      { source: "/sessions/:path*", headers: [...securityHeaders, ...noStoreHeaders] },
      { source: "/users", headers: [...securityHeaders, ...noStoreHeaders] },
      { source: "/users/:path*", headers: [...securityHeaders, ...noStoreHeaders] },
      { source: "/settings", headers: [...securityHeaders, ...noStoreHeaders] },
      { source: "/settings/:path*", headers: [...securityHeaders, ...noStoreHeaders] },
      { source: "/:path*", headers: securityHeaders }
    ];
  }
};

export default nextConfig;
