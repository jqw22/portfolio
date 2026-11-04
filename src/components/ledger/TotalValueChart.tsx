import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  compactMoney,
  dayLabel,
  dayTime,
  fullDayLabel,
  monthTicks,
} from "@/lib/chartTime";
import { formatWhole } from "@/lib/portfolio";
import { chartData, localDate, type Snapshot } from "@/lib/snapshots";

interface TotalValueChartProps {
  snapshots: Snapshot[];
  accounts: string[];
  currency: string;
  /** Drop the history before today so the change is measured from today's value. */
  onRestart?: () => void;
}

interface Row {
  time: number;
  date: string;
  total: number;
}

const config: ChartConfig = {
  total: {
    label: "Portfolio value",
    theme: { light: "#2a78d6", dark: "#3987e5" },
  },
};

function signedWhole(value: number, currency: string): string {
  const text = formatWhole(Math.abs(value), currency);
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

function signedPercent(value: number): string {
  const text = `${Math.abs(value).toFixed(1)}%`;
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

function changeClass(value: number): string {
  if (value === 0) return "text-muted-foreground";
  return value > 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-rose-600 dark:text-rose-400";
}

function TotalTooltip({
  active,
  payload,
  first,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Row }>;
  first: number;
  currency: string;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const change = row.total - first;
  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border bg-background px-3 py-2 text-xs shadow-lg">
      <p className="font-medium">{fullDayLabel(row.date)}</p>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Value</span>
        <span className="font-mono tabular-nums text-foreground">
          {formatWhole(row.total, currency)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Since start</span>
        <span className={`font-mono tabular-nums ${changeClass(change)}`}>
          {signedWhole(change, currency)}
        </span>
      </div>
    </div>
  );
}

/** The whole portfolio's value (every account's positions plus cash) over a rolling 3 months. */
export function TotalValueChart({
  snapshots,
  accounts,
  currency,
  onRestart,
}: TotalValueChartProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { rows, domain, ticks } = useMemo(() => {
    const data = chartData(snapshots, currency, accounts, localDate());
    const rows: Row[] = data.rows.map((entry) => ({
      time: dayTime(entry.date),
      date: entry.date,
      total: entry.total,
    }));
    // Half a day of room on the left so the first point isn't clipped by the edge.
    const domain: [number, number] = [
      dayTime(data.start) - 43_200_000,
      dayTime(data.end),
    ];
    return { rows, domain, ticks: monthTicks(data.start, data.end) };
  }, [snapshots, accounts, currency]);

  const first = rows[0];
  const latest = rows.at(-1);
  const change = first && latest ? latest.total - first.total : 0;
  const percent =
    first && first.total !== 0 ? (change / Math.abs(first.total)) * 100 : null;
  const summary =
    first && latest
      ? `Portfolio value from ${fullDayLabel(first.date)} to ${fullDayLabel(latest.date)}: ${formatWhole(
          first.total,
          currency,
        )} to ${formatWhole(latest.total, currency)}.`
      : "";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <CardTitle>Portfolio value</CardTitle>
          {latest ? (
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
              <span className="text-2xl font-semibold tabular-nums text-foreground">
                {formatWhole(latest.total, currency)}
              </span>
              {rows.length > 1 ? (
                <span className={`tabular-nums ${changeClass(change)}`}>
                  {signedWhole(change, currency)}
                  {percent !== null ? ` (${signedPercent(percent)})` : ""}
                  <span className="text-muted-foreground">
                    {" "}
                    since {fullDayLabel(first.date)}
                  </span>
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <CardDescription>
            All accounts together, positions at latest prices plus cash, saved
            once a day when Ledger is open (the last save of the day counts).
            Last 3 months.
          </CardDescription>
          {onRestart && rows.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(true)}
            >
              <RotateCcw />
              Restart from today
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            The first snapshot is saved once your accounts have holdings or
            cash. The chart fills in from there, one point for each day you open
            Ledger.
          </div>
        ) : (
          <ChartContainer
            config={config}
            className="aspect-auto h-72 w-full"
            role="img"
            aria-label={summary}
          >
            <AreaChart
              data={rows}
              margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
            >
              <defs>
                <linearGradient
                  id="total-value-fill"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor="var(--color-total)"
                    stopOpacity={0.25}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--color-total)"
                    stopOpacity={0.02}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="time"
                type="number"
                scale="time"
                domain={domain}
                ticks={ticks}
                allowDataOverflow
                tickFormatter={dayLabel}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(value: number) => compactMoney(value, currency)}
                tickLine={false}
                axisLine={false}
                width={64}
                domain={["auto", "auto"]}
              />
              <ChartTooltip
                content={
                  <TotalTooltip first={first?.total ?? 0} currency={currency} />
                }
              />
              <Area
                dataKey="total"
                name="Portfolio value"
                type="monotone"
                stroke="var(--color-total)"
                strokeWidth={2}
                fill="url(#total-value-fill)"
                baseValue="dataMin"
                dot={
                  rows.length <= 31
                    ? { r: 3, strokeWidth: 2, fill: "var(--background)" }
                    : false
                }
                activeDot={{
                  r: 4,
                  strokeWidth: 2,
                  stroke: "var(--background)",
                }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
      {onRestart ? (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Restart the charts from today?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes every saved day before today, on all your devices,
                for both value charts. Today&apos;s value becomes the starting
                point, and the change is measured from it. Your trades and cash
                aren&apos;t affected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  onRestart();
                  setConfirmOpen(false);
                }}
              >
                Restart
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </Card>
  );
}
