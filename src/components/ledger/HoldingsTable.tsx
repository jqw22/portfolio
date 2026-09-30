import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LabelBadge } from '@/components/ledger/LabelBadge';
import { cn } from '@/lib/utils';
import type { CashBalance } from '@/lib/cash';
import { formatCurrency, formatDate, formatPercent, formatQuantity, type Holding } from '@/lib/portfolio';
import { isPence, totalUnrealised, unrealisedGain, type ResolvedPrice } from '@/lib/prices';

interface HoldingsTableProps {
  holdings: Holding[];
  currency: string;
  title: string;
  description?: string;
  showFooter?: boolean;
  /** Cash rows to list after the positions, one per account; included in the total. */
  cashBalances?: CashBalance[];
  /** Latest prices by symbol. When given, the Latest price and Unrealised columns are shown. */
  prices?: Record<string, ResolvedPrice | null>;
  /** Controls shown on the right of the card header. */
  actions?: ReactNode;
}

function pnlClass(value: number): string {
  if (value === 0) return 'text-muted-foreground';
  return value > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
}

/** A quoted price in its own currency, e.g. `$182.40` or `245.3p`. */
function formatNativePrice(value: number, currency: string): string {
  if (isPence(currency)) {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}p`;
  }
  return formatCurrency(value, currency, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

/** When a price is from: a date for daily quotes, a time for today's intraday ones. */
function formatAsOf(asOf: string): string {
  if (!asOf) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return formatDate(asOf);
  const date = new Date(asOf);
  if (Number.isNaN(date.getTime())) return asOf;
  if (date.toDateString() === new Date().toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date);
}

function priceTitle(price: ResolvedPrice): string {
  const quoted = formatNativePrice(price.nativePrice, price.nativeCurrency);
  const when = price.updatedAt ? new Date(price.updatedAt).toLocaleString() : 'unknown';
  return price.source === 'manual' ? `Entered by hand as ${quoted} on ${when}` : `Quoted ${quoted}, fetched ${when}`;
}

function LatestPriceCell({ price, currency }: { price: ResolvedPrice | null | undefined; currency: string }) {
  if (!price) {
    return <span className="text-muted-foreground">No price</span>;
  }
  const showNative = price.price === null || price.nativeCurrency.toUpperCase() !== currency.toUpperCase();
  const when = formatAsOf(price.asOf);
  return (
    <div title={priceTitle(price)}>
      <span className="font-medium">
        {price.price === null ? formatNativePrice(price.nativePrice, price.nativeCurrency) : formatCurrency(price.price, currency)}
      </span>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {price.price === null
          ? `No ${currency} rate`
          : [showNative ? formatNativePrice(price.nativePrice, price.nativeCurrency) : null, price.source === 'manual' ? 'Manual' : null, when]
              .filter(Boolean)
              .join(' · ')}
      </p>
    </div>
  );
}

export function HoldingsTable({
  holdings,
  currency,
  title,
  description,
  showFooter = false,
  cashBalances = [],
  prices,
  actions,
}: HoldingsTableProps) {
  const showMarket = prices !== undefined;
  const unrealisedTotal = prices ? totalUnrealised(holdings, prices) : null;
  const totalCash = cashBalances.reduce((sum, cash) => sum + cash.balance, 0);
  const totalCostBasis = holdings.reduce((sum, holding) => sum + holding.costBasis, 0) + totalCash;
  const totalRealized = holdings.reduce((sum, holding) => sum + holding.realizedPnl, 0);

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              {title}
              <Badge variant="secondary">{holdings.length}</Badge>
            </CardTitle>
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-6">Account</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Label</TableHead>
              <TableHead className="text-right">Shares</TableHead>
              <TableHead className="text-right">Avg cost</TableHead>
              {showMarket ? <TableHead className="text-right">Latest price</TableHead> : null}
              <TableHead className="text-right">Cost basis</TableHead>
              {showMarket ? <TableHead className="text-right">Unrealised</TableHead> : null}
              <TableHead className="pr-6 text-right">Realized P&L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {holdings.map((holding) => {
              const isOpen = holding.quantity > 0;
              const positive = holding.realizedPnl >= 0;
              const price = prices?.[holding.symbol];
              const unrealised = isOpen ? unrealisedGain(holding, price?.price) : null;
              return (
                <TableRow key={holding.key}>
                  <TableCell className="pl-6">
                    {holding.account ? (
                      <span className="block max-w-[10rem] truncate font-medium">{holding.account}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{holding.symbol}</span>
                      {!isOpen ? (
                        <Badge variant="outline" className="text-[0.65rem]">
                          Closed
                        </Badge>
                      ) : null}
                    </div>
                    {holding.name ? (
                      <p className="mt-0.5 max-w-[16rem] truncate text-xs text-muted-foreground">{holding.name}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {holding.labels.length > 0 ? (
                      <div className="flex max-w-[18rem] flex-wrap gap-1">
                        {holding.labels.map((label) => (
                          <LabelBadge key={label} label={label} />
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {isOpen ? formatQuantity(holding.quantity) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {isOpen ? formatCurrency(holding.averageCost, currency) : '—'}
                  </TableCell>
                  {showMarket ? (
                    <TableCell className="text-right tabular-nums">
                      {isOpen ? <LatestPriceCell price={price} currency={currency} /> : '—'}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(holding.costBasis, currency)}
                  </TableCell>
                  {showMarket ? (
                    <TableCell className="text-right tabular-nums">
                      {unrealised ? (
                        <div className={pnlClass(unrealised.gain)}>
                          <span className="font-medium">{formatCurrency(unrealised.gain, currency)}</span>
                          {unrealised.percent !== null ? (
                            <p className="mt-0.5 text-xs">{formatPercent(unrealised.percent)}</p>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  ) : null}
                  <TableCell className="pr-6 text-right tabular-nums">
                    <span
                      className={cn(
                        'font-medium',
                        holding.realizedPnl === 0
                          ? 'text-muted-foreground'
                          : positive
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400',
                      )}
                    >
                      {holding.realizedPnl === 0 ? '—' : formatCurrency(holding.realizedPnl, currency)}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
            {cashBalances.map((cash) => (
              <TableRow key={`cash:${cash.account ?? ''}`} className="bg-muted/30">
                <TableCell className="pl-6">
                  {cash.account ? (
                    <span className="block max-w-[10rem] truncate font-medium">{cash.account}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="font-semibold">Cash</span>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground">—</span>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">—</TableCell>
                <TableCell className="text-right text-muted-foreground">—</TableCell>
                {showMarket ? <TableCell className="text-right text-muted-foreground">—</TableCell> : null}
                <TableCell
                  className={cn('text-right font-medium tabular-nums', cash.balance < 0 && 'text-destructive')}
                >
                  {formatCurrency(cash.balance, currency)}
                </TableCell>
                {showMarket ? <TableCell className="text-right text-muted-foreground">—</TableCell> : null}
                <TableCell className="pr-6 text-right text-muted-foreground">—</TableCell>
              </TableRow>
            ))}
          </TableBody>
          {showFooter ? (
            <TableFooter>
              <TableRow className="hover:bg-transparent">
                <TableCell className="pl-6" colSpan={showMarket ? 6 : 5}>
                  {cashBalances.length > 0 ? 'Total including cash' : 'Total'}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatCurrency(totalCostBasis, currency)}
                </TableCell>
                {unrealisedTotal ? (
                  <TableCell className="text-right tabular-nums">
                    {unrealisedTotal.priced > 0 ? (
                      <span className={cn('font-semibold', pnlClass(unrealisedTotal.gain))}>
                        {formatCurrency(unrealisedTotal.gain, currency)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {unrealisedTotal.missing > 0 ? (
                      <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                        {unrealisedTotal.missing} without a price
                      </p>
                    ) : null}
                  </TableCell>
                ) : null}
                <TableCell
                  className={cn(
                    'pr-6 text-right font-semibold tabular-nums',
                    totalRealized >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400',
                  )}
                >
                  {formatCurrency(totalRealized, currency)}
                </TableCell>
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </CardContent>
    </Card>
  );
}
