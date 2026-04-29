import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { issuePlaybackToken } from "@/lib/streams";
import { StreamLivePlayer } from "@/components/stream-live-player";

export const dynamic = "force-dynamic";

export default async function DeviceLivePage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { stream?: string };
}) {
  const streams = await prisma.stream.findMany({
    where: { deviceId: params.id },
    orderBy: { createdAt: "desc" }
  });

  if (streams.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Live · {params.id}</h1>
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          이 디바이스에는 등록된 모니터링 스트림이 없습니다. 디바이스 상세 페이지에서 먼저 스트림을 등록하고,
          클라이언트 agent에서 사용자 동의 다이얼로그를 통과시켜야 ACTIVE 상태가 됩니다.
        </div>
        <Link href={`/devices/${params.id}`} className="text-sm underline">
          ← 디바이스 상세로 돌아가기
        </Link>
      </div>
    );
  }

  const active = searchParams.stream
    ? streams.find((s) => s.id === searchParams.stream) ?? streams[0]
    : streams[0];

  if (!active) notFound();

  if (active.status !== "ACTIVE") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Live · {params.id}</h1>
        <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          현재 스트림 상태: <code className="font-mono">{active.status}</code>
          {active.status === "PENDING" && " — 클라이언트 agent에서 사용자 동의가 아직 수락되지 않았습니다."}
          {active.status === "PAUSED" &&
            ` — 사용자가 일시정지했습니다. 사유: ${active.pausedReason ?? "(미기재)"}`}
          {active.status === "REVOKED" && " — 영구 차단된 스트림입니다. 새 스트림으로 재등록 필요."}
        </div>
        <Link href={`/devices/${params.id}`} className="text-sm underline">
          ← 디바이스 상세로 돌아가기
        </Link>
      </div>
    );
  }

  // 서버사이드에서 첫 토큰 발급해 즉시 재생 가능하게 한다.
  // (이후 만료 시 클라이언트가 /playback-token API로 갱신)
  const { token, exp } = issuePlaybackToken(active.streamKey, "server-render");
  const hlsUrl = `/api/streams/play/${active.streamKey}/index.m3u8?token=${encodeURIComponent(token)}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Live · {active.displayName ?? params.id}</h1>
        <div className="flex items-center gap-2 text-xs">
          <Link href={`/devices/${params.id}`} className="underline">
            상세
          </Link>
          <span>·</span>
          <Link href={`/devices/${params.id}/recordings?stream=${active.id}`} className="underline">
            녹화 목록
          </Link>
        </div>
      </div>

      {streams.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {streams.map((s) => (
            <Link
              key={s.id}
              href={`/devices/${params.id}/live?stream=${s.id}`}
              className={`rounded border px-3 py-1 text-xs ${
                s.id === active.id ? "bg-foreground text-background" : "hover:bg-muted"
              }`}
            >
              {s.displayName ?? s.streamKey} · {s.status}
            </Link>
          ))}
        </div>
      ) : null}

      <StreamLivePlayer
        streamId={active.id}
        initialInfo={{
          hlsUrl,
          watermarkText: active.watermarkText,
          exp
        }}
      />

      <div className="rounded-lg border bg-card p-4 text-xs text-muted-foreground">
        <div>
          stream id: <code className="font-mono">{active.id}</code>
        </div>
        <div>
          consent: <code className="font-mono">{active.consentAcceptedBy ?? "?"}</code> @{" "}
          {active.consentAcceptedAt?.toISOString() ?? "?"}
        </div>
        <div>
          last seen: {active.lastSeenAt?.toISOString() ?? "(아직 ingest 없음)"}
        </div>
      </div>
    </div>
  );
}
