"use client";

import { useRef, useState, type ReactNode } from "react";
import { FileSpreadsheet, KeyRound, Loader2, UploadCloud } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { formatCurrency, formatDate } from "@/lib/format";
import { FIELD_LABELS, IMPORT_FIELDS, type ColumnMapping, type ImportField, type ImportedPayment } from "@/lib/gatewayImport";

export type ImportStats = { count: number; newestPayment: string | null; lastImport: string | null };

/** The two ways a gateway can be connected, chosen once and switchable later. */
export function ConnectMethodModal({
  open,
  onClose,
  gateway,
  apiNote,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  gateway: string;
  /** What the API path needs, e.g. "Key ID and Key Secret from the dashboard". */
  apiNote: ReactNode;
  onChoose: (mode: "api" | "file") => void;
}) {
  const option = (mode: "api" | "file", icon: ReactNode, title: string, body: ReactNode, tag?: string) => (
    <button
      type="button"
      onClick={() => onChoose(mode)}
      className="group flex w-full items-start gap-3 rounded-xl border border-neutral-200 p-4 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-white/10 dark:hover:border-brand-500/40 dark:hover:bg-brand-500/[0.06]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 group-hover:bg-white dark:bg-white/[0.06] dark:text-neutral-200">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-white">
          {title}
          {tag && <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{tag}</span>}
        </span>
        <span className="mt-0.5 block text-sm text-neutral-600 dark:text-neutral-400">{body}</span>
      </span>
    </button>
  );
  return (
    <Modal open={open} onClose={onClose} title={`Connect ${gateway}`} description="Choose how the app gets your payments. You can switch later.">
      <div className="grid gap-3">
        {option(
          "api",
          <KeyRound className="h-4 w-4" />,
          "Connect with an API key",
          <>Payments appear by themselves, always up to date. Needs {apiNote}.</>,
          "Live"
        )}
        {option(
          "file",
          <FileSpreadsheet className="h-4 w-4" />,
          "Upload exported reports",
          <>No API access needed: download the payments report from {gateway} (CSV or Excel) and upload it here whenever you want newer payments.</>
        )}
      </div>
    </Modal>
  );
}

type Preview = {
  fileName: string;
  headers: string[];
  mapping: ColumnMapping;
  inPaise: boolean;
  missing: ImportField[];
  count: number;
  alreadyImported: number;
  total: number;
  fees: number;
  from: string | null;
  to: string | null;
  skipped: Record<string, number>;
  feeGstAssumed: boolean;
  sample: ImportedPayment[];
  imported: number;
};

/**
 * Upload a gateway's exported payments report: the app reads it and shows
 * what it found and how it matched the columns, any of which can be
 * corrected, before anything is saved.
 */
export function ImportReportDialog({
  open,
  onClose,
  provider,
  gateway,
  howTo,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  provider: "razorpay" | "tagmango";
  gateway: string;
  /** Where to download the report, as steps. */
  howTo: ReactNode;
  onImported: () => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [inPaise, setInPaise] = useState(false);
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setMapping(null);
    setInPaise(false);
    if (input.current) input.current.value = "";
  }

  async function send(f: File, opts: { mapping?: ColumnMapping | null; inPaise?: boolean; commit?: boolean }) {
    const body = new FormData();
    body.set("file", f);
    if (opts.mapping) body.set("mapping", JSON.stringify(opts.mapping));
    if (opts.inPaise !== undefined) body.set("inPaise", opts.inPaise ? "on" : "off");
    if (opts.commit) body.set("commit", "on");
    const res = await fetch(`/api/integrations/${provider}/import`, { method: "POST", body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Couldn't read that report");
    return data as Preview;
  }

  async function read(f: File, opts: { mapping?: ColumnMapping | null; inPaise?: boolean } = {}) {
    setBusy("reading");
    try {
      const p = await send(f, opts);
      setPreview(p);
      setMapping(p.mapping);
      setInPaise(p.inPaise);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't read that report");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!file) return;
    setBusy("saving");
    try {
      const p = await send(file, { mapping, inPaise, commit: true });
      toast.success(`Imported ${p.imported} ${gateway} payments (${p.imported - p.alreadyImported} new)`);
      reset();
      onImported();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't import that report");
    } finally {
      setBusy(null);
    }
  }

  function remap(field: ImportField, value: string) {
    const next = { ...(mapping ?? {}), [field]: value === "" ? null : Number(value) };
    setMapping(next);
    if (file) void read(file, { mapping: next, inPaise });
  }

  const skippedTotal = preview ? Object.values(preview.skipped).reduce((a, b) => a + b, 0) : 0;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (busy) return;
        reset();
        onClose();
      }}
      size="lg"
      title={`Upload a ${gateway} report`}
      description="Nothing is saved until you check what was found and press Import."
    >
      <div className="space-y-4">
        {!preview && (
          <>
            <div className="rounded-xl bg-neutral-50 p-4 text-sm text-neutral-700 dark:bg-white/[0.03] dark:text-neutral-300">{howTo}</div>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 px-4 py-8 text-center hover:border-brand-300 dark:border-white/10">
              {busy === "reading" ? <Loader2 className="h-6 w-6 animate-spin text-neutral-400" /> : <UploadCloud className="h-6 w-6 text-neutral-400" />}
              <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">{busy === "reading" ? "Reading the report…" : "Choose the CSV or Excel (.xlsx) file"}</span>
              <input
                ref={input}
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                disabled={busy !== null}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setFile(f);
                  void read(f);
                }}
              />
            </label>
          </>
        )}

        {preview && (
          <>
            <div className="rounded-xl border border-neutral-200 p-4 text-sm dark:border-white/10">
              <p className="font-medium text-neutral-900 dark:text-white">{preview.fileName}</p>
              {preview.missing.length ? (
                <p className="mt-1 text-amber-700 dark:text-amber-400">
                  Couldn&apos;t tell which column is the {preview.missing.map((f) => FIELD_LABELS[f].toLowerCase()).join(" and the ")} — pick it below.
                </p>
              ) : (
                <p className="mt-1 text-neutral-600 dark:text-neutral-400">
                  <span className="font-semibold text-neutral-900 dark:text-white">{preview.count}</span> completed payments ·{" "}
                  {formatCurrency(preview.total)}
                  {preview.fees > 0 && ` · fees ${formatCurrency(preview.fees)}`}
                  {preview.from && preview.to && ` · ${formatDate(preview.from)} – ${formatDate(preview.to)}`}
                  {preview.alreadyImported > 0 && ` · ${preview.alreadyImported} already imported (they'll be updated, not duplicated)`}
                  {skippedTotal > 0 &&
                    ` · ${skippedTotal} row${skippedTotal === 1 ? "" : "s"} left out: ${Object.entries(preview.skipped)
                      .map(([why, n]) => (Object.keys(preview.skipped).length > 1 ? `${n} ${why}` : why))
                      .join("; ")}`}
                </p>
              )}
              {preview.feeGstAssumed && (
                <p className="mt-1 text-xs text-neutral-500">The report doesn&apos;t split out GST on the fee, so it&apos;s taken as 18% inside the fee.</p>
              )}
            </div>

            <details open={preview.missing.length > 0} className="rounded-xl border border-neutral-200 p-3 text-sm dark:border-white/10">
              <summary className="cursor-pointer font-medium text-neutral-800 dark:text-neutral-200">How the columns were matched</summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {IMPORT_FIELDS.map((field) => (
                  <label key={field} className="grid gap-1 text-xs text-neutral-600 dark:text-neutral-400">
                    {FIELD_LABELS[field]}
                    <Select value={mapping?.[field] ?? ""} onChange={(e) => remap(field, e.target.value)} disabled={busy !== null}>
                      <option value="">— not in this report —</option>
                      {preview.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </Select>
                  </label>
                ))}
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={inPaise}
                  onChange={(e) => {
                    setInPaise(e.target.checked);
                    if (file) void read(file, { mapping, inPaise: e.target.checked });
                  }}
                />
                Amounts in this report are in paise (₹5,000 shows as 500000)
              </label>
            </details>

            {preview.sample.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-white/10">
                <table className="w-full text-xs">
                  <thead className="bg-neutral-50 text-left text-neutral-500 dark:bg-white/[0.03]">
                    <tr>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Customer</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 text-right font-medium">Fee</th>
                      <th className="px-3 py-2 font-medium">ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-white/[0.05]">
                    {preview.sample.map((p) => (
                      <tr key={p.externalId}>
                        <td className="whitespace-nowrap px-3 py-2">{formatDate(p.paidAt)}</td>
                        <td className="max-w-40 truncate px-3 py-2">{p.name || p.email || p.contact || "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatCurrency(p.amount)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatCurrency(p.feeAmount + p.feeGstAmount)}</td>
                        <td className="max-w-36 truncate px-3 py-2 font-mono text-neutral-500">{p.externalId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={save} loading={busy === "saving"} disabled={busy !== null || preview.count === 0 || preview.missing.length > 0}>
                Import {preview.count} payments
              </Button>
              <Button variant="secondary" onClick={reset} disabled={busy !== null}>
                Choose another file
              </Button>
              {busy === "reading" && <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** What's been uploaded, with the next upload one click away. */
export function UploadedReports({
  gateway,
  stats,
  onUpload,
  onSwitchToApi,
  busy,
}: {
  gateway: string;
  stats: ImportStats;
  onUpload: () => void;
  onSwitchToApi: () => void;
  busy?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200/80 bg-neutral-50/60 px-4 py-3 dark:border-white/[0.07] dark:bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="h-4 w-4 text-neutral-400" />
          <div>
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {stats.count ? `${stats.count.toLocaleString("en-IN")} payments from uploaded reports` : "No report uploaded yet"}
            </p>
            {stats.count > 0 && (
              <p className="text-xs text-neutral-500">
                Newest payment {formatDate(stats.newestPayment!)} · last upload {formatDate(stats.lastImport!)}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={onUpload} disabled={busy}>
            <UploadCloud className="h-3.5 w-3.5" />
            {stats.count ? "Upload a newer report" : "Upload a report"}
          </Button>
        </div>
      </div>
      <p className="text-xs text-neutral-500">
        Payments after the newest one uploaded won&apos;t show in &ldquo;Pick from {gateway}&rdquo; until the next report.{" "}
        <button type="button" onClick={onSwitchToApi} disabled={busy} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
          Use an API key instead
        </button>
      </p>
    </div>
  );
}
