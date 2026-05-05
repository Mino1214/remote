import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rustdeskApi } from "@/lib/rustdesk-api";
import { requireServerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const ONLINE_WINDOW_MS = 90_000;

function validDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function GET() {
  try {
    await requireServerSession();

    const [remoteDevices, metas, streams] = await Promise.all([
      rustdeskApi.listDevices(),
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
      const latestSeen = validDate(latestStream?.lastSeenAt) ?? validDate(remote?.lastSeenAt);
      const streamingOnline = latestSeen ? Date.now() - latestSeen.getTime() < ONLINE_WINDOW_MS : false;
      const online = Boolean(remote?.online) || streamingOnline;

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

    return NextResponse.json({ data: rows });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to fetch control PCs" }, { status: 500 });
  }
}
