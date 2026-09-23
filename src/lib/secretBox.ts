import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encrypts integration secrets at rest (AES-256-GCM). The key is derived from
 * AUTH_SECRET, so a database dump alone doesn't expose the Razorpay secret —
 * and rotating AUTH_SECRET means re-entering it, which Settings says.
 */
function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET must be set to store integration secrets");
  return createHash("sha256").update(`integration-secrets:${secret}`).digest();
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

/** Null when it can't be opened (e.g. AUTH_SECRET changed) — callers treat that as "not connected". */
export function openSecret(sealed: string): string | null {
  try {
    const [version, iv, tag, data] = sealed.split(".");
    if (version !== "v1") return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
