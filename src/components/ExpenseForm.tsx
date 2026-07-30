"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Receipt, Upload } from "lucide-react";
import { calculateBreakup } from "@/lib/calc";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";

type Company = {
  id: string;
  name: string;
  defaultGstPercent: number;
  gateways: { id: string; name: string; chargePercent: number }[];
  categories: { id: string; name: string }[];
};

type ExistingExpense = {
  id: string;
  companyId: string;
  categoryId: string;
  gatewayId: string | null;
  description: string | null;
  date: string;
  grossAmount: number;
  gstPercent: number;
  screenshotPath: string | null;
};

export function ExpenseForm({
  companies,
  expense,
}: {
  companies: Company[];
  expense?: ExistingExpense;
}) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = !!expense;

  const [companyId, setCompanyId] = useState(expense?.companyId ?? companies[0]?.id ?? "");
  const company = companies.find((c) => c.id === companyId);

  const [gatewayId, setGatewayId] = useState<string>(expense?.gatewayId ?? "");
  const [grossAmount, setGrossAmount] = useState<string>(
    expense ? String(expense.grossAmount) : ""
  );
  const [gstPercent, setGstPercent] = useState<string>(
    String(expense?.gstPercent ?? company?.defaultGstPercent ?? 18)
  );
  const [pending, setPending] = useState(false);

  const gateway = company?.gateways.find((g) => g.id === gatewayId);
  const gatewayChargePercent = gateway?.chargePercent ?? 0;

  const breakup = calculateBreakup({
    grossAmount: Number(grossAmount) || 0,
    gatewayChargePercent,
    gstPercent: Number(gstPercent) || 0,
  });

  function onCompanyChange(id: string) {
    setCompanyId(id);
    setGatewayId("");
    const next = companies.find((c) => c.id === id);
    setGstPercent(String(next?.defaultGstPercent ?? 18));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const formData = new FormData(e.currentTarget);
      const url = isEdit ? `/api/expenses/${expense.id}` : "/api/expenses";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, { method, body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Something went wrong");
        return;
      }
      toast.success(isEdit ? "Expense updated" : "Expense added");
      router.push("/expenses");
      router.refresh();
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setPending(false);
    }
  }

  if (companies.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        No companies available. Ask an admin to add one first.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-2xl gap-6">
      <Card>
        <CardBody className="grid gap-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Company
            </label>
            <select
              name="companyId"
              value={companyId}
              disabled={isEdit}
              onChange={(e) => onCompanyChange(e.target.value)}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-950 dark:disabled:bg-neutral-900"
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Category
              </label>
              <select
                name="categoryId"
                required
                defaultValue={expense?.categoryId}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-950"
              >
                {company?.categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Date
              </label>
              <input
                name="date"
                type="date"
                required
                defaultValue={expense?.date ?? new Date().toISOString().slice(0, 10)}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-950"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Gross amount paid
              </label>
              <input
                name="grossAmount"
                type="number"
                step="0.01"
                min="0"
                required
                value={grossAmount}
                onChange={(e) => setGrossAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-950"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Payment gateway
              </label>
              <select
                name="gatewayId"
                value={gatewayId}
                onChange={(e) => setGatewayId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-950"
              >
                <option value="">None</option>
                {company?.gateways.map((gw) => (
                  <option key={gw.id} value={gw.id}>
                    {gw.name} ({gw.chargePercent}%)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                GST %
              </label>
              <input
                name="gstPercent"
                type="number"
                step="0.01"
                min="0"
                value={gstPercent}
                onChange={(e) => setGstPercent(e.target.value)}
                className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-950"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Screenshot (proof of payment)
              </label>
              <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 hover:border-indigo-400 hover:text-indigo-600 dark:border-neutral-700 dark:text-neutral-400">
                <Upload className="h-4 w-4" />
                {expense?.screenshotPath ? "Replace file" : "Choose file"}
                <input name="screenshot" type="file" accept="image/*,.pdf" className="hidden" />
              </label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Description (optional)
            </label>
            <input
              name="description"
              type="text"
              defaultValue={expense?.description ?? ""}
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-950"
            />
          </div>
        </CardBody>
      </Card>

      <Card className="border-indigo-100 dark:border-indigo-950">
        <CardBody>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            <Receipt className="h-4 w-4 text-indigo-500" />
            Breakup preview
          </h3>
          <dl className="grid grid-cols-2 gap-y-2 text-sm text-neutral-600 dark:text-neutral-400">
            <dt>Gross amount</dt>
            <dd className="text-right tabular-nums">{formatCurrency(Number(grossAmount) || 0)}</dd>
            <dt>Gateway charge ({gatewayChargePercent}%)</dt>
            <dd className="text-right tabular-nums text-amber-600 dark:text-amber-400">
              − {formatCurrency(breakup.gatewayChargeAmount)}
            </dd>
            <dt>After gateway</dt>
            <dd className="text-right tabular-nums">{formatCurrency(breakup.afterGatewayAmount)}</dd>
            <dt>GST ({gstPercent || 0}%)</dt>
            <dd className="text-right tabular-nums text-amber-600 dark:text-amber-400">
              − {formatCurrency(breakup.gstAmount)}
            </dd>
            <dt className="border-t border-neutral-100 pt-2 font-semibold text-neutral-900 dark:border-neutral-800 dark:text-neutral-100">
              Net revenue
            </dt>
            <dd className="border-t border-neutral-100 pt-2 text-right tabular-nums font-semibold text-emerald-600 dark:border-neutral-800 dark:text-emerald-400">
              {formatCurrency(breakup.netAmount)}
            </dd>
          </dl>
        </CardBody>
      </Card>

      <div className="flex items-center gap-2">
        <Button type="submit" loading={pending}>
          {isEdit ? "Save changes" : "Save expense"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.push("/expenses")}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
