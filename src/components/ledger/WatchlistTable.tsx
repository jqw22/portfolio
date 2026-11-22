import { useState, type FormEvent } from 'react';
import { Eye, Plus, Trash2 } from 'lucide-react';

import { LatestPriceCell } from '@/components/ledger/HoldingsTable';
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
import { formatCurrency, formatDate, formatPercent, type WatchItem } from '@/lib/portfolio';

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
}

function displayName(item: WatchItem): string {
  return item.name?.trim() || item.symbol;
}

/** Sorted by name, like the holdings tables. */
function sortItems(items: WatchItem[]): WatchItem[] {
  return [...items].sort((a, b) =>
    displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base', numeric: true }),
  );
}

/** Day change for one share: the percentage on top, the change in price below. */
function WatchDayChangeCell({ price, currency }: { price: ResolvedPrice | null | undefined; currency: string }) {
  const percent = price?.dayChangePercent ?? null;
  if (percent === null) {
    return (
      <span className="text-muted-foreground" title={missingDayChangeReason(price)}>
        —
      </span>
    );
  }
  const perShare = price?.price != null ? price.price - price.price / (1 + percent / 100) : null;
  return (
    <div className={pnlClass(percent)}>
      <span className="font-medium">{formatPercent(percent, 1)}</span>
      {perShare !== null ? (
        <p className="mt-0.5 text-xs">
          {perShare > 0 ? '+' : ''}
          {formatCurrency(perShare, currency)}
        </p>
      ) : null}
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

  const rows = sortItems(items);

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
          <Table className="table-fixed min-w-[40rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[40%] pl-6">Stock</TableHead>
                <TableHead className="text-right">Latest price</TableHead>
                <TableHead className="text-right">Day change</TableHead>
                <TableHead className="text-right">Added</TableHead>
                <TableHead className="w-16 pr-6 text-right">
                  <span className="sr-only">Remove</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => {
                const price = prices[item.symbol];
                const label = displayName(item);
                return (
                  <TableRow key={item.symbol} className="group/row">
                    <TableCell className="pl-6">
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
                      {item.name?.trim() ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.symbol}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <LatestPriceCell price={price} currency={currency} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <WatchDayChangeCell price={price} currency={currency} />
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">{formatDate(item.addedOn)}</TableCell>
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
