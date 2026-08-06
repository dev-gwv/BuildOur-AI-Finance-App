"use client";

import { upload } from "@vercel/blob/client";
import { extractText } from "unpdf";

/** Must match the prefix used by src/lib/storage.ts so /api/uploads can serve it. */
const PREFIX = "screenshots/";

function safeExtension(filename: string): string {
  const match = /\.[a-zA-Z0-9]{1,5}$/.exec(filename);
  return match ? match[0].toLowerCase() : "";
}

/**
 * Sends a file straight from the browser to Blob storage and returns the opaque
 * name to store on the record. Used for quotation decks, which are far larger
 * than the 4.5 MB a serverless function can accept.
 */
export async function uploadDirectToBlob(file: File): Promise<string> {
  const name = `${crypto.randomUUID()}${safeExtension(file.name)}`;
  const blob = await upload(`${PREFIX}${name}`, file, {
    access: "private",
    handleUploadUrl: "/api/blob/upload",
  });
  return blob.pathname.startsWith(PREFIX) ? blob.pathname.slice(PREFIX.length) : blob.pathname;
}

/** Reads a PDF's text in the browser, so the file itself never has to be uploaded to be parsed. */
export async function extractPdfTextInBrowser(file: File): Promise<string> {
  const { text } = await extractText(new Uint8Array(await file.arrayBuffer()), { mergePages: true });
  return text.replace(/\s+/g, " ");
}

/**
 * OCRs a payment screenshot in the browser. Tesseract is loaded on demand —
 * it pulls down a few MB of worker and language data, which shouldn't be paid
 * for by everyone who merely opens an invoice.
 */
export async function readImageTextInBrowser(file: File): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(file);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
