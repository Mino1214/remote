"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type DeviceRow = {
  id: string;
  hostname?: string;
  online?: boolean;
  lastSeenAt?: string;
  meta?: { alias?: string | null; blocked?: boolean | null } | null;
};

async function fetchDevices(): Promise<DeviceRow[]> {
  const res = await fetch("/api/devices", { cache: "no-store" });
  if (!res.ok) throw new Error("failed");
  const json = await res.json();
  return json.data;
}

export function DevicesTable() {
  const { data = [], isLoading } = useQuery({ queryKey: ["devices"], queryFn: fetchDevices });
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"id" | "hostname">("id");
  const [onlineOnly, setOnlineOnly] = useState(false);

  const rows = useMemo(() => {
    const keyword = search.toLowerCase();
    return [...data]
      .filter((d) => (onlineOnly ? d.online : true))
      .filter(
        (d) =>
          d.id.toLowerCase().includes(keyword) ||
          (d.hostname || "").toLowerCase().includes(keyword) ||
          (d.meta?.alias || "").toLowerCase().includes(keyword)
      )
      .sort((a, b) => (a[sortKey] || "").toString().localeCompare((b[sortKey] || "").toString()));
  }, [data, onlineOnly, search, sortKey]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="ID/호스트/별칭 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button onClick={() => setOnlineOnly((v) => !v)} variant="outline">
          {onlineOnly ? "온라인만: ON" : "온라인만: OFF"}
        </Button>
        <Button onClick={() => setSortKey(sortKey === "id" ? "hostname" : "id")} variant="outline">
          정렬: {sortKey}
        </Button>
      </div>
      <div className="overflow-x-auto rounded border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">RustDesk ID</th>
              <th className="px-3 py-2 text-left">Hostname</th>
              <th className="px-3 py-2 text-left">Alias</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Blocked</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="px-3 py-4" colSpan={5}>
                  로딩 중...
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr className="border-b" key={row.id}>
                  <td className="px-3 py-2">
                    <Link className="underline" href={`/devices/${row.id}`}>
                      {row.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{row.hostname || "-"}</td>
                  <td className="px-3 py-2">{row.meta?.alias || "-"}</td>
                  <td className="px-3 py-2">{row.online ? "online" : "offline"}</td>
                  <td className="px-3 py-2">{row.meta?.blocked ? "yes" : "no"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
