import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Eye, Plus, Trash2 } from 'lucide-react';

import { SortableHead } from '@/components/ledger/HoldingsTable';
import { LabelPicker } from '@/components/ledger/LabelPicker';
import { missingDayChangeReason, pnlClass } from '@/components/ledger/marketText';
import { StockNoteButton } from '@/components/ledger/StockNoteButton';
import { YahooLinkButton } from '@/components/ledger/YahooLinkButton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ResolvedPrice } from '@/lib/prices';
import { cn } from '@/lib/utils';
import { formatCurrency, formatPercent, parseNumber, sortWatchlist, type HoldingSort, type WatchItem } from '@/lib/portfolio';

interface WatchlistTableProps {
  items: WatchItem[];
  currency: string;
  prices: Record<string, ResolvedPrice | null>;
  /** Symbols currently held in any account, to mark them on the list. */
  heldSymbols: ReadonlySet<string>;
  /** Names already used on trades, by upper-cased symbol, to fill in the name. */
  knownNames: ReadonlyMap<string, string>;
  stockNotes: Record<string, string>;
  onNoteChange: (symbol: string, note: string) => void;
  quoteUrlFor: (symbol: string) => string;
  onAdd: (symbol: string, name?: string) => void;
  onRemove: (item: WatchItem) => void;
  /** Set or clear a trigger price. */
  onTriggerChange: (symbol: string, triggerPrice: number | undefined) => void;
  /** Labels for watched stocks. */
  labels: string[];
  onLabelChange: (symbol: string, label: string | undefined) => void;
  onCreateLabel: (label: string) => string | undefined;
  onDeleteLabel: (label: string) => void;
  sort: HoldingSort;
  onSortChange: (sort: HoldingSort) => void;
}

function displayName(item: WatchItem): string {
  return item.name?.trim() || item.symbol;
}

/** The latest price on its own; hover shows the quote and when it was fetched. */
function PriceCell({ price, currency }: { price: ResolvedPrice | null | undefined; currency: string }) {
  if (!price) return <span className="text-muted-foreground">No price</span>;
  const when = price.updatedAt ? new Date(price.updatedAt).toLocaleString() : 'unknown';
  const title = price.source === 'manual' ? `Entered by hand on ${when}` : `Fetched ${when}`;
  if (price.price === null) {
    return (
      <span className="text-muted-foreground" title={`No ${currency} exchange rate. ${title}`}>
        No {currency} rate
      </span>
    );
  }
  return (
    <span className="font-medium" title={title}>
      {formatCurrency(price.price, currency)}
    </span>
  );
}

/** Change in price per share since the previous close, in the ledger currency. */
function perShareChange(price: ResolvedPrice | null | undefined): number | null {
  const percent = price?.dayChangePercent ?? null;
  if (percent === null || price?.price == null) return null;
  return price.price - price.price / (1 + percent / 100);
}

function MissingDayChange({ price }: { price: ResolvedPrice | null | undefined }) {
  return (
    <span className="text-muted-foreground" title={missingDayChangeReason(price)}>
      —
    </span>
  );
}

/** Day change per share in pounds. */
function DayChangeValueCell({ price, currency }: { price: ResolvedPrice | null | undefined; currency: string }) {
  const change = perShareChange(price);
  if (change === null) return <MissingDayChange price={price} />;
  return (
    <span className={cn('font-medium', pnlClass(change))}>
      {change > 0 ? '+' : ''}
      {formatCurrency(change, currency)}
    </span>
  );
}

/** Day change as a percentage. */
function DayChangePercentCell({ price }: { price: ResolvedPrice | null | undefined }) {
  const percent = price?.dayChangePercent ?? null;
  if (percent === null) return <MissingDayChange price={price} />;
  return <span className={cn('font-medium', pnlClass(percent))}>{formatPercent(percent, 1)}</span>;
}

/** Shows a trigger price as typed, without trailing zeros, e.g. 152.5. */
function triggerText(value: number | undefined): string {
  return value === undefined ? '' : String(Number(value.toFixed(4)));
}

/**
 * An editable trigger price. Saved on Enter or when the box loses focus; Escape
 * puts the saved value back; clearing the box removes the trigger. To its
 * right: how far the latest price is from it.
 */
function TriggerCell({
  item,
  latestPrice,
  currency,
  onChange,
}: {
  item: WatchItem;
  latestPrice: number | null;
  currency: string;
  onChange: (triggerPrice: number | undefined) => void;
}) {
  const saved = triggerText(item.triggerPrice);
  const [draft, setDraft] = useState(saved);
  // Follow changes that arrive from elsewhere (e.g. a sync from another device).
  const [shown, setShown] = useState(saved);
  if (shown !== saved) {
    setShown(saved);
    setDraft(saved);
  }

  const commit = () => {
    const text = draft.trim();
    if (text === saved) return;
    if (text === '') {
      onChange(undefined);
      return;
    }
    const value = parseNumber(text);
    if (value === null || value <= 0) {
      setDraft(saved);
      return;
    }
    onChange(value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      setDraft(saved);
      // Blur after the reset so commit sees the saved value.
      const input = event.currentTarget;
      requestAnimationFrame(() => input.blur());
    }
  };

  let status: string | null = null;
  if (item.triggerPrice !== undefined && latestPrice !== null && latestPrice > 0) {
    const move = ((item.triggerPrice - latestPrice) / latestPrice) * 100;
    status = Math.abs(move) < 0.05 ? 'At trigger' : `${move < 0 ? '↓' : '↑'} ${Math.abs(move).toFixed(1)}% to go`;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {status ? (
        <span
          className="order-2 w-24 shrink-0 text-left text-xs whitespace-nowrap text-muted-foreground"
          title="How far the latest price has to move to reach the trigger"
        >
          {status}
        </span>
      ) : (
        <span className="order-2 w-24 shrink-0" aria-hidden />
      )}
      <div className="order-1 w-24">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          inputMode="decimal"
          placeholder="Set"
          aria-label={`Trigger price for ${displayName(item)} in ${currency}`}
          className="h-8 text-right tabular-nums"
        />
      </div>
    </div>
  );
}

export function WatchlistTable({
  items,
  currency,
  prices,
  heldSymbols,
  knownNames,
  stockNotes,
  onNoteChange,
  quoteUrlFor,
  onAdd,
  onRemove,
  onTriggerChange,
  labels,
  onLabelChange,
  onCreateLabel,
  onDeleteLabel,
  sort,
  onSortChange,
}: WatchlistTableProps) {
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const cleanSymbol = symbol.trim().toUpperCase();
  const alreadyWatched = items.some((item) => item.symbol === cleanSymbol);

  const handleSymbolChange = (value: string) => {
    const next = value.toUpperCase();
    setSymbol(next);
    // Fill in the name from earlier trades, unless the user has typed one.
    if (!nameTouched) setName(knownNames.get(next.trim()) ?? '');
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!cleanSymbol || alreadyWatched) return;
    onAdd(cleanSymbol, name.trim() || undefined);
    setSymbol('');
    setName('');
    setNameTouched(false);
  };

  const rows = sortWatchlist(items, sort);
  const labelUsage: Record<string, number> = {};
  for (const item of items) if (item.label) labelUsage[item.label] = (labelUsage[item.label] ?? 0) + 1;

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-0 border-b pt-5 [.border-b]:pb-5">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            Watchlist
            <Badge variant="secondary">{items.length}</Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Stocks you want to keep an eye on. Prices update with Refresh, and the list syncs with the rest of your data.
            Type a trigger price to see how far the latest price is from it.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1.5 sm:w-40">
            <Label htmlFor="watch-symbol">Symbol</Label>
            <Input
              id="watch-symbol"
              value={symbol}
              onChange={(event) => handleSymbolChange(event.target.value)}
              placeholder="e.g. VOD.L"
              autoComplete="off"
              aria-invalid={alreadyWatched || undefined}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="watch-name">Stock name (optional)</Label>
            <Input
              id="watch-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameTouched(event.target.value !== '');
              }}
              placeholder="e.g. Vodafone Group"
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={!cleanSymbol || alreadyWatched}>
            <Plus />
            Add to watchlist
          </Button>
        </form>
        {alreadyWatched ? <p className="mt-2 text-xs text-muted-foreground">{cleanSymbol} is already on your watchlist.</p> : null}
      </CardHeader>
      <CardContent className="px-0">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
            <Eye className="size-6" />
            <p>No stocks on your watchlist yet. Add one above with the same symbol you would use for a trade.</p>
          </div>
        ) : (
          <Table className="table-fixed min-w-[60rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortableHead label="Label" sortKey="label" sort={sort} onSortChange={onSortChange} className="w-40 pl-6" />
                <TableHead className="w-24">Symbol</TableHead>
                <SortableHead label="Stock" sortKey="stock" sort={sort} onSortChange={onSortChange} className="w-[24%]" />
                <TableHead className="text-right">Latest price</TableHead>
                <TableHead className="text-right">Day change</TableHead>
                <TableHead className="w-20 text-right">%</TableHead>
                <TableHead className="w-60 pr-28 text-right">Trigger price</TableHead>
                <TableHead className="w-16 pr-6 text-right">
                  <span className="sr-only">Remove</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => {
                const price = prices[item.symbol];
                const label = displayName(item);
                const latest = price?.price ?? null;
                return (
                  <TableRow key={item.symbol} className="group/row">
                    <TableCell className="pl-6">
                      <LabelPicker
                        value={item.label}
                        labels={labels}
                        usage={labelUsage}
                        onChange={(next) => onLabelChange(item.symbol, next)}
                        onCreate={onCreateLabel}
                        onDelete={onDeleteLabel}
                        compact
                        usageNoun="watched stock"
                        ariaLabel={`Label for ${label}`}
                      />
                    </TableCell>
                    <TableCell>
                      <span className="block truncate font-medium" title={item.symbol}>
                        {item.symbol}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-semibold" title={label}>
                          {label}
                        </span>
                        <YahooLinkButton stockName={label} href={quoteUrlFor(item.symbol)} />
                        <StockNoteButton
                          stockName={label}
                          note={stockNotes[item.symbol]}
                          onSave={(note) => onNoteChange(item.symbol, note)}
                        />
                        {heldSymbols.has(item.symbol) ? (
                          <Badge variant="outline" className="shrink-0 text-[0.65rem]" title="You hold this stock">
                            Held
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <PriceCell price={price} currency={currency} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <DayChangeValueCell price={price} currency={currency} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <DayChangePercentCell price={price} />
                    </TableCell>
                    <TableCell className="text-right">
                      <TriggerCell
                        item={item}
                        latestPrice={latest}
                        currency={currency}
                        onChange={(value) => onTriggerChange(item.symbol, value)}
                      />
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <Tooltip delayDuration={300}>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-destructive"
                            onClick={() => onRemove(item)}
                            aria-label={`Remove ${label} from the watchlist`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Remove from watchlist</TooltipContent>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
