import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <AppShell name={session.user.name ?? "User"} role={session.user.role} isAdmin={session.user.role === "ADMIN"}>
      {children}
    </AppShell>
  );
}
