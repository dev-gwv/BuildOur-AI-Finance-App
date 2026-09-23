import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "../audit";
import { badRequest, conflict, notFound } from "../errors";
import type { SessionUser } from "../session";
import { id, password, requiredText } from "../validation";
import { guardWrite } from "./common";

const BCRYPT_ROUNDS = 12;

const emailRequired = z.string().trim().toLowerCase().email("That doesn't look like an email address");

export const createUserSchema = z.object({
  name: requiredText("Name", 120),
  email: emailRequired,
  password,
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
  businessIds: z.array(id).default([]),
});

export const updateUserSchema = z.object({
  name: requiredText("Name", 120).optional(),
  role: z.enum(["ADMIN", "MEMBER"]).optional(),
  active: z.boolean().optional(),
  /** Set by an admin (a reset); the user should change it after signing in. */
  password: password.optional(),
});

export const userBusinessesSchema = z.object({ businessIds: z.array(id) });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password").max(200),
  newPassword: password,
});

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
  businesses: { select: { businessId: true } },
} as const;

export async function listUsers() {
  return prisma.user.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], select: userSelect });
}

export async function createUser(admin: SessionUser, input: z.infer<typeof createUserSchema>, req: Request) {
  await guardWrite(admin);
  if (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
    throw conflict("Someone with this email already has an account");
  }
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role,
      businesses: { create: input.businessIds.map((businessId) => ({ businessId })) },
    },
    select: userSelect,
  });
  await audit({
    user: admin,
    action: "user.create",
    entityType: "user",
    entityId: user.id,
    summary: `Added ${user.name} (${user.email}) as ${user.role.toLowerCase()}`,
    req,
  });
  return user;
}

/** Active admins other than `exceptId` — there must always be one left. */
async function otherActiveAdmins(exceptId: string) {
  return prisma.user.count({ where: { role: "ADMIN", active: true, id: { not: exceptId } } });
}

export async function updateUser(admin: SessionUser, userId: string, input: z.infer<typeof updateUserSchema>, req: Request) {
  await guardWrite(admin);
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw notFound("That user");

  const demoting = input.role === "MEMBER" && existing.role === "ADMIN";
  const deactivating = input.active === false && existing.active;
  if (userId === admin.id && (demoting || deactivating)) {
    throw badRequest("You can't remove your own admin access or deactivate yourself — ask another admin");
  }
  if ((demoting || deactivating) && existing.role === "ADMIN" && (await otherActiveAdmins(userId)) === 0) {
    throw badRequest("This is the last active admin — make someone else an admin first");
  }

  // Any change to what the account can do ends its current sessions (within a minute).
  const revokes =
    (input.role !== undefined && input.role !== existing.role) ||
    (input.active !== undefined && input.active !== existing.active) ||
    input.password !== undefined;

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.password !== undefined ? { passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS) } : {}),
      ...(revokes ? { sessionVersion: { increment: 1 } } : {}),
    },
    select: userSelect,
  });

  const parts = [
    input.name !== undefined && input.name !== existing.name ? `name → ${input.name}` : null,
    input.role !== undefined && input.role !== existing.role ? `role → ${input.role.toLowerCase()}` : null,
    input.active !== undefined && input.active !== existing.active ? (input.active ? "reactivated" : "deactivated") : null,
    input.password !== undefined ? "password reset" : null,
  ].filter(Boolean);
  await audit({
    user: admin,
    action: input.active === false ? "user.deactivate" : "user.update",
    entityType: "user",
    entityId: userId,
    summary: `${existing.name}: ${parts.join(", ") || "no changes"}`,
    req,
  });
  return user;
}

export async function deleteUser(admin: SessionUser, userId: string, req: Request) {
  await guardWrite(admin);
  if (userId === admin.id) throw badRequest("You can't delete your own account");
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, role: true, active: true, _count: { select: { invoices: true, expenses: true } } },
  });
  if (!existing) throw notFound("That user");
  // Their name is on records they created; removing them would break those.
  if (existing._count.invoices + existing._count.expenses > 0) {
    throw conflict(`${existing.name} created invoices or entries, so their account can't be deleted — deactivate it instead`);
  }
  if (existing.role === "ADMIN" && existing.active && (await otherActiveAdmins(userId)) === 0) {
    throw badRequest("This is the last active admin");
  }
  await prisma.user.delete({ where: { id: userId } });
  await audit({
    user: admin,
    action: "user.delete",
    entityType: "user",
    entityId: userId,
    summary: `Deleted ${existing.name} (${existing.email})`,
    req,
  });
}

export async function setUserBusinesses(admin: SessionUser, userId: string, businessIds: string[], req: Request) {
  await guardWrite(admin);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!user) throw notFound("That user");
  const unique = [...new Set(businessIds)];
  const found = await prisma.business.count({ where: { id: { in: unique } } });
  if (found !== unique.length) throw badRequest("One of those businesses doesn't exist");

  await prisma.$transaction([
    prisma.businessMember.deleteMany({ where: { userId, businessId: { notIn: unique } } }),
    ...unique.map((businessId) =>
      prisma.businessMember.upsert({
        where: { userId_businessId: { userId, businessId } },
        create: { userId, businessId },
        update: {},
      })
    ),
  ]);
  const names = await prisma.business.findMany({ where: { id: { in: unique } }, select: { name: true } });
  await audit({
    user: admin,
    action: "user.access",
    entityType: "user",
    entityId: userId,
    summary: `${user.name} can access: ${names.map((n) => n.name).join(", ") || "no businesses"}`,
    req,
  });
}

export async function changeOwnPassword(user: SessionUser, input: z.infer<typeof changePasswordSchema>, req: Request) {
  await guardWrite(user);
  const existing = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!existing) throw notFound("Your account");
  if (!(await bcrypt.compare(input.currentPassword, existing.passwordHash))) {
    throw badRequest("Your current password isn't right", { currentPassword: "Incorrect" });
  }
  if (input.currentPassword === input.newPassword) {
    throw badRequest("Choose a password different from the current one", { newPassword: "Same as the current one" });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS), sessionVersion: { increment: 1 } },
  });
  await audit({ user, action: "user.password", entityType: "user", entityId: user.id, summary: "Changed their password", req });
}
