import { useState, type FormEvent } from 'react';
import { ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CURRENCIES } from '@/lib/currency';
import { formatDate, parseNumber } from '@/lib/portfolio';
import {
  quoteCurrencyFor,
  quoteSymbolFor,
  type PriceSettings,
  type Quote,
  type SymbolPriceSettings,
} from '@/lib/prices';

const AUTO = 'auto';
const QUOTE_CURRENCIES = ['GBX', ...CURRENCIES];

function currencyLabel(code: string): string {
  return code === 'GBX' ? 'GBX (pence)' : code;
}

interface PricesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Symbols of the open positions. */
  symbols: string[];
  settings: PriceSettings;
  quotes: Record<string, Quote>;
  onSave: (settings: PriceSettings) => void;
}

export function PricesDialog({ open, onOpenChange, ...props }: PricesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Prices</DialogTitle>
          <DialogDescription>
            Latest prices come from a free price source using your own key, or from a price you type in. Keys and
            prices are kept in this browser only.
          </DialogDescription>
        </DialogHeader>
        {open ? <PricesForm {...props} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

interface SymbolDraft {
  quoteSymbol: string;
  quoteCurrency: string;
  manualPrice: string;
  manualCurrency: string;
}

function toDraft(own: SymbolPriceSettings): SymbolDraft {
  return {
    quoteSymbol: own.quoteSymbol ?? '',
    quoteCurrency: own.quoteCurrency ?? AUTO,
    manualPrice: own.manualPrice !== undefined ? String(own.manualPrice) : '',
    manualCurrency: own.manualCurrency ?? AUTO,
  };
}

function PricesForm({
  symbols,
  settings,
  quotes,
  onSave,
  onDone,
}: Omit<PricesDialogProps, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const [alphaVantageKey, setAlphaVantageKey] = useState(settings.alphaVantageKey);
  const [finnhubKey, setFinnhubKey] = useState(settings.finnhubKey);
  const [drafts, setDrafts] = useState<Record<string, SymbolDraft>>(() =>
    Object.fromEntries(symbols.map((symbol) => [symbol, toDraft(settings.symbols[symbol] ?? {})])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const update = (symbol: string, patch: Partial<SymbolDraft>) => {
    setDrafts((prev) => ({ ...prev, [symbol]: { ...prev[symbol], ...patch } }));
    setErrors((prev) => ({ ...prev, [symbol]: '' }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    // Keep settings for symbols not listed (e.g. positions closed for now).
    const nextSymbols: Record<string, SymbolPriceSettings> = { ...settings.symbols };

    for (const symbol of symbols) {
      const draft = drafts[symbol];
      const previous = settings.symbols[symbol] ?? {};
      const own: SymbolPriceSettings = {};
      const quoteSymbol = draft.quoteSymbol.trim().toUpperCase();
      if (quoteSymbol) own.quoteSymbol = quoteSymbol;
      if (draft.quoteCurrency !== AUTO) own.quoteCurrency = draft.quoteCurrency;
      if (draft.manualPrice.trim()) {
        const price = parseNumber(draft.manualPrice);
        if (price === null || price < 0) {
          nextErrors[symbol] = 'Enter a price of 0 or more, or leave it blank.';
          continue;
        }
        own.manualPrice = price;
        if (draft.manualCurrency !== AUTO) own.manualCurrency = draft.manualCurrency;
        const unchanged = previous.manualPrice === price && previous.manualCurrency === own.manualCurrency;
        own.manualUpdatedAt = unchanged && previous.manualUpdatedAt ? previous.manualUpdatedAt : Date.now();
      }
      if (Object.keys(own).length > 0) nextSymbols[symbol] = own;
      else delete nextSymbols[symbol];
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    onSave({ alphaVantageKey: alphaVantageKey.trim(), finnhubKey: finnhubKey.trim(), symbols: nextSymbols });
    onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="price-av-key">Alpha Vantage key</Label>
            <a
              href="https://www.alphavantage.co/support/#api-key"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
            >
              Get a free key
              <ExternalLink className="size-3" />
            </a>
          </div>
          <Input
            id="price-av-key"
            type="password"
            autoComplete="off"
            value={alphaVantageKey}
            onChange={(event) => setAlphaVantageKey(event.target.value)}
            placeholder="Paste your key"
          />
          <p className="text-xs text-muted-foreground">
            Covers US and European exchanges. The free tier allows 25 lookups a day, so prices refresh at most twice a
            day on their own.
          </p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="price-fh-key">
              Finnhub key <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <a
              href="https://finnhub.io/register"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
            >
              Get a free key
              <ExternalLink className="size-3" />
            </a>
          </div>
          <Input
            id="price-fh-key"
            type="password"
            autoComplete="off"
            value={finnhubKey}
            onChange={(event) => setFinnhubKey(event.target.value)}
            placeholder="Paste your key"
          />
          <p className="text-xs text-muted-foreground">
            When set, US tickers are priced by Finnhub instead, which saves your Alpha Vantage allowance for European
            ones.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Symbols</h3>
          <p className="text-xs text-muted-foreground">
            London tickers end in .LON (or .L), Xetra .DEX, Paris .PAR, Amsterdam .AMS. A manual price always wins
            over a fetched one; clear it to go back to fetching.
          </p>
        </div>
        {symbols.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No open positions to price.
          </p>
        ) : (
          <ul className="space-y-3">
            {symbols.map((symbol) => {
              const draft = drafts[symbol];
              const autoQuoteSymbol = quoteSymbolFor(symbol);
              const effectiveQuoteSymbol = draft.quoteSymbol.trim().toUpperCase() || autoQuoteSymbol;
              const autoCurrency = quoteCurrencyFor(effectiveQuoteSymbol);
              const effectiveCurrency = draft.quoteCurrency === AUTO ? autoCurrency : draft.quoteCurrency;
              const quote = quotes[symbol];
              const id = `price-${symbol}`;
              return (
                <li key={symbol} className="rounded-lg border p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-semibold">{symbol}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {quote
                        ? `Last fetched ${quote.price} ${quote.currency}${quote.asOf ? ` (${formatDate(quote.asOf.slice(0, 10))})` : ''}`
                        : 'Not fetched yet'}
                    </p>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`${id}-symbol`} className="text-xs">
                        Look up as
                      </Label>
                      <Input
                        id={`${id}-symbol`}
                        value={draft.quoteSymbol}
                        onChange={(event) => update(symbol, { quoteSymbol: event.target.value })}
                        placeholder={autoQuoteSymbol}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${id}-currency`} className="text-xs">
                        Quoted in
                      </Label>
                      <Select value={draft.quoteCurrency} onValueChange={(value) => update(symbol, { quoteCurrency: value })}>
                        <SelectTrigger id={`${id}-currency`} className="h-9 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={AUTO}>Auto ({currencyLabel(autoCurrency)})</SelectItem>
                          {QUOTE_CURRENCIES.map((code) => (
                            <SelectItem key={code} value={code}>
                              {currencyLabel(code)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${id}-manual`} className="text-xs">
                        Manual price
                      </Label>
                      <Input
                        id={`${id}-manual`}
                        inputMode="decimal"
                        value={draft.manualPrice}
                        onChange={(event) => update(symbol, { manualPrice: event.target.value })}
                        placeholder="Fetch automatically"
                        aria-invalid={Boolean(errors[symbol])}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${id}-manual-currency`} className="text-xs">
                        Manual price in
                      </Label>
                      <Select
                        value={draft.manualCurrency}
                        onValueChange={(value) => update(symbol, { manualCurrency: value })}
                      >
                        <SelectTrigger id={`${id}-manual-currency`} className="h-9 w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={AUTO}>Same as quote ({currencyLabel(effectiveCurrency)})</SelectItem>
                          {QUOTE_CURRENCIES.map((code) => (
                            <SelectItem key={code} value={code}>
                              {currencyLabel(code)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {errors[symbol] ? <p className="mt-2 text-xs text-destructive">{errors[symbol]}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">Save</Button>
      </DialogFooter>
    </form>
  );
}
