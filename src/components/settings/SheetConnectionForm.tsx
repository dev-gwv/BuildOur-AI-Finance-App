"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, PlugZap, Unplug } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { request } from "./request";
import { Field, Input } from "@/components/ui/Field";

/**
 * Connects a business to its Google Sheet: the Apps Script web app's /exec URL
 * and the shared secret set at the top of that script. The secret is
 * write-only — it's encrypted on save and never sent back.
 */
export function SheetConnectionForm({
  businessId,
  sheetUrl,
  source,
  envVar,
}: {
  businessId: string;
  sheetUrl: string | null;
  /** Where the live connection comes from today. */
  source: "settings" | "environment" | null;
  /** The legacy environment variable name, when there is one for this business. */
  envVar: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [url, setUrl] = useState(sheetUrl ?? "");
  const [secret, setSecret] = useState("");
  const [pending, setPending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!secret && source !== "settings") {
      toast.error("Paste the secret from the top of the sheet's script too");
      return;
    }
    setPending(true);
    const result = await request(`/api/businesses/${businessId}`, "PATCH", {
      sheetUrl: url.trim(),
      ...(secret ? { sheetSecret: secret } : {}),
    });
    setPending(false);
    if (!result.ok) return toast.error(result.error);
    setSecret("");
    toast.success("Sheet connection saved");
    router.refresh();
  }

  async function onTest() {
    setTesting(true);
    setTest(null);
    const result = await request<{ ok: boolean; workbook?: string; error?: string }>(
      `/api/businesses/${businessId}/sheet-test`,
      "POST"
    );
    setTesting(false);
    if (!result.ok) return setTest({ ok: false, message: result.error });
    setTest(
      result.data.ok
        ? { ok: true, message: `Connected to “${result.data.workbook ?? "the workbook"}”` }
        : { ok: false, message: result.data.error ?? "The sheet didn't answer" }
    );
  }

  async function onDisconnect() {
    const ok = await confirm({
      title: "Disconnect this sheet?",
      description:
        source === "environment"
          ? "The URL saved here is removed. The connection from the environment variables stays until they're removed in Vercel."
          : "New payments and entries stop being written to it. Rows already there stay.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return;
    setPending(true);
    const result = await request(`/api/businesses/${businessId}`, "PATCH", { sheetUrl: "", sheetSecret: "" });
    setPending(false);
    if (!result.ok) return toast.error(result.error);
    setUrl("");
    toast.success("Sheet disconnected");
    router.refresh();
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {source === "settings" && (
          <Badge tone="success" dot>
            Connected
          </Badge>
        )}
        {source === "environment" && (
          <Badge tone="warning" dot>
            Connected via environment variables
          </Badge>
        )}
        {!source && <Badge dot>Not connected</Badge>}
        {source === "environment" && envVar && (
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            Using <code className="font-mono">{envVar}</code>. Save the URL and secret here to manage it from the app instead.
          </span>
        )}
      </div>

      <form onSubmit={onSave} className="grid gap-4">
        <Field label="Web app URL" hint="From Deploy → Manage deployments in the sheet's Apps Script.">
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/…/exec"
            required
            spellCheck={false}
            className="font-mono text-xs"
          />
        </Field>
        <Field label="Shared secret" hint="Stored encrypted and never shown again.">
          <Input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={source === "settings" ? "•••••••• saved — type to replace" : "The SECRET at the top of the script"}
            autoComplete="new-password"
            className="font-mono"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={pending}>
            Save connection
          </Button>
          <Button type="button" variant="secondary" loading={testing} disabled={!source} onClick={onTest}>
            {!testing && <PlugZap className="h-4 w-4" />}
            Test connection
          </Button>
          {source === "settings" && (
            <Button type="button" variant="ghost" onClick={onDisconnect} disabled={pending}>
              <Unplug className="h-4 w-4" />
              Disconnect
            </Button>
          )}
        </div>
      </form>

      {test && (
        <p
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
            test.ok
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300"
          }`}
        >
          {test.ok ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
          {test.message}
        </p>
      )}

      <details className="rounded-xl bg-neutral-50 px-4 py-3 text-sm dark:bg-white/[0.03]">
        <summary className="cursor-pointer font-medium text-neutral-800 dark:text-neutral-200">
          Setting up a sheet for the first time
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-neutral-600 dark:text-neutral-400">
          <li>In the Google Sheet: Extensions → Apps Script. Paste in <code className="font-mono">google-apps-script/PaymentSync.gs</code> from the app&apos;s code.</li>
          <li>At the top, set <code className="font-mono">SECRET</code> to a long random string, and set <code className="font-mono">RECEIPT_COLUMNS</code> to match this sheet&apos;s columns.</li>
          <li>Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone. Authorise it.</li>
          <li>Paste the /exec URL and the same secret above, save, then Test connection.</li>
        </ol>
        <p className="mt-2 text-xs text-neutral-500">
          After editing the script, publish a new version (Manage deployments → edit → New version), or the live URL keeps running the old code.
        </p>
      </details>
    </div>
  );
}
