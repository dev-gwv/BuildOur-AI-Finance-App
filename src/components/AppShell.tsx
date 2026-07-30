"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Building2,
  FileBarChart,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { initials } from "@/lib/format";

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/reports", label: "Reports", icon: FileBarChart },
];

export function AppShell({
  name,
  role,
  isAdmin,
  children,
}: {
  name: string;
  role: string;
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const links = isAdmin ? [...NAV_LINKS, { href: "/settings/users", label: "Users", icon: Users }] : NAV_LINKS;

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-neutral-200 bg-white lg:flex dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex h-16 items-center gap-2 border-b border-neutral-200 px-5 dark:border-neutral-800">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Wallet className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            BuildOur Finance
          </span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {links.map((link) => (
            <NavLink key={link.href} {...link} active={pathname.startsWith(link.href)} />
          ))}
        </nav>
        <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
          <UserMenu name={name} role={role} />
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-neutral-200 bg-white px-4 lg:hidden dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <Wallet className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              BuildOur Finance
            </span>
          </div>
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-2 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </header>

        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
            <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white dark:bg-neutral-900">
              <div className="flex h-16 items-center justify-between border-b border-neutral-200 px-4 dark:border-neutral-800">
                <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Menu</span>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="rounded-md p-2 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex-1 space-y-1 px-3 py-4">
                {links.map((link) => (
                  <NavLink
                    key={link.href}
                    {...link}
                    active={pathname.startsWith(link.href)}
                    onClick={() => setMobileOpen(false)}
                  />
                ))}
              </nav>
              <div className="border-t border-neutral-200 p-3 dark:border-neutral-800">
                <UserMenu name={name} role={role} />
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
          : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function UserMenu({ name, role }: { name: string; role: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
        {initials(name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{name}</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{role}</p>
      </div>
      <button
        onClick={() => signOut({ redirectTo: "/login" })}
        title="Sign out"
        className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
