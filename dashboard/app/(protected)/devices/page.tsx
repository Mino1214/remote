import { AgentInstallerCard } from "@/components/agent-installer-card";
import { DevicesTable } from "@/components/devices-table";

export default function DevicesPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Devices</h1>
      <AgentInstallerCard />
      <DevicesTable />
    </div>
  );
}
