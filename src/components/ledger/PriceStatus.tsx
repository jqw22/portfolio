import { Children, type ReactNode } from 'react';
import { Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ResolvedPrice } from '@/lib/prices';

/** What the last press of Refresh did, kept so each tab can show it at the bottom. */
export interface PriceRefreshReport {
  /** One-line outcome, e.g. "Updated 12 prices". */
  title: string;
  /** Things that went wrong, one per line. */
  problems: string[];
  /** Other notes, e.g. prices kept because they are recent. */
  notes: string[];
}

interface PriceStatusProps {
  /** The symbols this tab shows prices for. */
  symbols: string[];
  prices: Record<string, ResolvedPrice | null | undefined>;
  names: Map<string, string>;
  report: PriceRefreshReport | null;
  /** Extra lines for this tab, e.g. price history problems on Analysis. */
  children?: ReactNode;
}

function dayChangeGap(price: ResolvedPrice): string {
  return price.source === 'manual' ? 'entered by hand' : 'no previous close';
}

/**
 * Price information for one tab, shown at the bottom of it: what the last
 * Refresh did, its errors, and which stocks have no price or no day change.
 * Renders nothing when there is nothing to say.
 */
export function PriceStatus({ symbols, prices, names, report, children }: PriceStatusProps) {
  const nameOf = (symbol: string) => names.get(symbol) ?? symbol;
  const noPrice = symbols.filter((symbol) => !prices[symbol]).map(nameOf);
  const noRate = symbols.filter((symbol) => prices[symbol]?.price === null).map(nameOf);
  const noDayChange: string[] = [];
  for (const symbol of symbols) {
    const price = prices[symbol];
    if (price && price.price !== null && price.dayChangePercent === null) noDayChange.push(`${nameOf(symbol)} (${dayChangeGap(price)})`);
  }

  const hasMissing = noPrice.length + noRate.length + noDayChange.length > 0;
  if (!report && !hasMissing && Children.toArray(children).length === 0) return null;

  return (
    <section aria-label="Prices" className="space-y-1.5 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      {report ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-foreground">{report.title}</p>
            {report.problems.length > 0 ? (
              <ul className="space-y-0.5 text-amber-700 select-text dark:text-amber-400">
                {report.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
            {report.notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
          {report.problems.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => void navigator.clipboard?.writeText(report.problems.join('\n'))}
            >
              <Copy />
              Copy problems
            </Button>
          ) : null}
        </div>
      ) : null}
      {noPrice.length > 0 ? <p>No price: {noPrice.join(', ')}.</p> : null}
      {noRate.length > 0 ? <p>No exchange rate: {noRate.join(', ')}.</p> : null}
      {noDayChange.length > 0 ? <p>No day change: {noDayChange.join(', ')}.</p> : null}
      {children}
    </section>
  );
}
