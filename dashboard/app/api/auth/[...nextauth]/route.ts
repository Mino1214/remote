import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

const handler = NextAuth(authOptions);

export { handler as GET };

export async function POST(request: Request, context: { params: { nextauth: string[] } }) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const ip = (forwardedFor?.split(",")[0] || realIp || "unknown").trim();
  const path = new URL(request.url).pathname;
  const isCredentialsCallback = path.includes("/callback/credentials");

  if (isCredentialsCallback) {
    const limit = Number(process.env.AUTH_RATE_LIMIT_MAX || "10");
    const windowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || String(60_000));
    const result = checkRateLimit(`auth:${ip}`, limit, windowMs);

    if (!result.allowed) {
      const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSec),
            "X-RateLimit-Limit": String(limit),
            "X-RateLimit-Remaining": "0"
          }
        }
      );
    }
  }

  return handler(request, context);
}
