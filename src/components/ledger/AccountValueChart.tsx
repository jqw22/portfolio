import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { formatCurrency, formatWhole } from '@/lib/portfolio';
import { chartData, localDate, type Snapshot } from '@/lib/snapshots';

/**
 * Categorical colours in fixed order, one per account, stepped separately for
 * light and dark (validated for colour-blind separation on both surfaces).
 */
const SERIES_COLOURS = [
  { light: '#2a78d6', dark: '#3987e5' },
  { light: '#eb6834', dark: '#d95926' },
  { light: '#1baf7a', dark: '#199e70' },
  { light: '#eda100', dark: '#c98500' },
  { light: '#e87ba4', dark: '#d55181' },
  { light: '#008300', dark: '#008300' },
  { light: '#6250d6', dark: '#9085e9' },
  { light: '#e34948', dark: '#e66767' },
];
const MAX_SERIES = SERIES_COLOURS.length;

interface AccountValueChartProps {
  snapshots: Snapshot[];
  /** The ledger's accounts, in order; they keep their colour as accounts come and go. */
  accounts: string[];
  currency: string;
}

interface Row {
  time: number;
  date: string;
  total: number;
  [key: string]: number | string | null;
}

function dayLabel(time: number): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(time));
}

function fullDayLabel(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${date}T00:00:00`),
  );
}

function compactMoney(value: number, currency: string): string {
  return formatCurrency(value, currency, { notation: 'compact', maximumFractionDigits: 1 });
}

interface TooltipEntry {
  dataKey?: string | number | ((row: Row) => unknown);
  value?: number | string | null;
  color?: string;
  payload?: Row;
}

function SnapshotTooltip({
  active,
  payload,
  names,
  currency,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  names: Record<string, string>;
  currency: string;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border bg-background px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{fullDayLabel(row.date)}</p>
      {payload
        ?.filter((entry) => typeof entry.value === 'number')
        .map((entry) => (
          <div key={String(entry.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: entry.color }} />
              {names[String(entry.dataKey)]}
            </span>
            <span className="font-mono tabular-nums text-foreground">{formatWhole(Number(entry.value), currency)}</span>
          </div>
        ))}
      {payload && payload.length > 1 ? (
        <div className="flex items-center justify-between gap-4 border-t pt-1.5 font-medium">
          <span>Total</span>
          <span className="font-mono tabular-nums">{formatWhole(row.total, currency)}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Each account's value over the last 12 months, from the daily snapshots. */
export function AccountValueChart({ snapshots, accounts, currency }: AccountValueChartProps) {
  const { rows, series, config } = useMemo(() => {
    const data = chartData(snapshots, currency, accounts, localDate());
    // More accounts than colours: keep the first ones and fold the rest into "Other".
    const folded = data.accounts.length > MAX_SERIES;
    const kept = folded ? data.accounts.slice(0, MAX_SERIES - 1) : data.accounts;
    const names = folded ? [...kept, 'Other'] : kept;
    const series = names.map((name, index) => ({ key: `a${index}`, name }));
    const rows: Row[] = data.rows.map((entry) => {
      const row: Row = { time: new Date(`${entry.date}T00:00:00`).getTime(), date: entry.date, total: entry.total };
      kept.forEach((_, index) => {
        row[`a${index}`] = entry.values[index];
      });
      if (folded) {
        const rest = entry.values.slice(kept.length).filter((value): value is number => value !== null);
        row[`a${kept.length}`] = rest.length > 0 ? rest.reduce((sum, value) => sum + value, 0) : null;
      }
      return row;
    });
    const config: ChartConfig = Object.fromEntries(
      series.map(({ key, name }, index) => [key, { label: name, theme: SERIES_COLOURS[index] }]),
    );
    return { rows, series, config };
  }, [snapshots, accounts, currency]);

  const names = Object.fromEntries(series.map(({ key, name }) => [key, name]));
  const latest = rows.at(-1);
  const summary = latest
    ? `Account values from ${fullDayLabel(rows[0].date)} to ${fullDayLabel(latest.date)}. Latest: ${series
        .map(({ key, name }) => (typeof latest[key] === 'number' ? `${name} ${formatWhole(Number(latest[key]), currency)}` : null))
        .filter(Boolean)
        .join(', ')}.`
    : '';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <CardTitle>Account values</CardTitle>
          {latest ? (
            <p className="text-sm text-muted-foreground">
              Total <span className="font-semibold tabular-nums text-foreground">{formatWhole(latest.total, currency)}</span>
            </p>
          ) : null}
        </div>
        <CardDescription>
          Each account's positions at latest prices plus cash, saved once a day when Ledger is open. Last 12 months.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            The first snapshot is saved once your accounts have holdings or cash. The chart fills in from there, one
            point for each day you open Ledger.
          </div>
        ) : (
          <ChartContainer config={config} className="aspect-auto h-72 w-full" role="img" aria-label={summary}>
            <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={rows.length === 1 ? [rows[0].time - 86_400_000, rows[0].time + 86_400_000] : ['dataMin', 'dataMax']}
                tickFormatter={dayLabel}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={40}
              />
              <YAxis
                tickFormatter={(value: number) => compactMoney(value, currency)}
                tickLine={false}
                axisLine={false}
                width={64}
                domain={['auto', 'auto']}
              />
              <ChartTooltip content={<SnapshotTooltip names={names} currency={currency} />} />
              {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} itemSorter="dataKey" /> : null}
              {series.map(({ key, name }) => (
                <Line
                  key={key}
                  dataKey={key}
                  name={name}
                  type="monotone"
                  stroke={`var(--color-${key})`}
                  strokeWidth={2}
                  dot={rows.length <= 1 ? { r: 4, strokeWidth: 2, fill: 'var(--background)' } : false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)' }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
