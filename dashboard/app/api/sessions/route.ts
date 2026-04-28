import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireServerSession } from "@/lib/session";

export async function GET() {
  try {
    await requireServerSession();
    const sessions = await prisma.accessLog.findMany({
      orderBy: { startedAt: "desc" },
      take: 200
    });
    return NextResponse.json({ data: sessions });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }
}
