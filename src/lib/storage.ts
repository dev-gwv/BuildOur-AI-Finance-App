import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

function safeExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : "";
}

export async function saveUpload(file: File): Promise<string> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const filename = `${crypto.randomUUID()}${safeExtension(file.name)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOADS_DIR, filename), buffer);
  return filename;
}

export function uploadPath(filename: string): string {
  return path.join(UPLOADS_DIR, filename);
}
