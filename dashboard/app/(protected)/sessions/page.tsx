import { prisma } from "@/lib/prisma";

export default async function SessionsPage() {
  const sessions = await prisma.accessLog.findMany({ orderBy: { startedAt: "desc" }, take: 100 });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Sessions</h1>
      <div className="overflow-x-auto rounded border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left">RustDesk ID</th>
              <th className="px-3 py-2 text-left">Remote IP</th>
              <th className="px-3 py-2 text-left">Start</th>
              <th className="px-3 py-2 text-left">End</th>
              <th className="px-3 py-2 text-left">Bytes</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr className="border-b" key={s.id}>
                <td className="px-3 py-2">{s.rustdeskId}</td>
                <td className="px-3 py-2">{s.remoteIp || "-"}</td>
                <td className="px-3 py-2">{s.startedAt.toISOString()}</td>
                <td className="px-3 py-2">{s.endedAt?.toISOString() || "-"}</td>
                <td className="px-3 py-2">{s.bytesRelayed.toString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
