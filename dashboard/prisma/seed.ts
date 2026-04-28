import { hash } from "bcryptjs";
import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_INITIAL_EMAIL;
  const password = process.env.ADMIN_INITIAL_PASSWORD;

  if (!email || !password) {
    throw new Error("ADMIN_INITIAL_EMAIL and ADMIN_INITIAL_PASSWORD are required for seed");
  }

  const hashed = await hash(password, 12);
  await prisma.admin.upsert({
    where: { email },
    update: { password: hashed, role: Role.ADMIN },
    create: { email, password: hashed, role: Role.ADMIN }
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
