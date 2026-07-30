import { prisma } from "@/lib/prisma";

export type SessionUser = { id: string; role: string };

/** Returns "ALL" for admins, or a list of company ids a member can access. */
export async function getAccessibleCompanyIds(
  user: SessionUser
): Promise<string[] | "ALL"> {
  if (user.role === "ADMIN") return "ALL";
  const memberships = await prisma.companyMember.findMany({
    where: { userId: user.id },
    select: { companyId: true },
  });
  return memberships.map((m) => m.companyId);
}

export async function canAccessCompany(
  user: SessionUser,
  companyId: string
): Promise<boolean> {
  if (user.role === "ADMIN") return true;
  const membership = await prisma.companyMember.findUnique({
    where: { userId_companyId: { userId: user.id, companyId } },
  });
  return !!membership;
}
