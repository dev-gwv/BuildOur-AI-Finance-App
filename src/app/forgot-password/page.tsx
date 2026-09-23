import type { Metadata } from "next";
import { AuthShell } from "@/app/login/AuthShell";
import { resetByEmailAvailable } from "@/server/passwordReset";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = { title: "Forgot password · Grateful Finance" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <AuthShell
      title="Forgot your password?"
      subtitle={
        resetByEmailAvailable()
          ? "Enter your work email and we'll send you a link to choose a new one."
          : "Password reset emails aren't set up for this workspace yet."
      }
    >
      <ForgotPasswordForm emailEnabled={resetByEmailAvailable()} initialEmail={typeof email === "string" ? email.slice(0, 200) : ""} />
    </AuthShell>
  );
}
