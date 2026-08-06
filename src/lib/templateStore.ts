import { prisma } from "./prisma";
import { DEFAULT_TEMPLATES } from "./emailTemplate";
import type { BrandKey } from "./brands";

/**
 * The brand's saved covering message, falling back to the built-in wording.
 * Kept apart from emailTemplate.ts so the placeholder helpers there stay safe
 * to import from client components without dragging Prisma along.
 */
export async function templateFor(brand: BrandKey): Promise<{ subject: string; body: string }> {
  const saved = await prisma.emailTemplate.findUnique({ where: { brand } });
  return saved ?? DEFAULT_TEMPLATES[brand];
}
