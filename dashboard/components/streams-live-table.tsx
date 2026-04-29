"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

type StreamItem = {
  id: string;
  deviceId: string;
  streamKey: string;
  displayName: string | null;
  status: "ACTIVE" | "PAUSED" | "PENDING" | "REVOKED";
  consentAcceptedAt: string | null;
  consentAcceptedBy: string | null;
  lastSeenAt: string | null;
  device: { rustdeskId: string; alias: string | null };
  _count: { sessions: number; recordings: number };
};

const POLL_MS = 5000;

export function StreamsLiveTable() {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/streams", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data: StreamItem[] };
      setItems(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load streams");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function deleteOne(id: string) {
    if (!confirm("이 스트림을 삭제할까요? 관련 세션/녹화 메타도 함께 삭제됩니다.")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/streams/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "삭제 실패");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteAll() {
    if (!confirm("정말 모든 스트림을 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return;
    setBusyId("__all__");
    try {
      const res = await fetch("/api/streams", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "전체 삭제 실패");
    } finally {
      setBusyId(null);
    }
  }

  const groups = useMemo(
    () => ({
      ACTIVE: items.filter((s) => s.status === "ACTIVE"),
      PAUSED: items.filter((s) => s.status === "PAUSED"),
      PENDING: items.filter((s) => s.status === "PENDING"),
      REVOKED: items.filter((s) => s.status === "REVOKED")
    }),
    [items]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          5초마다 자동 갱신됩니다. 새 디바이스/스트림이 등록되면 이 화면에 자동 반영됩니다.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={busyId !== null}>
            새로고침
          </Button>
          <Button size="sm" variant="destructive" onClick={deleteAll} disabled={busyId !== null || items.length === 0}>
            전체 삭제
          </Button>
        </div>
      </div>

      {error ? <p className="rounded border border-destructive/30 p-2 text-xs text-destructive">{error}</p> : null}
      {isLoading && items.length === 0 ? <p className="text-sm text-muted-foreground">로딩 중...</p> : null}

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
                    <th className="px-3 py-2 text-left">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs">{s.device.rustdeskId}</div>
                        <div className="text-xs text-muted-foreground">{s.device.alias ?? "-"}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{s.displayName ?? s.streamKey}</td>
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
                        <Link className="underline" href={`/devices/${s.deviceId}/live?stream=${s.id}`}>
                          live
                        </Link>{" "}
                        ·{" "}
                        <Link className="underline" href={`/devices/${s.deviceId}/recordings?stream=${s.id}`}>
                          recs
                        </Link>{" "}
                        ·{" "}
                        <Link className="underline" href={`/devices/${s.deviceId}`}>
                          device
                        </Link>{" "}
                        ·{" "}
                        <button
                          type="button"
                          className="text-destructive underline"
                          onClick={() => void deleteOne(s.id)}
                          disabled={busyId !== null}
                        >
                          {busyId === s.id ? "삭제 중..." : "삭제"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {items.length === 0 ? (
        <div className="rounded border border-dashed p-6 text-sm text-muted-foreground">
          등록된 스트림이 없습니다.
        </div>
      ) : null}
    </div>
  );
}

