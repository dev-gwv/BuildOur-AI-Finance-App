import { put, del, get } from "@vercel/blob";

const PREFIX = "screenshots/";

function safeExtension(filename: string): string {
  const match = /\.[a-zA-Z0-9]{1,5}$/.exec(filename);
  return match ? match[0].toLowerCase() : "";
}

/**
 * Uploads a screenshot as a private Vercel Blob and returns an opaque name
 * (no slashes) that's safe to store on the Expense record and pass through
 * the /api/uploads/[filename] route.
 */
export async function saveUpload(file: File): Promise<string> {
  const name = `${crypto.randomUUID()}${safeExtension(file.name)}`;
  await put(`${PREFIX}${name}`, file, {
    access: "private",
    addRandomSuffix: false,
  });
  return name;
}

export async function deleteUpload(name: string): Promise<void> {
  await del(`${PREFIX}${name}`);
}

/** Streams a previously uploaded screenshot back, for proxying through an authenticated route. */
export async function readUpload(name: string) {
  return get(`${PREFIX}${name}`, { access: "private" });
}
