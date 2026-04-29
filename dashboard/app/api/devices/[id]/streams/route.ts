import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireServerSession } from "@/lib/session";

/**
 * GET /api/devices/{id}/streams — 한 디바이스에 등록된 스트림(들) 메타.
 */

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireServerSession();
    const streams = await prisma.stream.findMany({
      where: { deviceId: params.id },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { sessions: true, recordings: true } }
      }
    });
    return NextResponse.json({
      data: streams.map((s) => ({
        id: s.id,
        streamKey: s.streamKey,
        displayName: s.displayName,
        status: s.status,
        consentAcceptedAt: s.consentAcceptedAt,
        consentAcceptedBy: s.consentAcceptedBy,
        watermarkText: s.watermarkText,
        retentionDays: s.retentionDays,
        pausedAt: s.pausedAt,
        pausedReason: s.pausedReason,
        lastSeenAt: s.lastSeenAt,
        createdAt: s.createdAt,
        sessionCount: s._count.sessions,
        recordingCount: s._count.recordings
      }))
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
