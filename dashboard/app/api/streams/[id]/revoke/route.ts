import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireServerSession } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";

/**
 * POST /api/streams/{id}/revoke
 *
 * 관리자가 스트림을 영구 차단. 이후 ingest/playback 모두 거부.
 * 재활성화는 새 streamKey로 신규 등록해야 함 (이전 동의 기록과 분리하기 위함).
 */

const bodySchema = z.object({
  reason: z.string().max(500).optional()
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireServerSession();
    const body = bodySchema.parse(await request.json().catch(() => ({})));

    const updated = await prisma.stream.update({
      where: { id: params.id },
      data: { status: "REVOKED", pausedAt: null, pausedReason: body.reason ?? "revoked_by_admin" }
    });

    await writeAuditLog({
      adminEmail: session.user.email || "unknown",
      action: "stream_revoked",
      targetType: "Stream",
      targetId: updated.id,
      metadata: { reason: body.reason ?? null }
    });

    return NextResponse.json({ data: { id: updated.id, status: updated.status } });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
