import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireServerSession } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";
import { generateStreamCredentials, getDefaultRetentionDays, getDefaultWatermark } from "@/lib/streams";

/**
 * GET  /api/streams                — 모든 스트림 목록 (관리자만).
 * POST /api/streams                — 신규 스트림 등록 (PENDING 상태, ingest 거부됨).
 *
 * 신규 등록은 동의 다이얼로그 통과 전이라 ingestSecret만 발급하고 즉시 활성화하지 않는다.
 * 클라이언트 agent가 첫 실행 시 동의를 받은 뒤 별도 엔드포인트(POST /api/streams/{id}/consent)로 활성화.
 */

const createSchema = z.object({
  deviceId: z.string().min(1),
  displayName: z.string().max(120).optional(),
  watermarkText: z.string().max(120).optional(),
  retentionDays: z.number().int().min(1).max(365).optional()
});

export async function GET() {
  try {
    await requireServerSession();
    const streams = await prisma.stream.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        device: { select: { rustdeskId: true, alias: true, ownerEmail: true } },
        _count: { select: { sessions: true, recordings: true } }
      }
    });
    return NextResponse.json({ data: streams });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireServerSession();
    const body = createSchema.parse(await request.json());

    const device = await prisma.deviceMeta.findUnique({ where: { rustdeskId: body.deviceId } });
    if (!device) {
      return NextResponse.json({ error: "Unknown device. Register DeviceMeta first." }, { status: 404 });
    }

    const { streamKey, ingestSecret, ingestSecretHash } = generateStreamCredentials();

    const stream = await prisma.stream.create({
      data: {
        deviceId: body.deviceId,
        streamKey,
        ingestSecretHash,
        displayName: body.displayName,
        watermarkText: body.watermarkText || getDefaultWatermark(),
        retentionDays: body.retentionDays ?? getDefaultRetentionDays(),
        status: "PENDING"
      }
    });

    await writeAuditLog({
      adminEmail: session.user.email || "unknown",
      action: "stream_registered_pending_consent",
      targetType: "Stream",
      targetId: stream.id,
      metadata: { deviceId: body.deviceId, streamKey }
    });

    return NextResponse.json({
      data: {
        id: stream.id,
        deviceId: stream.deviceId,
        streamKey: stream.streamKey,
        ingestSecret,
        watermarkText: stream.watermarkText,
        status: stream.status,
        notice:
          "이 스트림은 PENDING 상태이며, 클라이언트 agent에서 사용자 동의를 받기 전까지 ingest는 거부됩니다."
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid payload", issues: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await requireServerSession();
    const deleted = await prisma.stream.deleteMany({});

    await writeAuditLog({
      adminEmail: session.user.email || "unknown",
      action: "streams_deleted_all",
      targetType: "Stream",
      metadata: { count: deleted.count }
    });

    return NextResponse.json({ data: { deletedCount: deleted.count } });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
