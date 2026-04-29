import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireServerSession } from "@/lib/session";

/**
 * GET /api/streams/{id}/recordings — 녹화 파일 목록 (페이징 단순).
 */

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    await requireServerSession();
    const url = new URL(request.url);
    const take = Math.min(Number(url.searchParams.get("take") || "50"), 200);
    const skip = Number(url.searchParams.get("skip") || "0");

    const [items, total] = await Promise.all([
      prisma.streamRecording.findMany({
        where: { streamId: params.id, deletedAt: null },
        orderBy: { startedAt: "desc" },
        take,
        skip
      }),
      prisma.streamRecording.count({ where: { streamId: params.id, deletedAt: null } })
    ]);

    return NextResponse.json({
      data: items.map((r) => ({
        id: r.id,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        durationMs: r.durationMs,
        sizeBytes: r.sizeBytes ? r.sizeBytes.toString() : null,
        filePath: r.filePath
      })),
      meta: { total, take, skip }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
