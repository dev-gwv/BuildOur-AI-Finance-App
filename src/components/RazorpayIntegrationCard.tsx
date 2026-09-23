"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, KeyRound, Plug, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { formatDate } from "@/lib/format";

type Status = {
  enabled: boolean;
  connected: boolean;
  hasKeys: boolean;
  needsReentry: boolean;
  keyId: string | null;
  mode: "test" | "live" | null;
  connectedAt: string | null;
};

const inputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 font-mono text-sm shadow-xs outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/15 dark:border-white/10 dark:bg-neutral-950/60";

/**
 * Connect / switch / disconnect Razorpay. Keys are verified server-side before
 * they're stored, and the secret never comes back to the browser.
 */
export function RazorpayIntegrationCard({ initial }: { initial: Status }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState(initial);
  const [editingKeys, setEditingKeys] = useState(!initial.hasKeys || initial.needsReentry);
  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [pending, setPending] = useState(false);

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

  const canToggle = status.hasKeys && !status.needsReentry;

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
                  Connected{status.mode === "test" ? " · test mode" : ""}
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
                  className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${
                    status.enabled ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      status.enabled ? "left-[22px]" : "left-0.5"
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

          {!editingKeys && status.keyId ? (
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
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  Key ID
                  <input
                    value={keyId}
                    onChange={(e) => setKeyId(e.target.value.trim())}
                    placeholder="rzp_live_XXXXXXXXXXXXXX"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  Key Secret
                  <input
                    type="password"
                    value={keySecret}
                    onChange={(e) => setKeySecret(e.target.value.trim())}
                    placeholder="••••••••••••••••••••"
                    autoComplete="new-password"
                    required
                    className={inputClass}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" loading={pending} disabled={!keyId || !keySecret}>
                  <CheckCircle2 className="h-4 w-4" />
                  Verify &amp; connect
                </Button>
                {canToggle && (
                  <Button type="button" variant="ghost" onClick={() => setEditingKeys(false)}>
                    Cancel
                  </Button>
                )}
                <span className="text-xs text-neutral-500">Checked with Razorpay before anything is saved.</span>
              </div>
            </form>
          )}

          <ul className="grid gap-1.5 text-sm text-neutral-600 dark:text-neutral-400">
            <li>• A payment with a Razorpay ID — typed, or read off a screenshot — gets its exact fee and GST from Razorpay.</li>
            <li>• &ldquo;Pick from Razorpay&rdquo; on any invoice lists the last two weeks&apos; payments, no screenshot needed.</li>
            <li>• A Razorpay payment can only be recorded once; a duplicate is refused.</li>
            <li>• While switched off, Razorpay payments use the commission % in Invoice Settings as an estimate.</li>
          </ul>
        </div>

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
      </CardBody>
    </Card>
  );
}
