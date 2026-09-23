import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Where the proxy sent them from; the server action checks it's same-site again.
  const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;
  return <LoginForm next={safe} />;
}
