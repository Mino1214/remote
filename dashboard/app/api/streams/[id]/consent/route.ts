import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashIngestSecret, timingSafeEqualHex } from "@/lib/streams";

/**
 * POST /api/streams/{id}/consent
 *
 * 클라이언트 agent가 사용자 동의 다이얼로그를 통과한 직후 호출.
 * 인증은 ingestSecret으로만 한다(관리자 세션 불필요). 단, 동의 본문(checkbox 결과,
 * 표시되는 안내문구 해시 등)을 그대로 audit log에 박아 추후 분쟁 시 증빙으로 쓸 수 있게 한다.
 *
 * 안전선:
 * - 이 엔드포인트가 호출되어야만 status가 ACTIVE로 전환되고 ingest가 허용된다.
 * - REVOKED 스트림은 다시 ACTIVE로 못 돌아간다 (재등록 필요).
 */

const consentSchema = z.object({
  ingestSecret: z.string().min(16),
  acceptedBy: z.string().min(1).max(200),
  acceptedNoticeHash: z.string().min(16).max(200),
  agentVersion: z.string().max(50).optional(),
  hostname: z.string().max(120).optional()
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = consentSchema.parse(await request.json());

    const stream = await prisma.stream.findUnique({ where: { id: params.id } });
    if (!stream) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (stream.status === "REVOKED") {
      return NextResponse.json(
        { error: "This stream has been revoked. Re-register it before reactivating." },
        { status: 409 }
      );
    }

    if (!timingSafeEqualHex(hashIngestSecret(body.ingestSecret), stream.ingestSecretHash)) {
      return NextResponse.json({ error: "Invalid ingest secret" }, { status: 401 });
    }

    const updated = await prisma.stream.update({
      where: { id: params.id },
      data: {
        status: "ACTIVE",
        consentAcceptedAt: new Date(),
        consentAcceptedBy: body.acceptedBy,
        pausedAt: null,
        pausedReason: null
      }
    });

    await prisma.auditLog.create({
      data: {
        adminEmail: `agent:${body.hostname ?? "unknown"}`,
        action: "stream_consent_accepted",
        targetType: "Stream",
        targetId: updated.id,
        metadata: {
          acceptedBy: body.acceptedBy,
          acceptedNoticeHash: body.acceptedNoticeHash,
          agentVersion: body.agentVersion ?? null,
          hostname: body.hostname ?? null
        }
      }
    });

    return NextResponse.json({
      data: {
        id: updated.id,
        status: updated.status,
        consentAcceptedAt: updated.consentAcceptedAt,
        watermarkText: updated.watermarkText
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
