import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { Sidebar } from "@/components/sidebar";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen flex-col md:flex-row">
        <Sidebar />
        <main className="min-w-0 flex-1 px-3 py-3 sm:px-4 md:px-6 md:py-5 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
