import Link from "next/link";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function StreamsPage() {
  const streams = await prisma.stream.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      device: { select: { rustdeskId: true, alias: true } },
      _count: { select: { sessions: true, recordings: true } }
    }
  });

  const groups = {
    ACTIVE: streams.filter((s) => s.status === "ACTIVE"),
    PAUSED: streams.filter((s) => s.status === "PAUSED"),
    PENDING: streams.filter((s) => s.status === "PENDING"),
    REVOKED: streams.filter((s) => s.status === "REVOKED")
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Monitoring Streams</h1>
      <p className="text-xs text-muted-foreground">
        모든 활성 스트림은 클라이언트 동의 + 항상 표시되는 ● REC 워터마크 + 사용자 일시정지 가능
        조건을 만족합니다. 동의 없는 스트림(PENDING)은 ingest가 자동 차단됩니다.
      </p>

      {(Object.keys(groups) as Array<keyof typeof groups>).map((k) => {
        const list = groups[k];
        if (list.length === 0) return null;
        return (
          <section key={k} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {k} ({list.length})
            </h2>
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left">Device</th>
                    <th className="px-3 py-2 text-left">Stream</th>
                    <th className="px-3 py-2 text-left">동의</th>
                    <th className="px-3 py-2 text-left">최근 ingest</th>
                    <th className="px-3 py-2 text-left">세션</th>
                    <th className="px-3 py-2 text-left">녹화</th>
                    <th className="px-3 py-2 text-left">바로가기</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs">{s.device.rustdeskId}</div>
                        <div className="text-xs text-muted-foreground">{s.device.alias ?? "-"}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {s.displayName ?? s.streamKey}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {s.consentAcceptedBy ?? "-"}
                        <br />
                        <span className="text-muted-foreground">
                          {s.consentAcceptedAt ? new Date(s.consentAcceptedAt).toLocaleString() : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : "-"}
                      </td>
                      <td className="px-3 py-2 text-xs">{s._count.sessions}</td>
                      <td className="px-3 py-2 text-xs">{s._count.recordings}</td>
                      <td className="px-3 py-2 text-xs">
                        <Link
                          className="underline"
                          href={`/devices/${s.deviceId}/live?stream=${s.id}`}
                        >
                          live
                        </Link>{" "}
                        ·{" "}
                        <Link
                          className="underline"
                          href={`/devices/${s.deviceId}/recordings?stream=${s.id}`}
                        >
                          recs
                        </Link>{" "}
                        ·{" "}
                        <Link className="underline" href={`/devices/${s.deviceId}`}>
                          device
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {streams.length === 0 ? (
        <div className="rounded border border-dashed p-6 text-sm text-muted-foreground">
          아직 등록된 스트림이 없습니다. 디바이스 상세 페이지에서 등록하세요.
        </div>
      ) : null}
    </div>
  );
}
