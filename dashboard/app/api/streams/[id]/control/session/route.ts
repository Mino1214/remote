import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireServerSession } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";
import { createControlSession, getLatestControlSessionForStream } from "@/lib/control-signaling";
import { hashIngestSecret, timingSafeEqualHex } from "@/lib/streams";

function getBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth) return null;
  const [scheme, token] = auth.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token;
}

/**
 * POST /api/streams/{id}/control/session
 *
 * 기존 스트림 흐름(PENDING/ACTIVE/PAUSED/REVOKED) 중 ACTIVE에서만 제어 세션 생성.
 * 동의/권한(ingestSecret 기반 consent) 플로우는 건드리지 않는다.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireServerSession();
    const stream = await prisma.stream.findUnique({ where: { id: params.id } });
    if (!stream) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (stream.status !== "ACTIVE") {
      return NextResponse.json({ error: "Control channel is available only for ACTIVE streams" }, { status: 409 });
    }

    const control = createControlSession(stream.id, session.user.email || "unknown");
    await writeAuditLog({
      adminEmail: session.user.email || "unknown",
      action: "stream_control_session_created",
      targetType: "Stream",
      targetId: stream.id,
      metadata: {
        controlSessionId: control.id,
        expiresAt: new Date(control.expiresAt).toISOString()
      }
    });

    return NextResponse.json({
      data: {
        sessionId: control.id,
        expiresAt: Math.floor(control.expiresAt / 1000)
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const stream = await prisma.stream.findUnique({ where: { id: params.id } });
    if (!stream) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (stream.status !== "ACTIVE") {
      return NextResponse.json({ error: "Control channel is available only for ACTIVE streams" }, { status: 409 });
    }

    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    if (role === "agent") {
      const bearer = getBearerToken(request);
      if (!bearer || !timingSafeEqualHex(hashIngestSecret(bearer), stream.ingestSecretHash)) {
        return NextResponse.json({ error: "Invalid ingest secret" }, { status: 401 });
      }
    } else {
      await requireServerSession();
    }

    const latest = getLatestControlSessionForStream(stream.id);
    if (!latest) {
      return NextResponse.json({ data: null });
    }

    return NextResponse.json({
      data: {
        sessionId: latest.id,
        createdAt: Math.floor(latest.createdAt / 1000),
        expiresAt: Math.floor(latest.expiresAt / 1000)
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

