import Link from "next/link";
import { Monitor } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

const items = [
  { href: "/dashboard", label: "PC Control", icon: Monitor }
  // 필요 시 복구:
  // { href: "/devices", label: "Devices", icon: Monitor },
  // { href: "/streams", label: "Streams", icon: Video },
  // { href: "/users", label: "Users", icon: Users },
  // { href: "/settings", label: "Settings", icon: Settings }
];

export function Sidebar() {
  return (
    <aside className="sticky top-0 z-20 flex w-full shrink-0 flex-col border-b border-border bg-card px-3 py-3 md:h-screen md:w-60 md:border-b-0 md:border-r md:py-4">
      <div className="mb-2 flex items-center justify-between px-2 md:mb-6">
        <div>
          <h2 className="text-sm font-semibold">PC Control</h2>
          <p className="text-xs text-muted-foreground">RTC dashboard</p>
        </div>
        <ThemeToggle />
      </div>
      <nav className="space-y-1 md:space-y-1">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
