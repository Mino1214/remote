"use client";

import { Check, Monitor, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StreamLivePlayer } from "@/components/stream-live-player";

type PcRow = {
  id: string;
  hostname: string | null;
  ownerEmail: string | null;
  alias: string | null;
  blocked: boolean;
  online: boolean;
  lastSeenAt: string | null;
  streamCount: number;
  activeStreamCount: number;
  stream: {
    id: string;
    streamKey: string;
    displayName: string | null;
    status: "ACTIVE" | "PAUSED" | "PENDING" | "REVOKED";
    lastSeenAt: string | null;
    sessions: number;
    recordings: number;
  } | null;
};

type ControlWindow = {
  key: string;
  deviceId: string;
  streamId: string;
  title: string;
};

const POLL_MS = 3000;

async function fetchPcs(): Promise<PcRow[]> {
  const res = await fetch("/api/control/pcs", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { data: PcRow[] };
  return json.data;
}

function displayName(row: PcRow) {
  return row.alias || row.hostname || row.stream?.displayName || row.id;
}

function formatSeen(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ControlDashboard() {
  const [pcs, setPcs] = useState<PcRow[]>([]);
  const [query, setQuery] = useState("");
  const [draftAliases, setDraftAliases] = useState<Record<string, string>>({});
  const [windows, setWindows] = useState<ControlWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchPcs();
      setPcs(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PC 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return pcs;
    return pcs.filter((row) =>
      [row.id, row.alias, row.hostname, row.ownerEmail, row.stream?.displayName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword))
    );
  }, [pcs, query]);

  const onlineCount = pcs.filter((row) => row.online).length;

  function openWindow(row: PcRow) {
    const stream = row.stream;
    if (!stream || stream.status !== "ACTIVE") return;
    const existing = windows.find((win) => win.streamId === stream.id);
    if (existing) {
      setWindows((current) => [...current.filter((win) => win.key !== existing.key), existing]);
      return;
    }
    setWindows((current) => [
      ...current,
      {
        key: `${row.id}-${stream.id}-${Date.now()}`,
        deviceId: row.id,
        streamId: stream.id,
        title: displayName(row)
      }
    ]);
  }

  async function saveAlias(row: PcRow) {
    const alias = (draftAliases[row.id] ?? row.alias ?? "").trim();
    setSavingId(row.id);
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alias: alias || null, blocked: row.blocked })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDraftAliases((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "이름 저장 실패");
    } finally {
      setSavingId(null);
    }
  }

  function closeWindow(key: string) {
    setWindows((current) => current.filter((win) => win.key !== key));
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-primary">Remote Control</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-normal">PC Control</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {onlineCount} online / {pcs.length} total
          </p>
        </div>
        <div className="relative w-full lg:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="PC 검색"
            className="pl-9"
          />
        </div>
      </div>

      {error ? <div className="rounded-md border border-border px-3 py-2 text-sm text-primary">{error}</div> : null}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="grid grid-cols-[1fr_120px_120px] border-b border-border px-4 py-3 text-xs font-semibold uppercase text-muted-foreground max-md:hidden">
          <span>PC</span>
          <span>Status</span>
          <span>Last seen</span>
        </div>

        {loading && pcs.length === 0 ? (
          <div className="px-4 py-8 text-sm text-muted-foreground">로딩 중...</div>
        ) : null}

        {filtered.map((row) => {
          const disabled = !row.stream || row.stream.status !== "ACTIVE";
          const aliasValue = draftAliases[row.id] ?? row.alias ?? "";
          return (
            <div
              key={row.id}
              role="button"
              tabIndex={0}
              onClick={() => openWindow(row)}
              onKeyDown={(e) => {
                if (e.key === "Enter") openWindow(row);
              }}
              className={`grid gap-3 border-b border-border px-4 py-4 transition last:border-b-0 md:grid-cols-[1fr_120px_120px] md:items-center ${
                disabled ? "cursor-default opacity-70" : "cursor-pointer hover:bg-muted"
              }`}
            >
              <div className="min-w-0 space-y-2">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      row.online ? "bg-[hsl(var(--status-online))]" : "bg-[hsl(var(--status-offline))]"
                    }`}
                  />
                  <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{displayName(row)}</div>
                    <div className="truncate text-xs text-muted-foreground">{row.id}</div>
                  </div>
                </div>
                <div className="flex max-w-md gap-2" onClick={(e) => e.stopPropagation()}>
                  <Input
                    value={aliasValue}
                    onChange={(e) => setDraftAliases((current) => ({ ...current, [row.id]: e.target.value }))}
                    placeholder="관리자 표시명"
                    className="h-9"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void saveAlias(row)}
                    disabled={savingId === row.id}
                    aria-label="이름 저장"
                    className="h-9 w-9 p-0"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="text-sm font-semibold">
                <span className={row.online ? "text-[hsl(var(--status-online))]" : "text-[hsl(var(--status-offline))]"}>
                  {row.online ? "ONLINE" : "OFFLINE"}
                </span>
                <div className="mt-1 text-xs font-normal text-muted-foreground">
                  {row.stream ? row.stream.status : "NO STREAM"}
                </div>
              </div>

              <div className="text-sm text-muted-foreground">
                {formatSeen(row.lastSeenAt)}
                {row.streamCount > 1 ? <div className="mt-1 text-xs">{row.streamCount} streams</div> : null}
              </div>
            </div>
          );
        })}

        {!loading && filtered.length === 0 ? (
          <div className="px-4 py-8 text-sm text-muted-foreground">표시할 PC가 없습니다.</div>
        ) : null}
      </div>

      {windows.map((win, index) => (
        <div
          key={win.key}
          className="fixed z-50 overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
          style={{
            top: `${72 + index * 26}px`,
            left: `max(16px, min(${260 + index * 26}px, calc(100vw - 896px)))`,
            width: "min(880px, calc(100vw - 32px))"
          }}
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{win.title}</div>
              <div className="truncate text-xs text-muted-foreground">{win.deviceId}</div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => closeWindow(win.key)}
              aria-label="닫기"
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <StreamLivePlayer streamId={win.streamId} watermarkText={win.title} autoConnect compact />
        </div>
      ))}
    </div>
  );
}
