import { LoginForm } from "./LoginForm";
import { safeNextPath } from "@/server/safeRedirect";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const { next, reset } = await searchParams;
  // Where the proxy sent them from; the server action checks it's same-site again.
  const safe = next ? safeNextPath(next, "") || undefined : undefined;
  return <LoginForm next={safe} notice={reset === "done" ? "Password changed. Sign in with your new password." : undefined} />;
}
