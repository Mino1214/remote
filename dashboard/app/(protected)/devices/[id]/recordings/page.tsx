import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function DeviceRecordingsPage({
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
        <h1 className="text-2xl font-semibold">Recordings · {params.id}</h1>
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          등록된 스트림이 없습니다.
        </div>
      </div>
    );
  }

  const active = searchParams.stream
    ? streams.find((s) => s.id === searchParams.stream) ?? streams[0]
    : streams[0];

  const recordings = await prisma.streamRecording.findMany({
    where: { streamId: active!.id, deletedAt: null },
    orderBy: { startedAt: "desc" },
    take: 100
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Recordings · {params.id}</h1>
        <Link href={`/devices/${params.id}/live?stream=${active!.id}`} className="text-xs underline">
          라이브 보기 →
        </Link>
      </div>

      {streams.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {streams.map((s) => (
            <Link
              key={s.id}
              href={`/devices/${params.id}/recordings?stream=${s.id}`}
              className={`rounded border px-3 py-1 text-xs ${
                s.id === active!.id ? "bg-foreground text-background" : "hover:bg-muted"
              }`}
            >
              {s.displayName ?? s.streamKey}
            </Link>
          ))}
        </div>
      ) : null}

      {recordings.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          녹화 파일이 아직 없습니다. (스트림 보존기간: {active!.retentionDays}일)
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">시작</th>
                <th className="px-3 py-2 text-left">종료</th>
                <th className="px-3 py-2 text-left">길이</th>
                <th className="px-3 py-2 text-left">크기</th>
                <th className="px-3 py-2 text-left">파일</th>
              </tr>
            </thead>
            <tbody>
              {recordings.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{format(r.startedAt, "yyyy-MM-dd HH:mm:ss")}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.endedAt ? format(r.endedAt, "HH:mm:ss") : "(진행 중)"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.durationMs ? `${Math.round(r.durationMs / 1000)}s` : "-"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.sizeBytes ? `${(Number(r.sizeBytes) / 1024 / 1024).toFixed(1)} MB` : "-"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.filePath}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        녹화 파일은 서버의 <code>/recordings</code> 볼륨에 저장됩니다. 보존기간이 지나면 자동 삭제 또는 수동 삭제 정책을 적용하세요.
        모든 다운로드/조회는 audit log에 기록되어야 합니다 (다운로드 엔드포인트는 추후 별도 구현).
      </p>
    </div>
  );
}
