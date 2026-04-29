"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type StreamSummary = {
  id: string;
  streamKey: string;
  displayName: string | null;
  status: string;
  consentAcceptedAt: string | null;
  consentAcceptedBy: string | null;
  watermarkText: string | null;
  retentionDays: number;
  pausedAt: string | null;
  pausedReason: string | null;
  lastSeenAt: string | null;
  createdAt: string;
};

export function StreamRegisterCard({ deviceId }: { deviceId: string }) {
  const [streams, setStreams] = useState<StreamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState("");
  const [retentionDays, setRetentionDays] = useState<number>(7);
  const [createResult, setCreateResult] = useState<null | {
    streamKey: string;
    ingestSecret: string;
    status: string;
    notice: string;
  }>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/devices/${deviceId}/streams`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data: StreamSummary[] };
      setStreams(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [deviceId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreateResult(null);
    try {
      const res = await fetch("/api/streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, displayName, retentionDays })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setCreateResult(json.data);
      setDisplayName("");
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "create error");
    }
  }

  async function revoke(id: string) {
    if (!confirm("이 스트림을 영구 차단합니다. 계속할까요?")) return;
    const res = await fetch(`/api/streams/${id}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "revoked_via_dashboard" })
    });
    if (!res.ok) {
      setError(`revoke failed: ${res.status}`);
      return;
    }
    void load();
  }

  return (
    <div className="space-y-4 rounded border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">모니터링 스트림</h2>
        <div className="flex gap-2 text-xs">
          <Link className="underline" href={`/devices/${deviceId}/live`}>
            라이브
          </Link>
          <Link className="underline" href={`/devices/${deviceId}/recordings`}>
            녹화
          </Link>
        </div>
      </div>

      <p className="rounded bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        이 기능은 클라이언트 PC 화면을 상시 송출/녹화합니다. 사용자 동의 없는 활성화는 법적
        문제가 될 수 있으므로, agent 첫 실행 시 동의 다이얼로그를 통과해야만 ACTIVE 상태가 되며,
        클라이언트 화면에는 상시 ● REC 워터마크가 표시됩니다.
      </p>

      {streams.length === 0 ? (
        <p className="text-sm text-muted-foreground">{loading ? "로딩 중..." : "아직 등록된 스트림이 없습니다."}</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {streams.map((s) => (
            <li key={s.id} className="rounded border p-3">
              <div className="flex items-center justify-between">
                <div className="font-mono text-xs">{s.streamKey}</div>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-semibold ${
                    s.status === "ACTIVE"
                      ? "bg-green-100 text-green-900"
                      : s.status === "PAUSED"
                      ? "bg-amber-100 text-amber-900"
                      : s.status === "REVOKED"
                      ? "bg-red-100 text-red-900"
                      : "bg-gray-100 text-gray-900"
                  }`}
                >
                  {s.status}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {s.displayName ?? "(이름 없음)"} · 보존 {s.retentionDays}일 ·
                {" "}
                동의: {s.consentAcceptedBy ?? "(아직 없음)"}
                {s.consentAcceptedAt ? ` @ ${new Date(s.consentAcceptedAt).toLocaleString()}` : ""}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link className="text-xs underline" href={`/devices/${deviceId}/live?stream=${s.id}`}>
                  라이브 보기
                </Link>
                <Link className="text-xs underline" href={`/devices/${deviceId}/recordings?stream=${s.id}`}>
                  녹화
                </Link>
                {s.status !== "REVOKED" ? (
                  <button
                    type="button"
                    onClick={() => revoke(s.id)}
                    className="text-xs text-destructive underline"
                  >
                    차단 (revoke)
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="space-y-2 border-t pt-4" onSubmit={onSubmit}>
        <h3 className="text-sm font-semibold">신규 스트림 등록 (PENDING으로 시작)</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Input
            placeholder="표시 이름 (예: 사무실 데스크탑)"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Input
            type="number"
            min={1}
            max={365}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            placeholder="보존 일수"
          />
          <Button type="submit">등록</Button>
        </div>
      </form>

      {createResult ? (
        <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-3 text-xs dark:bg-amber-950/30">
          <div className="font-semibold">신규 스트림 자격증명 — 한 번만 표시됩니다, 즉시 안전한 곳에 보관하세요.</div>
          <div>
            streamKey: <code className="font-mono">{createResult.streamKey}</code>
          </div>
          <div>
            ingestSecret:{" "}
            <code className="font-mono">{createResult.ingestSecret}</code>
          </div>
          <div className="text-amber-700 dark:text-amber-200">{createResult.notice}</div>
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
