import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg(process.env.DATABASE_URL ?? "");
const prisma = new PrismaClient({ adapter });

async function main() {
  const name = process.env.SEED_ADMIN_NAME ?? "Admin";
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@buildour.local";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "changeme123";

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin user already exists: ${email}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.user.create({
    data: { name, email, passwordHash, role: "ADMIN" },
  });

  console.log(`Seeded admin user: ${admin.email} (password: ${password})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
