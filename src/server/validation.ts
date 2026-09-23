import { z, type ZodType } from "zod";
import { badRequest } from "./errors";

// Every API input goes through a schema, so the database only ever sees values
// of the right shape and the user gets a message naming the field that's wrong.

/** FormData -> plain object (last value wins; files kept as File). Empty strings become undefined. */
export function formToObject(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    out[key] = typeof value === "string" ? (value.trim() === "" ? undefined : value.trim()) : value;
  }
  return out;
}

export function parseInput<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data);
}

export async function parseForm<T>(req: Request, schema: ZodType<T>): Promise<{ data: T; form: FormData }> {
  const form = await req.formData().catch(() => null);
  if (!form) throw badRequest("Expected a form submission");
  return { data: schema.parse(formToObject(form)), form };
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const body = await req.json().catch(() => undefined);
  if (body === undefined) throw badRequest("Expected JSON");
  return schema.parse(body);
}

// --- Reusable field schemas ---------------------------------------------------

/** Rupees: a finite number with at most 2 decimals' worth of meaning. */
export const money = (label = "Amount") =>
  z.coerce
    .number({ error: `${label} must be a number` })
    .refine(Number.isFinite, `${label} must be a number`)
    .transform((n) => Math.round(n * 100) / 100);

export const positiveMoney = (label = "Amount") => money(label).refine((n) => n > 0, `${label} must be more than zero`);

export const percent = (label = "Rate") =>
  z.coerce.number({ error: `${label} must be a number` }).min(0, `${label} can't be negative`).max(100, `${label} can't exceed 100%`);

/** A calendar date as YYYY-MM-DD, returned as a Date at UTC midnight. */
export const isoDate = (label = "Date") =>
  z
    .string({ error: `${label} is required` })
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date`)
    .transform((s) => new Date(`${s}T00:00:00.000Z`))
    .refine((d) => !Number.isNaN(d.getTime()), `${label} must be a real date`);

export const requiredText = (label: string, max = 500) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `${label} is too long`);

export const optionalText = (max = 2000) => z.string().trim().max(max).optional().transform((v) => v || null);

export const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z0-9]{13}$/, "A GSTIN is 15 characters and starts with the 2-digit state code")
  .optional()
  .transform((v) => v || null);

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("That doesn't look like an email address")
  .optional()
  .transform((v) => v || null);

export const id = z.string().trim().min(1).max(64);

export const password = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), "Use both letters and numbers");
