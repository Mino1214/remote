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

export async function middleware(request: NextRequest) {
  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");
  const isAuthApi = request.nextUrl.pathname.startsWith("/api/auth/");
  const isLoginPage = request.nextUrl.pathname === "/login";

  if (isAuthApi) {
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
    "/users/:path*",
    "/sessions/:path*",
    "/settings/:path*",
    "/api/:path*"
  ]
};
