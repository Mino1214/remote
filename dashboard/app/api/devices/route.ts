import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireServerSession } from "@/lib/session";
import { rustdeskApi } from "@/lib/rustdesk-api";

export async function GET() {
  try {
    await requireServerSession();
    // RustDesk hbbs에 등록된 device + DB의 deviceMeta + ingest 중인 stream의 deviceId
    // 셋의 합집합을 반환한다. RustDesk 없이 streaming-only로 provision된 디바이스도
    // /api/agent/provision이 deviceMeta를 만들고 stream을 ingest하기 시작하면 즉시 목록에 뜬다.
    const [remoteDevices, metas, streamDevices] = await Promise.all([
      rustdeskApi.listDevices(),
      prisma.deviceMeta.findMany(),
      prisma.stream.findMany({
        select: { deviceId: true, lastSeenAt: true },
        distinct: ["deviceId"]
      })
    ]);

    const metaMap = new Map(metas.map((meta) => [meta.rustdeskId, meta]));
    const seen = new Set<string>();
    type DeviceRow = {
      id: string;
      hostname?: string;
      lastSeenAt?: string;
      online?: boolean;
      ownerEmail?: string;
      meta: (typeof metas)[number] | null;
    };
    const merged: DeviceRow[] = [];

    for (const device of remoteDevices) {
      seen.add(device.id);
      merged.push({ ...device, meta: metaMap.get(device.id) ?? null });
    }

    // streaming-agent로만 prov된 디바이스를 누락 없이 보여주기 위해 합집합
    for (const meta of metas) {
      if (seen.has(meta.rustdeskId)) continue;
      seen.add(meta.rustdeskId);
      const lastSeen = streamDevices.find((s) => s.deviceId === meta.rustdeskId)?.lastSeenAt;
      merged.push({
        id: meta.rustdeskId,
        hostname: meta.alias ?? undefined,
        ownerEmail: meta.ownerEmail ?? undefined,
        // 최근 ingest가 90초 이내면 online으로 간주 (HLS PUT 주기 기준)
        online: lastSeen ? Date.now() - lastSeen.getTime() < 90_000 : false,
        lastSeenAt: lastSeen ? lastSeen.toISOString() : undefined,
        meta
      });
    }

    // stream만 있고 deviceMeta가 없는 케이스(드뭄)도 노출
    for (const s of streamDevices) {
      if (seen.has(s.deviceId)) continue;
      seen.add(s.deviceId);
      merged.push({
        id: s.deviceId,
        online: s.lastSeenAt ? Date.now() - s.lastSeenAt.getTime() < 90_000 : false,
        lastSeenAt: s.lastSeenAt ? s.lastSeenAt.toISOString() : undefined,
        meta: null
      });
    }

    return NextResponse.json({ data: merged });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to fetch devices" }, { status: 500 });
  }
}
