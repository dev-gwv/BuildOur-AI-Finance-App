"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Globe, Plug, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
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
  host: string | null;
  connectedAt: string | null;
};

/**
 * Connect / switch / disconnect TagMango. The key is checked with TagMango
 * before it's stored, and never comes back to the browser.
 */
export function TagMangoIntegrationCard({ initial }: { initial: Status }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState(initial);
  const [editing, setEditing] = useState(!initial.hasKeys || initial.needsReentry);
  const [host, setHost] = useState(initial.host ?? "");
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState(false);

  async function save(body: { enabled?: boolean; host?: string; apiKey?: string }, success: string) {
    setPending(true);
    try {
      const res = await fetch("/api/integrations/tagmango", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't save the TagMango settings");
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
    const ok = await save({ host, apiKey, enabled: true }, "Connected to TagMango");
    if (ok) {
      setEditing(false);
      setApiKey("");
    }
  }

  async function onDisconnect() {
    const ok = await confirm({
      title: "Disconnect TagMango?",
      description: "The saved API key is deleted. Payments already recorded stay as they are.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    setPending(true);
    try {
      const res = await fetch("/api/integrations/tagmango", { method: "DELETE" });
      if (!res.ok) return toast.error("Couldn't disconnect");
      setStatus(await res.json());
      setEditing(true);
      setHost("");
      toast.success("TagMango disconnected");
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
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#f97316] text-white">
                <Plug className="h-3.5 w-3.5" />
              </span>
              TagMango
              {status.connected ? (
                <Badge tone="success" dot>
                  Connected
                </Badge>
              ) : canToggle ? (
                <Badge tone="warning" dot>
                  Key saved · switched off
                </Badge>
              ) : (
                <Badge dot>Not connected</Badge>
              )}
            </span>
          }
          subtitle="Pick TagMango payments straight into an invoice, with their exact GST and TagMango's commission"
          action={
            canToggle && (
              <div className="flex items-center gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">
                <span>{status.enabled ? "On" : "Off"}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={status.enabled}
                  aria-label="Use TagMango"
                  disabled={pending}
                  onClick={() => save({ enabled: !status.enabled }, status.enabled ? "TagMango switched off" : "TagMango switched on")}
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
              The saved key can no longer be read — the app&apos;s AUTH_SECRET has changed since it was stored. Paste it again to
              reconnect.
            </p>
          )}

          {!editing && status.host ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200/80 bg-neutral-50/60 px-4 py-3 dark:border-white/[0.07] dark:bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <Globe className="h-4 w-4 text-neutral-400" />
                <div>
                  <p className="font-mono text-sm text-neutral-900 dark:text-neutral-100">{status.host}</p>
                  <p className="text-xs text-neutral-500">
                    API key stored encrypted
                    {status.connectedAt ? ` · verified ${formatDate(status.connectedAt)}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEditing(true)} disabled={pending}>
                  Replace key
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
                <Field label="Dashboard address" hint="The address you open TagMango's creator dashboard on.">
                  <Input
                    value={host}
                    onChange={(e) => setHost(e.target.value.trim())}
                    placeholder="learn.yourbrand.com"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    className="font-mono placeholder:font-sans"
                  />
                </Field>
                <Field label="API key" hint="Stored encrypted and never shown again.">
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value.trim())}
                    placeholder="••••••••••••••••••••"
                    autoComplete="new-password"
                    required
                    className="font-mono"
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" loading={pending} disabled={!host || !apiKey}>
                  <CheckCircle2 className="h-4 w-4" />
                  Verify &amp; connect
                </Button>
                {canToggle && (
                  <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                )}
                <span className="text-xs text-neutral-500">Checked with TagMango before anything is saved.</span>
              </div>
            </form>
          )}

          <ul className="grid gap-1.5 text-sm text-neutral-600 dark:text-neutral-400">
            <li>• &ldquo;Pick from TagMango&rdquo; on any invoice lists recent TagMango payments, searchable by customer, course or amount.</li>
            <li>• Picking one fills in the amount, date and TagMango&apos;s commission (with its GST); the sheet gets the same figures.</li>
            <li>• A TagMango payment can only be recorded once; a duplicate is refused.</li>
          </ul>
        </div>

        <aside className="rounded-xl bg-neutral-50 p-4 text-sm dark:bg-white/[0.03]">
          <p className="flex items-center gap-2 font-medium text-neutral-900 dark:text-neutral-100">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            Getting the API key
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-4 text-neutral-600 dark:text-neutral-400">
            <li>TagMango gives API access on its Ultimate plan.</li>
            <li>Ask your TagMango account manager for an API key.</li>
            <li>Paste it here with your dashboard&apos;s address.</li>
          </ol>
          <p className="mt-3 text-xs text-neutral-500">
            The app only reads transactions — it can&apos;t refund or change anything on TagMango.
          </p>
        </aside>
      </CardBody>
    </Card>
  );
}
