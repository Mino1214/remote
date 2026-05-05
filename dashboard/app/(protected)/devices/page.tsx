import { AgentInstallerCard } from "@/components/agent-installer-card";
import { ControlDashboard } from "@/components/control-dashboard";

export default function DevicesPage() {
  return (
    <div className="space-y-6">
      <AgentInstallerCard />
      <ControlDashboard />
    </div>
  );
}
