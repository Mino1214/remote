"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function DeviceDetailForm(props: { deviceId: string; initialAlias?: string | null; initialBlocked?: boolean }) {
  const [alias, setAlias] = useState(props.initialAlias || "");
  const [blocked, setBlocked] = useState(Boolean(props.initialBlocked));
  const [status, setStatus] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("저장 중...");
    const res = await fetch(`/api/devices/${props.deviceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alias, blocked })
    });
    setStatus(res.ok ? "저장되었습니다." : "저장 실패");
  }

  return (
    <form className="space-y-4 rounded border bg-card p-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <label className="text-sm font-medium">별칭</label>
        <Input value={alias} onChange={(e) => setAlias(e.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input checked={blocked} onChange={(e) => setBlocked(e.target.checked)} type="checkbox" />
        차단 플래그
      </label>
      <Button type="submit">저장</Button>
      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
    </form>
  );
}
