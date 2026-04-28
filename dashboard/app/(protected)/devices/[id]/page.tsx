import { prisma } from "@/lib/prisma";
import { DeviceDetailForm } from "@/components/device-detail-form";

export default async function DeviceDetailPage({ params }: { params: { id: string } }) {
  const meta = await prisma.deviceMeta.findUnique({ where: { rustdeskId: params.id } });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Device {params.id}</h1>
      <DeviceDetailForm deviceId={params.id} initialAlias={meta?.alias} initialBlocked={meta?.blocked} />
    </div>
  );
}
