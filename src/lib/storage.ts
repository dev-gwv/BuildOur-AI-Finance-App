import { put, del, get } from "@vercel/blob";

const PREFIX = "screenshots/";

/**
 * The only kinds of file the app keeps: documents and photos of them. Each is
 * recognised by its first bytes — never by the name or the type the browser
 * claims, both of which the uploader controls. An HTML or SVG file renamed to
 * "proof.png" is refused, so nothing stored can ever run as a web page.
 */
const KINDS = [
  { ext: ".pdf", type: "application/pdf", test: (b: Uint8Array) => ascii(b, 0, 5) === "%PDF-" },
  { ext: ".png", type: "image/png", test: (b: Uint8Array) => b[0] === 0x89 && ascii(b, 1, 3) === "PNG" },
  { ext: ".jpg", type: "image/jpeg", test: (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: ".webp", type: "image/webp", test: (b: Uint8Array) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP" },
] as const;

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** Content types by stored extension, for serving: never taken from stored metadata. */
export const SERVE_TYPES: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.ext, k.type]));
// Files stored before extensions were normalised.
SERVE_TYPES[".jpeg"] = "image/jpeg";

/** Thrown for a file that isn't a PDF or an image; callers turn it into a 400. */
export class UnsupportedUpload extends Error {
  constructor() {
    super("Only PDFs and images (PNG, JPG, WebP) can be uploaded");
  }
}

/**
 * Uploads a document or photo as a private Vercel Blob and returns an opaque
 * name (a UUID plus the extension of what the file really is) that's safe to
 * store on a record and pass through /api/uploads/[filename].
 */
export async function saveUpload(file: File): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const kind = KINDS.find((k) => k.test(head));
  if (!kind) throw new UnsupportedUpload();
  const name = `${crypto.randomUUID()}${kind.ext}`;
  await put(`${PREFIX}${name}`, file, {
    access: "private",
    addRandomSuffix: false,
    contentType: kind.type,
  });
  return name;
}

export async function deleteUpload(name: string): Promise<void> {
  await del(`${PREFIX}${name}`);
}

/** Streams a previously uploaded file back, for proxying through an authenticated route. */
export async function readUpload(name: string) {
  return get(`${PREFIX}${name}`, { access: "private" });
}
