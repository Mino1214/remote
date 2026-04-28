import { NextResponse } from "next/server";
import { startOfDay } from "date-fns";
import { prisma } from "@/lib/prisma";
import { requireServerSession } from "@/lib/session";
import { rustdeskApi } from "@/lib/rustdesk-api";

export async function GET() {
  try {
    await requireServerSession();
    const today = startOfDay(new Date());
    const [devices, todaySessions, recentSessions] = await Promise.all([
      rustdeskApi.listDevices(),
      prisma.accessLog.count({ where: { startedAt: { gte: today } } }),
      prisma.accessLog.count({
        where: {
          startedAt: {
            gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7)
          }
        }
      })
    ]);

    return NextResponse.json({
      data: {
        activeDevices: devices.filter((d) => d.online).length,
        todaySessions,
        recentSessions
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to fetch summary" }, { status: 500 });
  }
}
