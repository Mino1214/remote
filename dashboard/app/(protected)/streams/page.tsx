import { StreamsLiveTable } from "@/components/streams-live-table";

export const dynamic = "force-dynamic";

export default function StreamsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Monitoring Streams</h1>
      <p className="text-xs text-muted-foreground">
        모든 활성 스트림은 클라이언트 동의 + 항상 표시되는 ● REC 워터마크 + 사용자 일시정지 가능
        조건을 만족합니다. 동의 없는 스트림(PENDING)은 ingest가 자동 차단됩니다.
      </p>
      <StreamsLiveTable />
    </div>
  );
}
