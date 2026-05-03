"use client";

import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type IssuedToken = {
  id: string;
  token: string;
  tokenPrefix: string;
  installerUrl: string;
  notice: string;
};

type TokenRow = {
  id: string;
  tokenPrefix: string;
  status: "ACTIVE" | "USED" | "REVOKED";
  intendedAlias: string | null;
  intendedOwner: string | null;
  usedByDeviceId: string | null;
  usedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
};

async function fetchTokens(): Promise<TokenRow[]> {
  const res = await fetch("/api/agent/tokens", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data;
}

export function AgentInstallerCard() {
  const [open, setOpen] = useState(false);
  const [alias, setAlias] = useState("");
  const [owner, setOwner] = useState("");
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const list = await fetchTokens();
      setTokens(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIssued(null);
    setBusy(true);
    try {
      const res = await fetch("/api/agent/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intendedAlias: alias.trim() || null,
          intendedOwner: owner.trim() || null
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setIssued(json.data);
      setAlias("");
      setOwner("");
      // 발급 직후 자동 다운로드 트리거 (브라우저가 Content-Disposition으로 파일명 처리).
      window.location.href = json.data.installerUrl;
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "issue error");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("이 토큰을 영구 무효화합니다. 계속할까요?")) return;
    try {
      const res = await fetch(`/api/agent/tokens/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "revoked_via_dashboard" })
      });
      if (!res.ok && res.status !== 409) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "revoke error");
    }
  }

  return (
    <div className="space-y-3 rounded border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">새 PC 등록 (Agent 설치 파일)</h2>
          <p className="text-xs text-muted-foreground">
            한 번 클릭으로 1회용 토큰을 발급하고 그 PC 전용 인스톨러(.exe) 1개만 다운로드합니다.
            토큰은 단 한 번만 사용 가능하며 평문은 발급 시점에만 노출됩니다.
          </p>
        </div>
        <Button onClick={() => setOpen((v) => !v)} variant={open ? "outline" : "default"}>
          {open ? "닫기" : "+ 새 PC 등록"}
        </Button>
      </div>

      {open ? (
        <form className="grid grid-cols-1 gap-2 rounded border border-dashed p-3 sm:grid-cols-3" onSubmit={onSubmit}>
          <Input
            placeholder="별칭 (예: 사무실 데스크탑)"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
          />
          <Input
            type="email"
            placeholder="소유자 이메일 (선택)"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          />
          <Button type="submit" disabled={busy}>
            {busy ? "발급 중..." : "발급 + 다운로드"}
          </Button>
        </form>
      ) : null}

      {issued ? (
        <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-3 text-xs dark:bg-amber-950/30">
          <div className="font-semibold">
            토큰 발급 완료 — 평문은 이 화면에서만 표시됩니다.
          </div>
          <div>
            tokenPrefix: <code className="font-mono">{issued.tokenPrefix}</code>
          </div>
          <div className="break-all">
            token: <code className="font-mono">{issued.token}</code>
          </div>
          <div>
            다운로드:{" "}
            <a className="underline" href={issued.installerUrl}>
              {issued.installerUrl}
            </a>
          </div>
          <div className="text-amber-700 dark:text-amber-200">{issued.notice}</div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded border">
        <table className="w-full text-xs">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-2 py-1 text-left">prefix</th>
              <th className="px-2 py-1 text-left">상태</th>
              <th className="px-2 py-1 text-left">의도된 별칭</th>
              <th className="px-2 py-1 text-left">의도된 소유자</th>
              <th className="px-2 py-1 text-left">사용된 deviceId</th>
              <th className="px-2 py-1 text-left">발급</th>
              <th className="px-2 py-1 text-left">액션</th>
            </tr>
          </thead>
          <tbody>
            {tokens.length === 0 ? (
              <tr>
                <td className="px-2 py-2 text-muted-foreground" colSpan={7}>
                  발급 이력 없음
                </td>
              </tr>
            ) : (
              tokens.map((t) => (
                <tr className="border-b" key={t.id}>
                  <td className="px-2 py-1 font-mono">{t.tokenPrefix}…</td>
                  <td className="px-2 py-1">
                    <span
                      className={`rounded px-1.5 py-0.5 font-semibold ${
                        t.status === "ACTIVE"
                          ? "bg-green-100 text-green-900"
                          : t.status === "USED"
                          ? "bg-gray-200 text-gray-900"
                          : "bg-red-100 text-red-900"
                      }`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-2 py-1">{t.intendedAlias || "-"}</td>
                  <td className="px-2 py-1">{t.intendedOwner || "-"}</td>
                  <td className="px-2 py-1 font-mono">{t.usedByDeviceId || "-"}</td>
                  <td className="px-2 py-1">{new Date(t.createdAt).toLocaleString()}</td>
                  <td className="px-2 py-1">
                    {t.status === "ACTIVE" ? (
                      <button
                        type="button"
                        onClick={() => revoke(t.id)}
                        className="text-destructive underline"
                      >
                        무효화
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
