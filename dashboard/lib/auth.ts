import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "ID", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const loginId = credentials.email.trim();
        if (!loginId) return null;

        let admin = await prisma.admin.findUnique({ where: { email: loginId } });
        // 이메일 형식이 아닌 단순 ID 입력을 허용한다.
        if (!admin && !loginId.includes("@")) {
          admin = await prisma.admin.findFirst({
            where: {
              OR: [{ email: loginId }, { email: { startsWith: `${loginId}@` } }]
            }
          });
        }
        if (!admin) return null;
        const ok = await compare(credentials.password, admin.password);
        if (!ok) return null;
        return { id: admin.id, email: admin.email, role: admin.role };
      }
    })
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.role = (user as { role?: string }).role;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = (token.role as string | undefined) ?? "OPERATOR";
      }
      return session;
    }
  }
};
