import Link from "next/link";

const items = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/devices", label: "Devices" },
  { href: "/streams", label: "Streams" },
  { href: "/users", label: "Users" },
  { href: "/sessions", label: "Sessions" },
  { href: "/settings", label: "Settings" }
];

export function Sidebar() {
  return (
    <aside className="w-56 border-r bg-card p-4">
      <h2 className="mb-4 text-sm font-semibold text-muted-foreground">RustDesk Admin</h2>
      <nav className="space-y-2">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="block rounded px-3 py-2 text-sm hover:bg-muted">
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
