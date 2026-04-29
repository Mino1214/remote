import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireServerSession } from "@/lib/session";
import { writeAuditLog } from "@/lib/audit";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireServerSession();
    const existing = await prisma.stream.findUnique({ where: { id: params.id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.stream.delete({ where: { id: params.id } });

    await writeAuditLog({
      adminEmail: session.user.email || "unknown",
      action: "stream_deleted",
      targetType: "Stream",
      targetId: params.id,
      metadata: { streamKey: existing.streamKey, deviceId: existing.deviceId }
    });

    return NextResponse.json({ data: { id: params.id, deleted: true } });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

