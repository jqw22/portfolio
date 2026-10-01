import { Banknote, ChartLine, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import type { ComponentType } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatCurrency, type PortfolioSummary } from '@/lib/portfolio';
import { totalUnrealised, type ResolvedPrice } from '@/lib/prices';

interface SummaryCardsProps {
  portfolio: PortfolioSummary;
  /** Total cash across all accounts. */
  cashTotal: number;
  /** Number of accounts holding cash entries. */
  cashAccounts: number;
  currency: string;
  /** Latest prices by symbol, in the ledger currency. */
  prices: Record<string, ResolvedPrice | null>;
}

interface SummaryItem {
  label: string;
  value: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
  iconClass: string;
  valueClass?: string;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Open holdings at their latest price; holdings without one count at cost. */
function currentValue(portfolio: PortfolioSummary, prices: Record<string, ResolvedPrice | null>) {
  const total = totalUnrealised(portfolio.openHoldings, prices);
  return {
    value: total.marketValue + (portfolio.totalCostBasis - total.costBasis),
    gain: total.gain,
    priced: total.priced,
    missing: total.missing,
  };
}

export function SummaryCards({ portfolio, cashTotal, cashAccounts, currency, prices }: SummaryCardsProps) {
  const current = currentValue(portfolio, prices);
  const gainSign = current.gain > 0 ? '+' : '';
  const currentHint =
    current.priced === 0
      ? current.missing > 0
        ? 'No prices yet, shown at cost'
        : 'No open positions'
      : current.missing > 0
        ? `${pluralize(current.missing, 'position')} without a price, at cost`
        : `${gainSign}${formatCurrency(current.gain, currency)} unrealised`;
  const realizedPositive = portfolio.totalRealizedPnl >= 0;
  const RealizedIcon = realizedPositive ? TrendingUp : TrendingDown;

  const items: SummaryItem[] = [
    {
      label: 'Cost basis',
      value: formatCurrency(portfolio.totalCostBasis, currency),
      hint: `${pluralize(portfolio.openHoldings.length, 'open position')} held`,
      icon: Wallet,
      iconClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'Current value',
      value: formatCurrency(current.value, currency),
      hint: currentHint,
      icon: ChartLine,
      iconClass: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    },
    {
      label: 'Realised P&L',
      value: formatCurrency(portfolio.totalRealizedPnl, currency),
      hint: `${formatCurrency(portfolio.totalProceeds, currency)} in proceeds`,
      icon: RealizedIcon,
      iconClass: realizedPositive
        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
      valueClass: realizedPositive
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-rose-600 dark:text-rose-400',
    },
    {
      label: 'Cash',
      value: formatCurrency(cashTotal, currency),
      hint: `Across ${pluralize(cashAccounts, 'account')}`,
      icon: Banknote,
      iconClass: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
      valueClass: cashTotal < 0 ? 'text-rose-600 dark:text-rose-400' : undefined,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label} className="gap-0 py-0">
          <CardContent className="flex flex-col gap-4 p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {item.label}
              </span>
              <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', item.iconClass)}>
                <item.icon className="size-4" />
              </span>
            </div>
            <div className="min-w-0">
              <p className={cn('truncate text-2xl font-semibold tracking-tight tabular-nums', item.valueClass)}>
                {item.value}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{item.hint}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
