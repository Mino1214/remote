import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { rustdeskApi } from "@/lib/rustdesk-api";
import { startOfDay } from "date-fns";

async function getSummary() {
  const today = startOfDay(new Date());
  const [devices, todaySessions, recentSessions] = await Promise.all([
    rustdeskApi.listDevices(),
    prisma.accessLog.count({ where: { startedAt: { gte: today } } }),
    prisma.accessLog.count({ where: { startedAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7) } } })
  ]);

  return { activeDevices: devices.filter((d) => d.online).length, todaySessions, recentSessions };
}

export default async function DashboardPage() {
  const summary = await getSummary();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>활성 디바이스</CardTitle>
          </CardHeader>
          <CardContent>{summary.activeDevices}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>오늘 접속 수</CardTitle>
          </CardHeader>
          <CardContent>{summary.todaySessions}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>최근 세션 수</CardTitle>
          </CardHeader>
          <CardContent>{summary.recentSessions}</CardContent>
        </Card>
      </div>
    </div>
  );
}
