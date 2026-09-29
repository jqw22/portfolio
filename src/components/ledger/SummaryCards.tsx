import { Coins, Landmark, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import type { ComponentType } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatCurrency, type PortfolioSummary } from '@/lib/portfolio';

interface SummaryCardsProps {
  portfolio: PortfolioSummary;
  currency: string;
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

export function SummaryCards({ portfolio, currency }: SummaryCardsProps) {
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
      label: 'Total invested',
      value: formatCurrency(portfolio.totalInvested, currency),
      hint: `${formatCurrency(portfolio.totalFees, currency)} paid in fees`,
      icon: Landmark,
      iconClass: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    },
    {
      label: 'Realized P&L',
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
      label: 'Transactions',
      value: portfolio.transactionCount.toLocaleString(),
      hint: `${pluralize(portfolio.symbols.length, 'symbol')} tracked`,
      icon: Coins,
      iconClass: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
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
