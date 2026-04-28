import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>서버 정보</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">서버 도메인</label>
            <Input defaultValue={process.env.RUSTDESK_DOMAIN || ""} readOnly />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">클라이언트 다운로드 링크</label>
            <Input defaultValue={process.env.CLIENT_DOWNLOAD_URL || ""} readOnly />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">공개키</label>
            <Input defaultValue="<hbbs-public-key>" readOnly />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
