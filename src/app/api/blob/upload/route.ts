import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/lib/auth";

/**
 * Issues short-lived tokens so the browser can send a file straight to Blob
 * storage. Quotation decks run to tens of megabytes, well past the 4.5 MB a
 * serverless function is allowed to receive, so they can't be proxied through
 * the server the way smaller uploads are.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        // The token is minted here, so this is the point to check the caller is
        // signed in — the upload itself never reaches our code.
        const session = await auth();
        if (!session?.user) throw new Error("Not authenticated");

        return {
          access: "private",
          // The client already sends a UUID name, matching how server-side
          // uploads are stored so the same /api/uploads route can serve them.
          addRandomSuffix: false,
          allowedContentTypes: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
          maximumSizeInBytes: 50 * 1024 * 1024,
        };
      },
      onUploadCompleted: async () => {
        // Nothing to do: the pathname is stored with the invoice when it's saved.
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 400 }
    );
  }
}
