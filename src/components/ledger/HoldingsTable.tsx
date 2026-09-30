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
import { formatCurrency, formatQuantity, type Holding } from '@/lib/portfolio';

interface HoldingsTableProps {
  holdings: Holding[];
  currency: string;
  title: string;
  description?: string;
  showFooter?: boolean;
  /** Cash rows to list after the positions, one per account; included in the total. */
  cashBalances?: CashBalance[];
}

export function HoldingsTable({
  holdings,
  currency,
  title,
  description,
  showFooter = false,
  cashBalances = [],
}: HoldingsTableProps) {
  const totalCash = cashBalances.reduce((sum, cash) => sum + cash.balance, 0);
  const totalCostBasis = holdings.reduce((sum, holding) => sum + holding.costBasis, 0) + totalCash;
  const totalRealized = holdings.reduce((sum, holding) => sum + holding.realizedPnl, 0);

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b pb-5">
        <CardTitle className="flex items-center gap-2 text-base">
          {title}
          <Badge variant="secondary">{holdings.length}</Badge>
        </CardTitle>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
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
              <TableHead className="text-right">Cost basis</TableHead>
              <TableHead className="pr-6 text-right">Realized P&L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {holdings.map((holding) => {
              const isOpen = holding.quantity > 0;
              const positive = holding.realizedPnl >= 0;
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
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(holding.costBasis, currency)}
                  </TableCell>
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
                <TableCell
                  className={cn('text-right font-medium tabular-nums', cash.balance < 0 && 'text-destructive')}
                >
                  {formatCurrency(cash.balance, currency)}
                </TableCell>
                <TableCell className="pr-6 text-right text-muted-foreground">—</TableCell>
              </TableRow>
            ))}
          </TableBody>
          {showFooter ? (
            <TableFooter>
              <TableRow className="hover:bg-transparent">
                <TableCell className="pl-6" colSpan={5}>
                  {cashBalances.length > 0 ? 'Total including cash' : 'Total'}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatCurrency(totalCostBasis, currency)}
                </TableCell>
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
