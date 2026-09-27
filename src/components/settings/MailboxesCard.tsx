"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Mail, Pencil, Plus, Star, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Field, Input, Select, useFieldErrors } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { formatDate } from "@/lib/format";
import { request } from "./request";

export type MailboxRow = {
  id: string;
  label: string;
  email: string;
  host: string;
  port: number;
  username: string;
  fromName: string | null;
  replyTo: string | null;
  isDefault: boolean;
  verifiedAt: string | null;
  businesses: { id: string; name: string; color: string }[];
};

/** Common providers, so nobody has to look up server names. */
const PROVIDERS = [
  { key: "google", label: "Google Workspace / Gmail", host: "smtp.gmail.com", port: 465, help: "Use an App Password: Google Account → Security → 2-Step Verification on → App passwords." },
  { key: "zoho", label: "Zoho Mail", host: "smtp.zoho.com", port: 465, help: "Use an App Password from Zoho Mail → Settings → Security → App passwords." },
  { key: "zoho-in", label: "Zoho Mail (India data centre)", host: "smtp.zoho.in", port: 465, help: "Only if the mailbox lives in Zoho's India data centre (you sign in at mail.zoho.in)." },
  { key: "outlook", label: "Microsoft 365 / Outlook", host: "smtp.office365.com", port: 587, help: "SMTP sign-in must be allowed for the mailbox in Microsoft 365 admin." },
  { key: "custom", label: "Other (enter server details)", host: "", port: 465, help: "Your email provider's SMTP server name and port." },
] as const;

type ProviderKey = (typeof PROVIDERS)[number]["key"];

function providerFor(host: string): ProviderKey {
  return PROVIDERS.find((p) => p.host && p.host === host)?.key ?? "custom";
}

type FormState = {
  provider: ProviderKey;
  label: string;
  email: string;
  host: string;
  port: string;
  username: string;
  password: string;
  fromName: string;
  replyTo: string;
  isDefault: boolean;
};

const EMPTY: FormState = {
  provider: "google",
  label: "",
  email: "",
  host: "smtp.gmail.com",
  port: "465",
  username: "",
  password: "",
  fromName: "",
  replyTo: "",
  isDefault: false,
};

/**
 * Settings → Integrations → Email: the mailboxes invoices go out from. Each
 * business picks one in its own settings; the default covers the rest and
 * system email. Passwords are write-only and every save signs in first.
 */
export function MailboxesCard({ initial, envFallback }: { initial: MailboxRow[]; envFallback: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<MailboxRow | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { errors, apply, clear } = useFieldErrors<keyof FormState>();

  const provider = PROVIDERS.find((p) => p.key === form.provider)!;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    clear(key);
  };

  function openNew() {
    setForm({ ...EMPTY, isDefault: initial.length === 0 });
    apply(null);
    setEditing("new");
  }

  function openEdit(m: MailboxRow) {
    setForm({
      provider: providerFor(m.host),
      label: m.label,
      email: m.email,
      host: m.host,
      port: String(m.port),
      username: m.username === m.email ? "" : m.username,
      password: "",
      fromName: m.fromName ?? "",
      replyTo: m.replyTo ?? "",
      isDefault: m.isDefault,
    });
    apply(null);
    setEditing(m);
  }

  async function save() {
    setSaving(true);
    const body = {
      label: form.label,
      email: form.email,
      host: form.host,
      port: Number(form.port),
      username: form.username || undefined,
      ...(form.password ? { password: form.password } : {}),
      fromName: form.fromName,
      replyTo: form.replyTo,
      ...(form.isDefault ? { isDefault: true } : {}),
    };
    const res =
      editing === "new"
        ? await request("/api/mail-accounts", "POST", body)
        : await request(`/api/mail-accounts/${(editing as MailboxRow).id}`, "PATCH", body);
    setSaving(false);
    if (!res.ok) {
      apply(res.fields as Partial<Record<keyof FormState, string>> | undefined);
      if (!res.fields) toast.error(res.error);
      return;
    }
    toast.success(editing === "new" ? `Signed in and added ${form.email}` : "Mailbox saved");
    setEditing(null);
    router.refresh();
  }

  async function test(m: MailboxRow) {
    setBusy(m.id);
    const res = await request<{ ok: boolean; error?: string }>(`/api/mail-accounts/${m.id}/test`, "POST");
    setBusy(null);
    if (res.ok && res.data.ok) toast.success(`Signed in to ${m.email} — ready to send`);
    else toast.error(res.ok ? (res.data.error ?? "The sign-in failed") : res.error);
    router.refresh();
  }

  async function makeDefault(m: MailboxRow) {
    setBusy(m.id);
    const res = await request(`/api/mail-accounts/${m.id}`, "PATCH", { isDefault: true });
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(`${m.email} is now the default mailbox`);
    router.refresh();
  }

  async function remove(m: MailboxRow) {
    const ok = await confirm({
      title: `Remove ${m.email}?`,
      description: m.businesses.length
        ? `${m.businesses.map((b) => b.name).join(", ")} will send from the default mailbox instead. Emails already sent aren't affected.`
        : "Emails already sent aren't affected.",
      confirmLabel: "Remove mailbox",
      danger: true,
    });
    if (!ok) return;
    setBusy(m.id);
    const res = await request(`/api/mail-accounts/${m.id}`, "DELETE");
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Mailbox removed");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle
          title={
            <span className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white">
                <Mail className="h-3.5 w-3.5" />
              </span>
              Email
              {initial.length > 0 ? (
                <Badge tone="success" dot>
                  {initial.length} mailbox{initial.length === 1 ? "" : "es"}
                </Badge>
              ) : envFallback ? (
                <Badge tone="warning" dot>Using Vercel settings</Badge>
              ) : (
                <Badge dot>Not set up</Badge>
              )}
            </span>
          }
          subtitle="The mailboxes invoices are sent from. Each business chooses one in Settings → Businesses; the default covers the rest and password-reset emails."
          action={
            <Button size="sm" onClick={openNew}>
              <Plus className="h-3.5 w-3.5" />
              Add mailbox
            </Button>
          }
        />
      </CardHeader>
      <CardBody className="space-y-3">
        {envFallback && initial.length === 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            Email currently goes from <strong>{envFallback}</strong> using the SMTP settings in Vercel. Add it here (and a second
            mailbox if you like) to choose per business — the Vercel settings stay as a fallback.
          </p>
        )}
        {initial.length === 0 && !envFallback && (
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            No mailbox yet, so invoices can&apos;t be emailed. Add one — you&apos;ll need its app password.
          </p>
        )}

        <ul className="divide-y divide-neutral-100 dark:divide-white/[0.06]">
          {initial.map((m) => (
            <li key={m.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {m.email}
                  {m.isDefault && (
                    <Badge tone="brand">
                      <Star className="h-3 w-3" /> Default
                    </Badge>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">
                  {m.label} · {m.host}:{m.port}
                  {m.verifiedAt ? ` · signed in ${formatDate(m.verifiedAt)}` : ""}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
                  {m.businesses.length ? (
                    <>
                      Sends for
                      {m.businesses.map((b) => (
                        <span key={b.id} className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5 dark:bg-white/[0.06]">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: b.color }} />
                          {b.name}
                        </span>
                      ))}
                      {m.isDefault && <span>and any business without its own</span>}
                    </>
                  ) : m.isDefault ? (
                    "Sends for every business that hasn't chosen one"
                  ) : (
                    "Not chosen by any business yet"
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => test(m)} loading={busy === m.id}>
                  <Zap className="h-3.5 w-3.5" />
                  Test
                </Button>
                {!m.isDefault && (
                  <Button size="sm" variant="secondary" onClick={() => makeDefault(m)} disabled={busy === m.id}>
                    <Star className="h-3.5 w-3.5" />
                    Make default
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => openEdit(m)} aria-label={`Edit ${m.email}`}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(m)} disabled={busy === m.id} aria-label={`Remove ${m.email}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        dismissible={!saving}
        title={editing === "new" ? "Add a mailbox" : "Edit mailbox"}
        description="The app signs in to check these details before saving. The password is stored encrypted and never shown again."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              <CheckCircle2 className="h-4 w-4" />
              {editing === "new" ? "Sign in & add" : "Save"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Provider" hint={provider.help}>
            <Select
              value={form.provider}
              onChange={(e) => {
                const next = PROVIDERS.find((p) => p.key === e.target.value)!;
                setForm((f) => ({ ...f, provider: next.key, host: next.host || f.host, port: String(next.port) }));
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email address" error={errors.email}>
              <Input type="email" autoComplete="off" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="accounts@yourcompany.in" />
            </Field>
            <Field label="Name in Settings" error={errors.label} hint="e.g. Grateful accounts">
              <Input value={form.label} onChange={(e) => set("label", e.target.value)} placeholder="Grateful accounts" />
            </Field>
          </div>

          <Field
            label="App password"
            error={errors.password}
            hint={editing !== "new" ? "Leave empty to keep the saved one." : "Not your normal password — an app password from the provider."}
          >
            <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="••••••••••••••••" />
          </Field>

          {form.provider === "custom" && (
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <Field label="SMTP server" error={errors.host}>
                <Input value={form.host} onChange={(e) => set("host", e.target.value)} placeholder="smtp.example.com" />
              </Field>
              <Field label="Port" error={errors.port}>
                <Select value={form.port} onChange={(e) => set("port", e.target.value)}>
                  <option value="465">465 (SSL)</option>
                  <option value="587">587 (STARTTLS)</option>
                </Select>
              </Field>
            </div>
          )}

          <details className="rounded-xl border border-neutral-200/80 px-4 py-3 dark:border-white/10">
            <summary className="cursor-pointer text-sm font-medium text-neutral-800 dark:text-neutral-200">More options</summary>
            <div className="mt-3 grid gap-4">
              <Field label="Sender name" optional hint="Leave empty to use each business's own name (recommended).">
                <Input value={form.fromName} onChange={(e) => set("fromName", e.target.value)} placeholder="Grateful World Ventures" />
              </Field>
              <Field label="Replies go to" optional error={errors.replyTo} hint="Leave empty to receive replies in this mailbox.">
                <Input type="email" value={form.replyTo} onChange={(e) => set("replyTo", e.target.value)} placeholder="accounts@yourcompany.in" />
              </Field>
              <Field label="Sign-in username" optional hint="Only if it differs from the email address.">
                <Input value={form.username} onChange={(e) => set("username", e.target.value)} placeholder={form.email || "same as the email address"} />
              </Field>
            </div>
          </details>

          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-neutral-200/80 px-4 py-2.5 text-sm dark:border-white/10">
            <input type="checkbox" checked={form.isDefault} onChange={(e) => set("isDefault", e.target.checked)} />
            <span>
              <span className="font-medium text-neutral-900 dark:text-neutral-100">Default mailbox</span>
              <span className="block text-xs text-neutral-600 dark:text-neutral-400">
                For businesses without their own, and for password-reset emails.
              </span>
            </span>
          </label>
        </div>
      </Modal>
    </Card>
  );
}
