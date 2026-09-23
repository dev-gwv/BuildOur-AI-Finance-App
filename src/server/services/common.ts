import { enforce } from "../rateLimit";
import type { SessionUser } from "../session";

/** Every write passes this: a generous per-user ceiling that stops runaway scripts, not people. */
export async function guardWrite(user: SessionUser): Promise<void> {
  await enforce("writesPerUser", user.id);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const rupees = (n: number) => `₹${round2(n).toLocaleString("en-IN")}`;
