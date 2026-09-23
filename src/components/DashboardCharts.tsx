"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactINR, formatCurrencyWhole } from "@/lib/format";

export type SeriesDef = { key: string; label: string; color: string };

function ChartTooltip({
  active,
  payload,
  label,
  series,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number }>;
  label?: string;
  series: SeriesDef[];
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => (p.value ?? 0) > 0);
  const total = rows.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="min-w-44 rounded-xl border border-neutral-200/80 bg-white/95 p-3 text-xs shadow-pop backdrop-blur dark:border-white/10 dark:bg-neutral-900/95">
      <p className="mb-2 font-medium text-neutral-900 dark:text-neutral-100">{label}</p>
      {rows.map((p) => {
        const s = series.find((x) => x.key === p.dataKey);
        return (
          <div key={String(p.dataKey)} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
              <span className="h-2 w-2 rounded-sm" style={{ background: s?.color }} />
              {s?.label ?? p.dataKey}
            </span>
            <span className="tabular-nums text-neutral-900 dark:text-neutral-100">{formatCurrencyWhole(p.value ?? 0)}</span>
          </div>
        );
      })}
      {rows.length > 1 && (
        <div className="mt-1.5 flex justify-between border-t border-neutral-100 pt-1.5 font-medium dark:border-white/10">
          <span className="text-neutral-500">Total</span>
          <span className="tabular-nums text-neutral-900 dark:text-neutral-100">{formatCurrencyWhole(total)}</span>
        </div>
      )}
    </div>
  );
}

/** Money per month, stacked by series (e.g. per venture). */
export function StackedMonthlyChart({
  data,
  series,
  height = 280,
}: {
  data: Array<Record<string, number | string>>;
  series: SeriesDef[];
  height?: number;
}) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} barCategoryGap="28%" margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="currentColor" className="text-neutral-200/70 dark:text-white/[0.06]" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tick={{ fill: "#8a8a8f" }}
            dy={6}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tick={{ fill: "#8a8a8f" }}
            tickFormatter={(v: number) => formatCompactINR(v)}
            width={56}
          />
          <Tooltip cursor={{ fill: "rgba(120,120,140,0.08)", radius: 6 }} content={<ChartTooltip series={series} />} />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              stackId="a"
              fill={s.color}
              radius={i === series.length - 1 ? [5, 5, 0, 0] : [0, 0, 0, 0]}
              maxBarSize={36}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const FLOW_SERIES: SeriesDef[] = [
  { key: "in", label: "Money in (after fees)", color: "#10b981" },
  { key: "out", label: "Money out", color: "#f43f5e" },
  { key: "profit", label: "Profit", color: "#6a6cf0" },
];

function FlowTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string | number; value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-44 rounded-xl border border-neutral-200/80 bg-white/95 p-3 text-xs shadow-pop backdrop-blur dark:border-white/10 dark:bg-neutral-900/95">
      <p className="mb-2 font-medium text-neutral-900 dark:text-neutral-100">{label}</p>
      {FLOW_SERIES.map((s) => {
        const v = payload.find((p) => p.dataKey === s.key)?.value ?? 0;
        return (
          <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-1.5 text-neutral-500 dark:text-neutral-400">
              <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="tabular-nums text-neutral-900 dark:text-neutral-100">{formatCurrencyWhole(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Money in vs money out per month, side by side, with profit drawn across them. */
export function MoneyFlowChart({
  data,
  height = 260,
}: {
  data: Array<{ label: string; in: number; out: number; profit: number }>;
  height?: number;
}) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1">
        {FLOW_SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <span className={s.key === "profit" ? "h-0.5 w-3 rounded" : "h-2 w-2 rounded-sm"} style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} barCategoryGap="24%" barGap={3} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
          <CartesianGrid vertical={false} stroke="currentColor" className="text-neutral-200/70 dark:text-white/[0.06]" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} tick={{ fill: "#8a8a8f" }} dy={6} />
          <YAxis
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tick={{ fill: "#8a8a8f" }}
            tickFormatter={(v: number) => formatCompactINR(v)}
            width={56}
          />
          <Tooltip cursor={{ fill: "rgba(120,120,140,0.08)", radius: 6 }} content={<FlowTooltip />} />
          <Bar dataKey="in" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="out" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Line type="monotone" dataKey="profit" stroke="#6a6cf0" strokeWidth={2} dot={{ r: 2.5, fill: "#6a6cf0" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

const DONUT_COLORS = ["#6a6cf0", "#10b981", "#f59e0b", "#0ea5e9", "#f43f5e", "#a855f7", "#84cc16", "#94a3b8"];

/** Share of a total, with the legend listing each slice's amount and %. */
export function DonutBreakdown({ data, centerLabel }: { data: { name: string; value: number }[]; centerLabel: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  // Keep the chart legible: the long tail collapses into "Other".
  const top = data.slice(0, 6);
  const rest = data.slice(6).reduce((s, d) => s + d.value, 0);
  const slices = rest > 0 ? [...top, { name: "Other", value: rest }] : top;

  return (
    <div className="@container">
    <div className="flex flex-col items-center gap-6 @md:flex-row">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="70%"
              outerRadius="100%"
              paddingAngle={slices.length > 1 ? 2 : 0}
              stroke="none"
              isAnimationActive={false}
            >
              {slices.map((entry, i) => (
                <Cell key={entry.name} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[11px] text-neutral-500 dark:text-neutral-400">{centerLabel}</span>
          <span className="text-base font-semibold tabular-nums text-neutral-900 dark:text-white">
            {formatCompactINR(total)}
          </span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-2">
        {slices.map((s, i) => (
          <li key={s.name} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
            <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-300">{s.name}</span>
            <span className="tabular-nums text-neutral-900 dark:text-neutral-100">{formatCompactINR(s.value)}</span>
            <span className="w-10 text-right text-xs tabular-nums text-neutral-400">
              {total > 0 ? Math.round((s.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
    </div>
  );
}
