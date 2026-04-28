import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function requireServerSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}
