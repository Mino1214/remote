import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireServerSession } from "@/lib/session";
import { rustdeskApi } from "@/lib/rustdesk-api";

export async function GET() {
  try {
    await requireServerSession();
    const [remoteDevices, metas] = await Promise.all([rustdeskApi.listDevices(), prisma.deviceMeta.findMany()]);
    const metaMap = new Map(metas.map((meta) => [meta.rustdeskId, meta]));

    const merged = remoteDevices.map((device) => ({
      ...device,
      meta: metaMap.get(device.id) ?? null
    }));
    return NextResponse.json({ data: merged });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to fetch devices" }, { status: 500 });
  }
}
