import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashIngestSecret, timingSafeEqualHex } from "@/lib/streams";

/**
 * POST /api/streams/{id}/pause
 *
 * 사용자(agent 트레이)가 일시정지 요청.
 * 안전선:
 * - ingestSecret으로 인증 (관리자 권한과 분리)
 * - 관리자 권한으로는 강제 재개 불가. 재개는 같은 ingestSecret으로 /resume.
 */

const bodySchema = z.object({
  ingestSecret: z.string().min(16),
  reason: z.string().max(200).optional(),
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
    if (stream.status === "REVOKED") {
      return NextResponse.json({ error: "Stream is revoked" }, { status: 409 });
    }
    const updated = await prisma.stream.update({
      where: { id: stream.id },
      data: { status: "PAUSED", pausedAt: new Date(), pausedReason: body.reason ?? null }
    });
    await prisma.auditLog.create({
      data: {
        adminEmail: `agent:${body.hostname ?? "unknown"}`,
        action: "stream_paused_by_user",
        targetType: "Stream",
        targetId: stream.id,
        metadata: { reason: body.reason ?? null }
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
