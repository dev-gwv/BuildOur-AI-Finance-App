"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, ExternalLink, KeyRound, Plug, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { formatCurrency, formatDate } from "@/lib/format";
import { ConnectMethodModal, ImportReportDialog, UploadedReports, type ImportStats } from "@/components/settings/GatewayConnect";

type Status = {
  /** How payments come in: Razorpay's API, or uploaded reports. */
  mode: "api" | "file";
  imports: ImportStats;
  enabled: boolean;
  connected: boolean;
  hasKeys: boolean;
  needsReentry: boolean;
  keyId: string | null;
  keyMode: "test" | "live" | null;
  connectedAt: string | null;
};

const HOW_TO_EXPORT = (
  <ol className="list-decimal space-y-1 pl-4">
    <li>Razorpay Dashboard → Transactions → Payments.</li>
    <li>Pick the period (and status &ldquo;Captured&rdquo; if you like), then Download / Export as CSV or Excel.</li>
    <li>Upload that file here. Upload a newer one whenever you want later payments.</li>
  </ol>
);

type FeeRefresh = {
  checked: number;
  updated: number;
  unmatched: { invoiceId: string; invoiceNumber: string; amount: number; paidOn: string }[];
};

/**
 * Connect / switch / disconnect Razorpay. Keys are verified server-side before
 * they're stored, and the secret never comes back to the browser.
 */
export function RazorpayIntegrationCard({ initial }: { initial: Status }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState(initial);
  const [editingKeys, setEditingKeys] = useState(initial.needsReentry);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  /** After an upload or a switch the server decides what's connected: ask it. */
  async function reloadStatus() {
    const res = await fetch("/api/integrations/razorpay");
    if (res.ok) setStatus(await res.json());
    router.refresh();
  }

  async function switchMode(mode: "api" | "file") {
    setPending(true);
    try {
      const res = await fetch("/api/integrations/razorpay/mode", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) return toast.error("Couldn't switch how Razorpay is connected");
      await reloadStatus();
      if (mode === "api" && !status.hasKeys) setEditingKeys(true);
    } finally {
      setPending(false);
    }
  }

  function choose(mode: "api" | "file") {
    setChooserOpen(false);
    if (mode === "file") {
      if (status.imports.count > 0 && status.mode !== "file") void switchMode("file");
      setImportOpen(true);
    } else if (status.mode === "file") void switchMode("api");
    else setEditingKeys(true);
  }
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState<FeeRefresh | null>(null);

  async function refreshFees() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/integrations/razorpay/fees", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't update the fees");
        return;
      }
      setRefreshed(data);
      toast.success(
        data.updated
          ? `Updated the Razorpay fee on ${data.updated} payment${data.updated === 1 ? "" : "s"}`
          : "Every Razorpay payment already has Razorpay's fee"
      );
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setRefreshing(false);
    }
  }

  async function save(body: { enabled?: boolean; keyId?: string; keySecret?: string }, success: string) {
    setPending(true);
    try {
      const res = await fetch("/api/integrations/razorpay", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't save the Razorpay settings");
        return false;
      }
      setStatus(data);
      toast.success(success);
      router.refresh();
      return true;
    } catch {
      toast.error("Network error — please try again");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function onConnect(e: FormEvent) {
    e.preventDefault();
    // Pasting fresh keys is a request to connect, so it also switches it on.
    const ok = await save({ keyId, keySecret, enabled: true }, "Connected to Razorpay");
    if (ok) {
      setEditingKeys(false);
      setKeyId("");
      setKeySecret("");
    }
  }

  async function onDisconnect() {
    const ok = await confirm({
      title: "Disconnect Razorpay?",
      description:
        "The saved API keys are deleted. Payments already recorded keep their fees; new ones go back to the commission % estimate.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    setPending(true);
    try {
      const res = await fetch("/api/integrations/razorpay", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Couldn't disconnect");
        return;
      }
      setStatus(await res.json());
      setEditingKeys(true);
      toast.success("Razorpay disconnected");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const canToggle = status.mode === "api" && status.hasKeys && !status.needsReentry;

  return (
    <Card>
      <CardHeader>
        <CardTitle
          title={
            <span className="flex flex-wrap items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0c2451] text-white">
                <Plug className="h-3.5 w-3.5" />
              </span>
              Razorpay
              {status.connected ? (
                <Badge tone="success" dot>
                  Connected{status.mode === "file" ? " · uploaded reports" : status.keyMode === "test" ? " · test mode" : ""}
                </Badge>
              ) : canToggle ? (
                <Badge tone="warning" dot>
                  Keys saved · switched off
                </Badge>
              ) : (
                <Badge dot>Not connected</Badge>
              )}
            </span>
          }
          subtitle="Exact commission and GST for every Razorpay payment, and payments picked straight from Razorpay instead of a screenshot"
          action={
            canToggle && (
              <div className="flex items-center gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">
                <span>{status.enabled ? "On" : "Off"}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={status.enabled}
                  aria-label="Use Razorpay"
                  disabled={pending}
                  onClick={() =>
                    save({ enabled: !status.enabled }, status.enabled ? "Razorpay switched off" : "Razorpay switched on")
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50 ${
                    status.enabled ? "bg-brand-600" : "bg-neutral-300 dark:bg-neutral-700"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      status.enabled ? "translate-x-[22px]" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            )
          }
        />
      </CardHeader>
      <CardBody className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          {status.needsReentry && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              The saved secret can no longer be read — the app&apos;s AUTH_SECRET has changed since it was stored. Paste
              the keys again to reconnect.
            </p>
          )}

          {status.mode === "file" ? (
            <UploadedReports
              gateway="Razorpay"
              stats={status.imports}
              busy={pending}
              onUpload={() => setImportOpen(true)}
              onSwitchToApi={() => void switchMode("api")}
            />
          ) : !editingKeys && !status.keyId ? (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-neutral-200 px-4 py-4 dark:border-white/10">
              <Button onClick={() => setChooserOpen(true)}>
                <Plug className="h-4 w-4" />
                Connect Razorpay
              </Button>
              <span className="text-sm text-neutral-600 dark:text-neutral-400">With an API key, or by uploading the payments report you export from Razorpay.</span>
            </div>
          ) : !editingKeys && status.keyId ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200/80 bg-neutral-50/60 px-4 py-3 dark:border-white/[0.07] dark:bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <KeyRound className="h-4 w-4 text-neutral-400" />
                <div>
                  <p className="font-mono text-sm text-neutral-900 dark:text-neutral-100">{status.keyId}</p>
                  <p className="text-xs text-neutral-500">
                    Secret stored encrypted
                    {status.connectedAt ? ` · verified ${formatDate(status.connectedAt)}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEditingKeys(true)} disabled={pending}>
                  Replace keys
                </Button>
                <Button variant="ghost" size="sm" onClick={onDisconnect} disabled={pending}>
                  <Unplug className="h-3.5 w-3.5" />
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={onConnect} className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Key ID" hint="Starts with rzp_live_ (or rzp_test_ for trying it out).">
                  <Input
                    value={keyId}
                    onChange={(e) => setKeyId(e.target.value.trim())}
                    placeholder="rzp_live_XXXXXXXXXXXXXX"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    className="font-mono"
                  />
                </Field>
                <Field label="Key Secret" hint="Stored encrypted and never shown again.">
                  <Input
                    type="password"
                    value={keySecret}
                    onChange={(e) => setKeySecret(e.target.value.trim())}
                    placeholder="••••••••••••••••••••"
                    autoComplete="new-password"
                    required
                    className="font-mono"
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" loading={pending} disabled={!keyId || !keySecret}>
                  <CheckCircle2 className="h-4 w-4" />
                  Verify &amp; connect
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEditingKeys(false)}>
                  Cancel
                </Button>
                <span className="text-xs text-neutral-500">Checked with Razorpay before anything is saved.</span>
              </div>
              <p className="text-xs text-neutral-500">
                No API access?{" "}
                <button type="button" onClick={() => choose("file")} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                  Upload exported reports instead
                </button>
              </p>
            </form>
          )}

          <ConnectMethodModal
            open={chooserOpen}
            onClose={() => setChooserOpen(false)}
            gateway="Razorpay"
            apiNote="a Key ID and Key Secret from Razorpay's dashboard"
            onChoose={choose}
          />
          <ImportReportDialog
            open={importOpen}
            onClose={() => setImportOpen(false)}
            provider="razorpay"
            gateway="Razorpay"
            howTo={HOW_TO_EXPORT}
            onImported={() => void reloadStatus()}
          />

          {status.connected && (
            <div className="rounded-xl border border-neutral-200/80 px-4 py-3 dark:border-white/[0.07]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Fees on past payments</p>
                  <p className="text-xs text-neutral-500">
                    Replaces the % estimate with Razorpay&apos;s actual commission on payments from the last 6 months, and
                    updates the sheets.
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={refreshFees} loading={refreshing}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Update from Razorpay
                </Button>
              </div>
              {refreshed && (
                <div className="mt-3 border-t border-neutral-100 pt-3 text-xs text-neutral-600 dark:border-white/[0.06] dark:text-neutral-400">
                  <p>
                    Checked {refreshed.checked} Razorpay payment{refreshed.checked === 1 ? "" : "s"} · updated {refreshed.updated}.
                  </p>
                  {refreshed.unmatched.length > 0 && (
                    <>
                      <p className="mt-1.5">
                        {refreshed.unmatched.length} couldn&apos;t be matched to one Razorpay payment (no payment of that amount
                        that day, or more than one), so they keep the estimate. Open one and add its pay_ ID:
                      </p>
                      <ul className="mt-1 flex flex-wrap gap-1.5">
                        {refreshed.unmatched.slice(0, 20).map((u) => (
                          <li key={`${u.invoiceId}-${u.paidOn}-${u.amount}`}>
                            <Link
                              href={`/invoices/${u.invoiceId}`}
                              className="inline-block rounded-md bg-neutral-100 px-2 py-0.5 font-medium text-neutral-800 hover:bg-neutral-200 dark:bg-white/[0.06] dark:text-neutral-200"
                            >
                              {u.invoiceNumber} · {formatCurrency(u.amount)} · {formatDate(u.paidOn)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <ul className="grid gap-1.5 text-sm text-neutral-600 dark:text-neutral-400">
            <li>• Every Razorpay payment gets its exact fee and GST from Razorpay — by its pay_ ID, or, without one, by finding the one payment of that amount on that day.</li>
            <li>• &ldquo;Pick from Razorpay&rdquo; on any invoice lists up to 60 days of payments — searchable by name, phone, UPI ID or amount — no screenshot needed.</li>
            <li>• A Razorpay payment can only be recorded once; a duplicate is refused.</li>
            <li>• While switched off, Razorpay payments use the commission % in Invoice Settings as an estimate.</li>
          </ul>
        </div>

        {status.mode === "file" ? (
          <aside className="rounded-xl bg-neutral-50 p-4 text-sm text-neutral-600 dark:bg-white/[0.03] dark:text-neutral-400">
            <p className="mb-2 flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Exporting the report
            </p>
            {HOW_TO_EXPORT}
          </aside>
        ) : (
          <aside className="rounded-xl bg-neutral-50 p-4 text-sm dark:bg-white/[0.03]">
            <p className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Where to get the keys
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-neutral-600 dark:text-neutral-400">
              <li>Razorpay Dashboard → Account &amp; Settings → API Keys.</li>
              <li>Generate a key in Live mode (Test mode for trying it out).</li>
              <li>Paste the Key ID and Key Secret here.</li>
            </ol>
            <p className="mt-3 text-xs text-neutral-500">
              The app only reads payments — it can&apos;t refund, capture or move money. The secret is encrypted before
              it&apos;s stored and is never shown again.
            </p>
            <a
              href="https://dashboard.razorpay.com/app/website-app-settings/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-500 dark:text-brand-400"
            >
              Open Razorpay API keys <ExternalLink className="h-3 w-3" />
            </a>
          </aside>
        )}
      </CardBody>
    </Card>
  );
}
