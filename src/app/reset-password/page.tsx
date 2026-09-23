import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/app/login/AuthShell";
import { checkResetToken } from "@/server/passwordReset";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = { title: "Choose a new password · Grateful Finance" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const state = await checkResetToken(typeof token === "string" ? token : null);

  if (state !== "valid") {
    const why =
      state === "expired"
        ? "This link has expired — they work for 30 minutes."
        : state === "used"
          ? "This link has already been used."
          : "This link isn't valid. Copy the whole link from the email, or ask for a new one.";
    return (
      <AuthShell title="Link can't be used" subtitle={why}>
        <Link
          href="/forgot-password"
          className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900"
        >
          Send a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="At least 10 characters, with letters and numbers. You'll be signed out everywhere else.">
      <ResetPasswordForm token={token!} />
    </AuthShell>
  );
}
