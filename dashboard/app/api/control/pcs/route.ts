import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { noStoreResponseHeaders } from "@/lib/no-store-headers";
import { rustdeskApi, type RustdeskDevice } from "@/lib/rustdesk-api";
import { requireServerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// 스트림 기반 온라인 판정 윈도우. 이 시간 안에 lastSeenAt이 갱신되지 않으면 오프라인 처리.
const ONLINE_WINDOW_MS = 20_000;
const REMOTE_ONLINE_WINDOW_MS = 60_000;

function validDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function GET() {
  try {
    await requireServerSession();

    let remoteDevices: RustdeskDevice[] = [];
    try {
      remoteDevices = await rustdeskApi.listDevices();
    } catch (error) {
      console.error("[api/control/pcs] rustdeskApi.listDevices threw", error);
      remoteDevices = [];
    }

    const [metas, streams] = await Promise.all([
      prisma.deviceMeta.findMany(),
      prisma.stream.findMany({
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        include: {
          _count: { select: { sessions: true, recordings: true } }
        }
      })
    ]);

    const metaMap = new Map(metas.map((meta) => [meta.rustdeskId, meta]));
    const remoteMap = new Map(remoteDevices.map((device) => [device.id, device]));
    const byDevice = new Map<string, typeof streams>();

    for (const stream of streams) {
      const list = byDevice.get(stream.deviceId) ?? [];
      list.push(stream);
      byDevice.set(stream.deviceId, list);
    }

    const ids = new Set<string>();
    for (const device of remoteDevices) ids.add(device.id);
    for (const meta of metas) ids.add(meta.rustdeskId);
    for (const stream of streams) ids.add(stream.deviceId);

    const rows = [...ids].map((id) => {
      const remote = remoteMap.get(id);
      const meta = metaMap.get(id) ?? null;
      const deviceStreams = byDevice.get(id) ?? [];
      const activeStream = deviceStreams.find((stream) => stream.status === "ACTIVE") ?? null;
      const latestStream = activeStream ?? deviceStreams[0] ?? null;
      const latestStreamSeen = validDate(latestStream?.lastSeenAt);
      const latestRemoteSeen = validDate(remote?.lastSeenAt);
      const latestSeen = latestStreamSeen ?? latestRemoteSeen;
      const streamingOnline = latestStreamSeen
        ? Date.now() - latestStreamSeen.getTime() < ONLINE_WINDOW_MS
        : false;
      const remoteSeenOnline = latestRemoteSeen
        ? Date.now() - latestRemoteSeen.getTime() < REMOTE_ONLINE_WINDOW_MS
        : false;
      const hasActiveStream = deviceStreams.some((stream) => stream.status === "ACTIVE");
      // ACTIVE 스트림이라도 heartbeat 지연이 있을 수 있어, remote lastSeen도 함께 반영한다.
      // (stale 오탐으로 OFFLINE 고정되는 현상 완화)
      const online = hasActiveStream ? true : remoteSeenOnline || streamingOnline;

      return {
        id,
        hostname: remote?.hostname ?? null,
        ownerEmail: meta?.ownerEmail ?? remote?.ownerEmail ?? null,
        alias: meta?.alias ?? null,
        blocked: Boolean(meta?.blocked),
        online,
        lastSeenAt: latestSeen ? latestSeen.toISOString() : null,
        streamCount: deviceStreams.length,
        activeStreamCount: deviceStreams.filter((stream) => stream.status === "ACTIVE").length,
        stream: latestStream
          ? {
              id: latestStream.id,
              streamKey: latestStream.streamKey,
              displayName: latestStream.displayName,
              status: latestStream.status,
              health:
                latestStream.status === "ACTIVE"
                  ? streamingOnline
                    ? "LIVE"
                    : "STALE"
                  : null,
              lastSeenAt: latestStream.lastSeenAt ? latestStream.lastSeenAt.toISOString() : null,
              sessions: latestStream._count.sessions,
              recordings: latestStream._count.recordings
            }
          : null
      };
    });

    rows.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return (a.alias || a.hostname || a.id).localeCompare(b.alias || b.hostname || b.id);
    });

    return NextResponse.json({ data: rows }, { headers: noStoreResponseHeaders });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: noStoreResponseHeaders }
      );
    }
    return NextResponse.json(
      { error: "Failed to fetch control PCs" },
      { status: 500, headers: noStoreResponseHeaders }
    );
  }
}
