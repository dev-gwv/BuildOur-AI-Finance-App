"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Field";
import { formatCurrency, formatDate } from "@/lib/format";

/** A payment as a gateway integration returns it (rupees). */
export type GatewayPayment = {
  id: string;
  status: string;
  amount: number;
  feeAmount: number;
  feeGstAmount: number;
  method: string | null;
  paidOn: string;
  createdAt?: string;
  email: string | null;
  contact: string | null;
  vpa: string | null;
  /** Customer's name, when the gateway knows it. */
  name?: string | null;
  description?: string | null;
  recordedOn: { id: string; invoiceNumber: string } | null;
};

const PERIODS = [7, 14, 30, 60] as const;

const chip = (active: boolean) =>
  `whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
    active
      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
      : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
  }`;

/** What a search can match on: who paid, how, the gateway's id, and the amount. */
function haystack(p: GatewayPayment): string {
  return [p.name, p.email, p.contact, p.vpa, p.description, p.id, p.method, String(p.amount), formatCurrency(p.amount)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Lists a gateway's recent payments to record one against an invoice:
 * searchable (name, email, phone, UPI id, payment id or amount) and filtered by
 * period, payment method and whether it's already been recorded. Shared by
 * every gateway integration, so each lists and picks the same way.
 */
export function GatewayPicker({
  open,
  onClose,
  gateway,
  endpoint,
  onPick,
  currentRef,
}: {
  open: boolean;
  onClose: () => void;
  /** "Razorpay", "TagMango"… */
  gateway: string;
  /** GET `${endpoint}?recent=1&days=N` → `{ payments }` or `{ error }`. */
  endpoint: string;
  onPick: (p: GatewayPayment) => void;
  /** The payment being edited may keep its own gateway payment. */
  currentRef?: string | null;
}) {
  const [days, setDays] = useState<number>(14);
  const [query, setQuery] = useState("");
  const [method, setMethod] = useState("all");
  const [showRecorded, setShowRecorded] = useState(false);
  /** The last answer, for the period it was asked for: payments or an error. */
  const [loaded, setLoaded] = useState<{ days: number; payments?: GatewayPayment[]; error?: string; newest?: string | null } | null>(null);

  useEffect(() => {
    if (!open || loaded?.days === days) return;
    let cancelled = false;
    fetch(`${endpoint}?recent=1&days=${days}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        setLoaded(
          res.ok
            ? { days, payments: data.payments ?? [], newest: data.source === "file" ? (data.newest ?? null) : undefined }
            : { days, error: data.error ?? `Couldn't load payments from ${gateway}` }
        );
      })
      .catch(() => !cancelled && setLoaded({ days, error: `Couldn't reach ${gateway} — check your connection` }));
    return () => {
      cancelled = true;
    };
  }, [open, days, endpoint, gateway, loaded?.days]);

  const current = loaded?.days === days ? loaded : null;
  const error = current?.error ?? null;
  const payments = useMemo(() => current?.payments ?? null, [current]);
  const methods = useMemo(() => [...new Set((payments ?? []).map((p) => p.method).filter((m): m is string => !!m))].sort(), [payments]);

  const taken = (p: GatewayPayment) => Boolean(p.recordedOn) && currentRef !== p.id;
  const visible = useMemo(() => {
    if (!payments) return [];
    const q = query.trim().toLowerCase();
    // "4,999" and "4999" are the same search.
    const qDigits = q.replace(/[,₹\s]/g, "");
    return payments.filter((p) => {
      if (method !== "all" && p.method !== method) return false;
      if (!showRecorded && taken(p)) return false;
      if (!q) return true;
      const text = haystack(p);
      return text.includes(q) || (/^\d+(\.\d+)?$/.test(qDigits) && String(p.amount).startsWith(qDigits));
    });
    // taken() reads currentRef, which is a prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, query, method, showRecorded, currentRef]);
  const hiddenRecorded = payments ? payments.filter(taken).length : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Pick a ${gateway} payment`}
      description="Picking one fills in its exact amount, date and fee."
    >
      <div className="space-y-3">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, phone, UPI ID, payment ID or amount"
          leading={<Search className="h-3.5 w-3.5" />}
          aria-label={`Search ${gateway} payments`}
          autoFocus
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Period">
            {PERIODS.map((d) => (
              <button key={d} type="button" className={chip(days === d)} aria-pressed={days === d} onClick={() => setDays(d)}>
                {d} days
              </button>
            ))}
          </div>
          {methods.length > 1 && (
            <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Payment method">
              <button type="button" className={chip(method === "all")} aria-pressed={method === "all"} onClick={() => setMethod("all")}>
                Any method
              </button>
              {methods.map((m) => (
                <button key={m} type="button" className={chip(method === m)} aria-pressed={method === m} onClick={() => setMethod(m)}>
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
            <input type="checkbox" checked={showRecorded} onChange={(e) => setShowRecorded(e.target.checked)} />
            Show already recorded{hiddenRecorded > 0 && !showRecorded ? ` (${hiddenRecorded})` : ""}
          </label>
        </div>

        <div className="-mx-2 max-h-[55vh] overflow-y-auto">
          {error ? (
            <p className="px-3 py-3 text-xs text-red-600 dark:text-red-400">{error}</p>
          ) : payments === null ? (
            <p className="flex items-center gap-2 px-3 py-3 text-xs text-neutral-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading the last {days} days from {gateway}…
            </p>
          ) : visible.length === 0 ? (
            <p className="px-3 py-3 text-xs text-neutral-500">
              {payments.length === 0
                ? `No completed ${gateway} payments in the last ${days} days.`
                : "Nothing matches — try another search, method or a longer period."}
            </p>
          ) : (
            visible.map((p) => {
              const isTaken = taken(p);
              const who = p.name || p.email || p.vpa || p.contact || p.id;
              const time = p.createdAt
                ? new Date(p.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
                : null;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={isTaken}
                  onClick={() => onPick(p)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:hover:bg-white/[0.06]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{who}</span>
                    <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {formatDate(p.paidOn)}
                      {time && ` ${time}`}
                      {p.method && ` · ${p.method.toUpperCase()}`}
                      {[p.contact, p.email].filter((x) => x && x !== who).map((x) => ` · ${x}`)}
                      {isTaken ? ` · on ${p.recordedOn!.invoiceNumber}` : ` · ${p.id}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{formatCurrency(p.amount)}</span>
                    {p.feeAmount + p.feeGstAmount > 0 && (
                      <span className="block text-[11px] tabular-nums text-amber-700 dark:text-amber-400">
                        fee {formatCurrency(Math.round((p.feeAmount + p.feeGstAmount) * 100) / 100)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
        {payments && payments.length > 0 && (
          <p className="text-[11px] text-neutral-500">
            Showing {visible.length} of {payments.length} from the last {days} days.
          </p>
        )}
        {current?.newest !== undefined && (
          <p className="text-[11px] text-neutral-500">
            From uploaded {gateway} reports
            {current.newest ? ` — newest payment ${formatDate(current.newest)}` : " — none uploaded yet"}. Later payments show once a newer report is
            uploaded in Settings → Integrations.
          </p>
        )}
      </div>
    </Modal>
  );
}
