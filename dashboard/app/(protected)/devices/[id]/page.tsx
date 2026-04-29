import { prisma } from "@/lib/prisma";
import { DeviceDetailForm } from "@/components/device-detail-form";
import { StreamRegisterCard } from "@/components/stream-register-card";

export default async function DeviceDetailPage({ params }: { params: { id: string } }) {
  const meta = await prisma.deviceMeta.findUnique({ where: { rustdeskId: params.id } });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Device {params.id}</h1>
      <DeviceDetailForm deviceId={params.id} initialAlias={meta?.alias} initialBlocked={meta?.blocked} />
      {meta ? <StreamRegisterCard deviceId={params.id} /> : (
        <p className="text-xs text-muted-foreground">
          DeviceMeta가 없습니다. 별칭을 한 번 저장해 메타를 생성하면 스트림을 등록할 수 있습니다.
        </p>
      )}
    </div>
  );
}
