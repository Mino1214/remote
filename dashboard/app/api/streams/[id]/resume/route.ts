import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashIngestSecret, timingSafeEqualHex } from "@/lib/streams";

const bodySchema = z.object({
  ingestSecret: z.string().min(16),
  hostname: z.string().max(120).optional()
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = bodySchema.parse(await request.json());
    const stream = await prisma.stream.findUnique({ where: { id: params.id } });
    if (!stream) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!timingSafeEqualHex(hashIngestSecret(body.ingestSecret), stream.ingestSecretHash)) {
      return NextResponse.json({ error: "Invalid ingest secret" }, { status: 401 });
    }
    if (stream.status !== "PAUSED") {
      return NextResponse.json({ error: "Stream is not paused" }, { status: 409 });
    }
    if (!stream.consentAcceptedAt) {
      return NextResponse.json({ error: "Consent missing; re-register" }, { status: 409 });
    }
    const updated = await prisma.stream.update({
      where: { id: stream.id },
      data: { status: "ACTIVE", pausedAt: null, pausedReason: null }
    });
    await prisma.auditLog.create({
      data: {
        adminEmail: `agent:${body.hostname ?? "unknown"}`,
        action: "stream_resumed_by_user",
        targetType: "Stream",
        targetId: stream.id
      }
    });
    return NextResponse.json({ data: { id: updated.id, status: updated.status } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
