import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireServerSession } from "@/lib/session";
import { hashIngestSecret, timingSafeEqualHex } from "@/lib/streams";
import { getControlEventsSince, getControlSession, pushControlEvent, touchAgent, touchViewer } from "@/lib/control-signaling";

const postSchema = z.object({
  sessionId: z.string().min(8),
  payload: z.string().min(2).max(5000)
});

function getBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth) return null;
  const [scheme, token] = auth.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;
  return token;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireServerSession();
    const body = postSchema.parse(await request.json());
    const stream = await prisma.stream.findUnique({ where: { id: params.id } });
    if (!stream) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (stream.status !== "ACTIVE") return NextResponse.json({ error: "Stream is not ACTIVE" }, { status: 409 });
    const control = getControlSession(body.sessionId);
    if (!control || control.streamId !== stream.id) {
      return NextResponse.json({ error: "Control session not found or expired" }, { status: 404 });
    }
    pushControlEvent(control, body.payload);
    touchViewer(control);
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload", issues: error.issues }, { status: 400 });
    }
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");
    const afterSeq = Number(url.searchParams.get("afterSeq") || "0");
    if (!sessionId) return NextResponse.json({ error: "Invalid query" }, { status: 400 });

    const stream = await prisma.stream.findUnique({ where: { id: params.id } });
    if (!stream) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (stream.status !== "ACTIVE") return NextResponse.json({ error: "Stream is not ACTIVE" }, { status: 409 });

    const bearer = getBearerToken(request);
    if (!bearer || !timingSafeEqualHex(hashIngestSecret(bearer), stream.ingestSecretHash)) {
      return NextResponse.json({ error: "Invalid ingest secret" }, { status: 401 });
    }

    const control = getControlSession(sessionId);
    if (!control || control.streamId !== stream.id) {
      return NextResponse.json({ error: "Control session not found or expired" }, { status: 404 });
    }

    const events = getControlEventsSince(control, Number.isFinite(afterSeq) ? afterSeq : 0);
    touchAgent(control);
    return NextResponse.json({
      data: {
        events,
        lastSeq: control.nextSeq - 1
      }
    });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

