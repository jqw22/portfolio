import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatCurrency, type Holding } from '@/lib/portfolio';

const BAR_COLORS = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'];

interface AllocationBarsProps {
  holdings: Holding[];
  currency: string;
  className?: string;
}

export function AllocationBars({ holdings, currency, className }: AllocationBarsProps) {
  const total = holdings.reduce((sum, holding) => sum + holding.costBasis, 0);

  return (
    <Card className={cn('gap-0 py-0', className)}>
      <CardHeader className="border-b pb-5">
        <CardTitle className="text-base">Allocation</CardTitle>
        <CardDescription>Share of open cost basis by symbol</CardDescription>
      </CardHeader>
      <CardContent className="p-5">
        {holdings.length === 0 || total <= 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No open positions to chart yet.
          </p>
        ) : (
          <ul className="space-y-4">
            {holdings.map((holding, index) => {
              const share = (holding.costBasis / total) * 100;
              return (
                <li key={holding.symbol}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{holding.symbol}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {share.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full transition-all', BAR_COLORS[index % BAR_COLORS.length])}
                      style={{ width: `${Math.max(share, 1.5)}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                    {formatCurrency(holding.costBasis, currency)}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
