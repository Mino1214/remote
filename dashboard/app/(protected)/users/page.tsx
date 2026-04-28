import { prisma } from "@/lib/prisma";

export default async function UsersPage() {
  const admins = await prisma.admin.findMany({ orderBy: { createdAt: "desc" } });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Users</h1>
      <div className="rounded border bg-card p-4">
        <ul className="space-y-2 text-sm">
          {admins.map((admin) => (
            <li className="flex justify-between border-b pb-2" key={admin.id}>
              <span>{admin.email}</span>
              <span>{admin.role}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
