"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { signIn } from "@/lib/auth";
import { safeNextPath } from "@/server/safeRedirect";

/** Only same-site paths, so the login form can't be used as an open redirect. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = safeNextPath(value);
  return next.startsWith("/login") ? "/dashboard" : next;
}

export async function loginAction(_prevState: string | undefined, formData: FormData) {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: safeNext(formData.get("next")),
    });
  } catch (error) {
    if (error instanceof CredentialsSignin && error.code === "rate_limited") {
      return "Too many sign-in attempts. Please wait 15 minutes and try again.";
    }
    if (error instanceof AuthError) {
      // Deliberately the same for a wrong email, wrong password or a
      // deactivated account, so the form can't be used to find accounts.
      return "Invalid email or password.";
    }
    throw error;
  }
}
