"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  FileBarChart,
  FileText,
  HandCoins,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Percent,
  Plug,
  Plus,
  RefreshCw,
  Settings2,
  UserRound,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { initials } from "@/lib/format";
import { BusinessSwitcher, type ShellBusiness } from "@/components/shell/BusinessSwitcher";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; items: NavItem[]; adminOnly?: boolean };

const NAV_GROUPS: NavGroup[] = [
  { label: "Overview", items: [{ href: "/dashboard", label: "Overview", icon: LayoutDashboard }] },
  {
    label: "Sales",
    items: [
      { href: "/invoices", label: "Invoices", icon: FileText },
      { href: "/payments", label: "Payments", icon: HandCoins },
    ],
  },
  {
    label: "Money",
    items: [
      { href: "/money", label: "Money in & out", icon: Wallet },
      { href: "/reports", label: "Reports", icon: FileBarChart },
      { href: "/reports/gst", label: "GST report", icon: Percent },
    ],
  },
  {
    label: "Settings",
    adminOnly: true,
    items: [
      { href: "/settings/businesses", label: "Businesses", icon: Building2 },
      { href: "/settings/team", label: "Team", icon: Users },
      { href: "/settings/invoicing", label: "Invoice defaults", icon: Settings2 },
      { href: "/settings/integrations", label: "Integrations", icon: Plug },
      { href: "/settings/sync", label: "Sheet sync", icon: RefreshCw },
      { href: "/settings/audit", label: "Audit log", icon: History },
    ],
  },
];

const QUICK_CREATE = [
  { href: "/invoices/new", label: "New invoice", hint: "From a Bajaj DO, GST certificate or quotation" },
  { href: "/money/new", label: "Money in / out", hint: "A receipt or a cost, with GST breakup" },
];

/** Readable names for URL segments in the breadcrumb. */
const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Overview",
  invoices: "Invoices",
  payments: "Payments",
  money: "Money in & out",
  reports: "Reports",
  gst: "GST report",
  settings: "Settings",
  businesses: "Businesses",
  team: "Team",
  invoicing: "Invoice defaults",
  integrations: "Integrations",
  sync: "Sheet sync",
  audit: "Audit log",
  account: "Account",
  new: "New",
  edit: "Edit",
};

/**
 * The one nav item to highlight: the longest href the path sits under, so
 * /reports/gst lights up "GST report" and not "Reports" as well.
 */
function activeHref(pathname: string, hrefs: string[]): string | null {
  return (
    hrefs
      .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
      .sort((a, b) => b.length - a.length)[0] ?? null
  );
}

export function AppShell({
  name,
  role,
  isAdmin,
  alertCount = 0,
  businesses,
  current,
  children,
}: {
  name: string;
  role: string;
  isAdmin: boolean;
  /** Overdue invoices + sheet writes that failed, for the badge in the top bar. */
  alertCount?: number;
  /** Businesses this user can switch between, and the one being worked in (null = all). */
  businesses: ShellBusiness[];
  current: ShellBusiness | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const groups = NAV_GROUPS.filter((g) => isAdmin || !g.adminOnly);
  const active = activeHref(
    pathname,
    groups.flatMap((g) => g.items.map((i) => i.href))
  );

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col bg-[#0c0c0f] text-neutral-300">
      <div className="flex h-14 items-center gap-2.5 px-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-lg shadow-brand-900/40 ring-1 ring-white/20">
          <Wallet className="h-3.5 w-3.5" />
        </span>
        <p className="text-sm font-semibold text-white">Grateful Finance</p>
      </div>
      <div className="px-3 pb-2">
        <BusinessSwitcher businesses={businesses} current={current} isAdmin={isAdmin} pathname={pathname} />
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-600">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink key={item.href} {...item} active={item.href === active} onClick={onNavigate} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/[0.06] p-3">
        <UserMenu name={name} role={role} onNavigate={onNavigate} />
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block print:hidden">{sidebar()}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden print:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 animate-fade-up shadow-2xl">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3.5 z-10 rounded-md p-1.5 text-neutral-400 hover:bg-white/10 hover:text-white"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebar(() => setMobileOpen(false))}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-neutral-200/70 bg-canvas/80 px-4 backdrop-blur-xl sm:px-6 lg:px-8 dark:border-white/[0.06] dark:bg-canvas-dark/80 print:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="-ml-1 rounded-md p-1.5 text-neutral-600 hover:bg-neutral-200/60 lg:hidden dark:text-neutral-300 dark:hover:bg-white/10"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <ScopePill current={current} />
          <Breadcrumbs pathname={pathname} />
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/dashboard"
              title={alertCount ? `${alertCount} thing${alertCount === 1 ? "" : "s"} need attention` : "All clear"}
              className="relative rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <Bell className="h-4.5 w-4.5" />
              {alertCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-canvas dark:ring-canvas-dark">
                  {alertCount > 99 ? "99+" : alertCount}
                </span>
              )}
            </Link>
            <QuickCreate />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:p-0">
          <div className="mx-auto max-w-7xl animate-fade-up print:max-w-none">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** Always-visible reminder of which business the page is showing. */
function ScopePill({ current }: { current: ShellBusiness | null }) {
  return (
    <span
      className="hidden shrink-0 items-center gap-1.5 rounded-md border border-neutral-200/80 bg-white px-2 py-0.5 text-xs font-medium text-neutral-700 sm:inline-flex dark:border-white/10 dark:bg-white/[0.04] dark:text-neutral-300"
      title="The business every page is showing — change it in the sidebar"
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: current?.color ?? "conic-gradient(#6a6cf0, #0ea5e9, #e11d48, #6a6cf0)" }}
      />
      {current?.name ?? "All businesses"}
    </span>
  );
}

function Breadcrumbs({ pathname }: { pathname: string }) {
  const segments = pathname.split("/").filter(Boolean);
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      {segments.map((segment, i) => {
        const href = "/" + segments.slice(0, i + 1).join("/");
        const last = i === segments.length - 1;
        // Record ids aren't meaningful to read; show them as "Detail".
        const label = SEGMENT_LABELS[segment] ?? (segment.length > 16 ? "Detail" : segment);
        return (
          <span key={href} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-400" />}
            {last ? (
              <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">{label}</span>
            ) : (
              <Link href={href} className="truncate text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
                {label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function useDismiss(open: boolean, setOpen: (v: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open, setOpen]);
  return ref;
}

function QuickCreate() {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-xs font-medium text-white shadow-sm ring-1 ring-inset ring-white/10 hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        aria-expanded={open}
      >
        <Plus className="h-3.5 w-3.5" />
        Create
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 animate-fade-up overflow-hidden rounded-xl border border-neutral-200/80 bg-white p-1 shadow-pop dark:border-white/10 dark:bg-neutral-900">
          {QUICK_CREATE.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 hover:bg-neutral-100 dark:hover:bg-white/[0.06]"
            >
              <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{item.label}</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{item.hint}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onClick,
}: NavItem & { active: boolean; onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
        active ? "bg-white/[0.08] text-white" : "text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-100"
      }`}
    >
      {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-400" />}
      <Icon className={`h-4 w-4 ${active ? "text-white" : "text-neutral-500 group-hover:text-neutral-300"}`} />
      <span className="flex-1 truncate">{label}</span>
    </Link>
  );
}

function UserMenu({ name, role, onNavigate }: { name: string; role: string; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);
  return (
    <div ref={ref} className="relative">
      {open && (
        <div className="absolute inset-x-0 bottom-full mb-2 animate-fade-up overflow-hidden rounded-xl border border-white/10 bg-neutral-900 p-1 shadow-pop">
          <Link
            href="/account"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-200 hover:bg-white/[0.06]"
          >
            <UserRound className="h-4 w-4 text-neutral-400" />
            Account &amp; password
          </Link>
          <button
            onClick={() => signOut({ redirectTo: "/login" })}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-neutral-200 hover:bg-white/[0.06]"
          >
            <LogOut className="h-4 w-4 text-neutral-400" />
            Sign out
          </button>
        </div>
      )}
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-neutral-600 to-neutral-800 text-xs font-semibold text-white ring-1 ring-white/10">
          {initials(name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">{name}</span>
          <span className="block text-[11px] capitalize text-neutral-500">{role.toLowerCase()}</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-neutral-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
    </div>
  );
}
