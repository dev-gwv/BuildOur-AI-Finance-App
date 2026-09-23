import type { ReactNode } from "react";
import { TrendingUp, Wallet } from "lucide-react";

/**
 * The signed-out layout shared by sign-in, forgot-password and reset-password:
 * a brand panel on large screens, the form centred beside it. The brand panel
 * is always dark, so its greys come from zinc (untouched by the light-mode
 * contrast tokens in globals.css).
 */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#0c0c0f] p-12 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "radial-gradient(60% 50% at 15% 10%, rgba(106,108,240,0.35), transparent 70%), radial-gradient(50% 40% at 90% 80%, rgba(16,185,129,0.18), transparent 70%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          }}
        />
        <div className="relative flex items-center gap-2.5 text-base font-semibold">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-700 shadow-lg shadow-brand-900/40 ring-1 ring-white/20">
            <Wallet className="h-4.5 w-4.5" />
          </span>
          Grateful Finance
        </div>

        <div className="relative space-y-10">
          <div className="max-w-md space-y-4">
            <h2 className="text-4xl font-semibold leading-[1.1] tracking-tight">
              Every rupee, every venture, <span className="text-brand-300">one place.</span>
            </h2>
            <p className="text-[15px] leading-relaxed text-zinc-400">
              Raise tax invoices from a Bajaj DO or GST certificate, record payments from a screenshot, and keep IPC,
              IWC and Mulberry&apos;s sheets in step — automatically.
            </p>
          </div>
          <div className="grid max-w-md grid-cols-3 gap-3">
            {[
              { k: "IPC", c: "bg-brand-400" },
              { k: "IWC", c: "bg-sky-400" },
              { k: "Mulberry", c: "bg-rose-400" },
            ].map((x) => (
              <div key={x.k} className="rounded-xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur">
                <span className="flex items-center gap-1.5 text-xs text-zinc-300">
                  <span className={`h-1.5 w-1.5 rounded-full ${x.c}`} />
                  {x.k}
                </span>
                <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <span className={`block h-full w-2/3 rounded-full ${x.c}`} />
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 text-sm text-emerald-300">
            <TrendingUp className="h-4 w-4" />
            Live collections, dues and GST — per venture
          </div>
        </div>
        <p className="relative text-xs text-zinc-400">© {new Date().getFullYear()} Grateful World Ventures (OPC) Pvt. Ltd.</p>
      </div>

      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 text-lg font-semibold text-neutral-900 lg:hidden dark:text-neutral-100">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Wallet className="h-5 w-5" />
            </span>
            Grateful Finance
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-950 dark:text-white">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** The red "something went wrong" line under a signed-out form. */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
    >
      {children}
    </div>
  );
}
