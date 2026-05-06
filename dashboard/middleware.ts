import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { applyNoStoreHeaders } from "@/lib/no-store-headers";

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
  // Cloudflare Tunnel/프록시 뒤에서는 XFF 없이 cf-connecting-ip 만 오는 경우가 있다.
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  const clientIp = (
    forwardedFor?.split(",")[0]?.trim() ||
    realIp?.trim() ||
    cfConnectingIp?.trim() ||
    ""
  );

  if (!clientIp) return false;
  return allowed.includes(clientIp);
}

/**
 * Streaming subsystem 공개 엔드포인트 (NextAuth 세션 불필요).
 * - /api/streams/{id}/consent             : agent가 ingestSecret으로 동의 확정.
 * - /api/streams/{id}/pause                : agent가 ingestSecret으로 일시정지.
 * - /api/streams/{id}/resume               : agent가 ingestSecret으로 재개.
 * - /api/streams/ingest/{streamKey}/{file} : agent가 Bearer ingestSecret으로 HLS chunk PUT.
 * - /api/streams/play/{streamKey}/{file}   : 시청자가 단명 HMAC 토큰으로 HLS GET.
 * 스트리밍 에이전트 경로는 라우트 핸들러가 Cache-Control을 직접 정한다. 미들웨어에서 무캐시 헤더를 덮어쓰지 않는다.
 */
function attachNoStoreUnlessStreaming(request: NextRequest, response: NextResponse) {
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/") && isStreamingAgentEndpoint(pathname)) {
    return response;
  }
  return applyNoStoreHeaders(response);
}

function isStreamingAgentEndpoint(pathname: string): boolean {
  if (pathname === "/api/agent/provision") return true;
  if (/^\/api\/streams\/[^/]+\/(consent|pause|resume)$/.test(pathname)) return true;
  if (/^\/api\/streams\/[^/]+\/control\/session$/.test(pathname)) return true;
  if (/^\/api\/streams\/[^/]+\/control\/signal$/.test(pathname)) return true;
  if (/^\/api\/streams\/[^/]+\/control\/events$/.test(pathname)) return true;
  if (/^\/api\/streams\/ingest\/[^/]+\/[^/]+$/.test(pathname)) return true;
  if (/^\/api\/streams\/play\/[^/]+\/[^/]+$/.test(pathname)) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");
  const isAuthApi = request.nextUrl.pathname.startsWith("/api/auth/");
  const isLoginPage = request.nextUrl.pathname === "/login";
  if (isAuthApi || isStreamingAgentEndpoint(request.nextUrl.pathname)) {
    return attachNoStoreUnlessStreaming(request, NextResponse.next());
  }

  if (!isAllowedIp(request)) {
    return attachNoStoreUnlessStreaming(
      request,
      NextResponse.json({ error: "Forbidden by IP allowlist" }, { status: 403 })
    );
  }

  if (isLoginPage) {
    return attachNoStoreUnlessStreaming(request, NextResponse.next());
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    if (isApiRoute) {
      return attachNoStoreUnlessStreaming(
        request,
        NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      );
    }
    const loginUrl = new URL("/login", request.url);
    return attachNoStoreUnlessStreaming(request, NextResponse.redirect(loginUrl));
  }

  return attachNoStoreUnlessStreaming(request, NextResponse.next());
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
