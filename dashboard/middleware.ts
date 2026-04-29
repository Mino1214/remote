import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

function isAllowedIp(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const isLocalHost = host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]");
  if (isLocalHost) {
    return true;
  }

  const allowlist = process.env.DASHBOARD_IP_ALLOWLIST;
  if (!allowlist) return true;

  const allowed = allowlist
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);

  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const clientIp = (forwardedFor?.split(",")[0] || realIp || "").trim();

  if (!clientIp) return false;
  return allowed.includes(clientIp);
}

/**
 * Streaming subsystem 공개 엔드포인트.
 * - /api/streams/auth          : MediaMTX 인증 콜백 (내부에서 source 호스트 검증).
 * - /api/streams/{id}/consent  : agent가 ingestSecret으로 동의 확정.
 * - /api/streams/{id}/pause    : agent가 ingestSecret으로 일시정지.
 * - /api/streams/{id}/resume   : agent가 ingestSecret으로 재개.
 * 이들은 NextAuth 세션을 요구하지 않는다(요구할 수 없다). 각 엔드포인트는 자체 인증을 한다.
 */
function isStreamingAgentEndpoint(pathname: string): boolean {
  if (pathname === "/api/streams/auth") return true;
  // /api/streams/{id}/(consent|pause|resume)
  const m = pathname.match(/^\/api\/streams\/[^/]+\/(consent|pause|resume)$/);
  return Boolean(m);
}

export async function middleware(request: NextRequest) {
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");
  const isAuthApi = request.nextUrl.pathname.startsWith("/api/auth/");
  const isLoginPage = request.nextUrl.pathname === "/login";
  const isStreamingAgent = isStreamingAgentEndpoint(request.nextUrl.pathname);

  if (isAuthApi || isStreamingAgent) {
    return NextResponse.next();
  }

  if (!isAllowedIp(request)) {
    return NextResponse.json({ error: "Forbidden by IP allowlist" }, { status: 403 });
  }

  if (isLoginPage) {
    return NextResponse.next();
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/login",
    "/dashboard/:path*",
    "/devices/:path*",
    "/streams/:path*",
    "/users/:path*",
    "/sessions/:path*",
    "/settings/:path*",
    "/api/:path*"
  ]
};
