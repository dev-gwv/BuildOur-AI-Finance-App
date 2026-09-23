"use client";

import { useEffect } from "react";

/**
 * Last resort: the root layout itself failed. It replaces the whole document
 * and gets none of the app's CSS, so it's styled inline and follows the OS
 * light/dark preference on its own.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          background: "var(--bg)",
          color: "var(--fg)",
        }}
      >
        <style>{`
          :root { --bg: #f6f6f3; --fg: #0a0a0a; --muted: #737373; --card: #fff; --line: #e5e5e5; }
          @media (prefers-color-scheme: dark) { :root { --bg: #09090b; --fg: #fafafa; --muted: #a3a3a3; --card: #171717; --line: #262626; } }
        `}</style>
        <title>Something went wrong · Grateful Finance</title>
        <div
          style={{
            maxWidth: 420,
            margin: 16,
            padding: 32,
            textAlign: "center",
            background: "var(--card)",
            border: "1px solid var(--line)",
            borderRadius: 16,
          }}
        >
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Grateful Finance couldn&apos;t load</h1>
          <p style={{ fontSize: 14, color: "var(--muted)", margin: "8px 0 0" }}>
            Something went wrong on our side. Your data is safe — please try again.
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: "var(--muted)", fontFamily: "ui-monospace, monospace", margin: "12px 0 0" }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={() => unstable_retry()}
            style={{
              marginTop: 24,
              height: 36,
              padding: "0 16px",
              border: 0,
              borderRadius: 8,
              background: "var(--fg)",
              color: "var(--bg)",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
