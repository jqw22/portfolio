import { Activity, Link2, RefreshCw, Shuffle, TrendingDown } from 'lucide-react';
import { useMemo, type ComponentType, type CSSProperties } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePriceHistory } from '@/hooks/usePriceHistory';
import { formatWhole, type Holding } from '@/lib/portfolio';
import { quoteSymbolFor, yahooSymbolFor, type PriceSettings, type ResolvedPrice } from '@/lib/prices';
import {
  analyseRisk,
  convertSeries,
  correlationPairs,
  fxSymbolFor,
  type PriceSeries,
  type RiskHolding,
  type StockRisk,
} from '@/lib/risk';
import { cn } from '@/lib/utils';

/** Yahoo's symbol for the FTSE 100 index, the comparison for UK portfolios. */
const BENCHMARK = '^FTSE';
const BENCHMARK_NAME = 'FTSE 100';
/** The correlation grid shows at most this many of the largest holdings. */
const GRID_MAX = 12;

interface RiskAnalysisProps {
  holdings: Holding[];
  prices: Record<string, ResolvedPrice | null>;
  priceSettings: PriceSettings;
  currency: string;
  /** Latest stock name by symbol. */
  names: Map<string, string>;
}

function yahooSymbol(symbol: string, settings: PriceSettings): string {
  const own = settings.symbols[symbol] ?? {};
  return yahooSymbolFor(quoteSymbolFor(own.quoteSymbol?.trim() || symbol));
}

function percent(value: number | null, decimals = 1): string {
  return value === null ? '—' : `${(value * 100).toFixed(decimals)}%`;
}

function signedPercent(value: number, decimals = 1): string {
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(decimals)}%`;
}

/** Plain words for a yearly volatility. */
function volatilityWord(volatility: number): string {
  if (volatility < 0.15) return 'Low';
  if (volatility < 0.3) return 'Medium';
  if (volatility < 0.5) return 'High';
  return 'Very high';
}

function correlationWord(value: number): string {
  if (value >= 0.7) return 'Move closely together';
  if (value >= 0.4) return 'Often move together';
  if (value >= 0.15) return 'Loosely linked';
  if (value > -0.15) return 'Barely linked';
  return 'Tend to move opposite';
}

/** Background for a correlation cell: orange for moving together, blue for moving apart, stronger for closer to ±1. */
function cellStyle(value: number | null): CSSProperties {
  if (value === null) return {};
  const strength = Math.min(1, Math.abs(value)) * 0.85;
  const colour = value >= 0 ? '234, 88, 12' : '37, 99, 235';
  return { backgroundColor: `rgba(${colour}, ${strength.toFixed(2)})`, color: strength > 0.5 ? 'white' : undefined };
}

/** `YYYY-MM-DD` as `dd/mm/yy`, e.g. `20/11/26`. */
function shortDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return year && month && day ? `${day}/${month}/${year.slice(2)}` : iso;
}

function shortSymbol(symbol: string): string {
  return symbol.replace(/^[A-Z]+:/, '').split('.')[0];
}

interface StatProps {
  label: string;
  value: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
  iconClass: string;
}

function Stat({ label, value, hint, icon: Icon, iconClass }: StatProps) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', iconClass)}>
            <Icon className="size-4" />
          </span>
        </div>
        <div className="min-w-0">
          <p className="truncate text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function VolatilityCell({ stock }: { stock: StockRisk }) {
  if (stock.volatility === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="font-medium">{percent(stock.volatility)}</span>{' '}
      <span className="text-xs text-muted-foreground">{volatilityWord(stock.volatility)}</span>
    </span>
  );
}

/**
 * The Analysis tab: how much each holding swings (volatility), how much of the portfolio's swings
 * each one causes, and which holdings move together (correlation), from about a year of daily
 * closes fetched through the price relay.
 */
export function RiskAnalysis({ holdings, prices, priceSettings, currency, names }: RiskAnalysisProps) {
  // One entry per stock, all accounts together.
  const stocks = useMemo(() => {
    const bySymbol = new Map<string, { symbol: string; name: string; quantity: number; yahoo: string }>();
    for (const holding of holdings) {
      const entry = bySymbol.get(holding.symbol) ?? {
        symbol: holding.symbol,
        name: names.get(holding.symbol) || holding.name || holding.symbol,
        quantity: 0,
        yahoo: yahooSymbol(holding.symbol, priceSettings),
      };
      entry.quantity += holding.quantity;
      bySymbol.set(holding.symbol, entry);
    }
    return [...bySymbol.values()];
  }, [holdings, names, priceSettings]);

  const historySymbols = useMemo(
    () => [...new Set([...stocks.map((stock) => stock.yahoo), BENCHMARK])].sort(),
    [stocks],
  );
  const history = usePriceHistory(priceSettings.relayUrl, historySymbols, currency);

  const { report, unpriced, missing } = useMemo(() => {
    const inCurrency = (yahoo: string): PriceSeries | null => {
      const series = history.series[yahoo];
      if (!series) return null;
      const fx = fxSymbolFor(series.currency, currency);
      if (!fx) return series;
      const rate = history.series[fx];
      return rate ? convertSeries(series, rate) : null;
    };
    const input: RiskHolding[] = [];
    const unpricedNames: string[] = [];
    const missingNames: string[] = [];
    for (const stock of stocks) {
      const price = prices[stock.symbol]?.price;
      if (price === null || price === undefined) {
        unpricedNames.push(stock.name);
        continue;
      }
      const series = inCurrency(stock.yahoo);
      if (!series) {
        missingNames.push(stock.name);
        continue;
      }
      input.push({ symbol: stock.symbol, name: stock.name, value: price * stock.quantity, series });
    }
    return { report: analyseRisk(input, inCurrency(BENCHMARK)), unpriced: unpricedNames, missing: missingNames };
  }, [stocks, prices, history.series, currency]);

  const byVolatility = useMemo(
    () => [...report.stocks].sort((a, b) => (b.volatility ?? -1) - (a.volatility ?? -1) || a.name.localeCompare(b.name)),
    [report.stocks],
  );
  const grid = useMemo(() => {
    const order = report.stocks
      .map((stock, index) => ({ stock, index }))
      .sort((a, b) => b.stock.value - a.stock.value)
      .slice(0, GRID_MAX);
    return order;
  }, [report.stocks]);
  const pairs = useMemo(() => correlationPairs(report), [report]);
  const nameOf = useMemo(() => new Map(report.stocks.map((stock) => [stock.symbol, stock.name])), [report.stocks]);
  const topRisk = useMemo(
    () => [...report.stocks].filter((stock) => stock.riskShare !== null).sort((a, b) => (b.riskShare ?? 0) - (a.riskShare ?? 0))[0],
    [report.stocks],
  );

  const fetchedAt = Math.max(0, ...historySymbols.map((symbol) => history.series[symbol]?.fetchedAt ?? 0));
  const failed = historySymbols.filter((symbol) => history.errors[symbol] && !history.series[symbol]);
  const monthMove = report.portfolioVolatility !== null ? (report.portfolioVolatility / Math.sqrt(12)) * report.totalValue : null;

  if (stocks.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Add some trades to see how much your holdings swing and which ones move together.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">Volatility and correlation</h2>
          <p className="text-sm text-muted-foreground">
            From the last year of daily closing prices on Yahoo Finance, in {currency}. Cash isn't included.
            {fetchedAt > 0 ? ` Prices up to ${shortDate(report.to || new Date(fetchedAt).toISOString().slice(0, 10))}.` : ''}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void history.refresh()}
          disabled={!history.hasRelay || history.isLoading}
        >
          <RefreshCw className={cn(history.isLoading && 'animate-spin')} />
          {history.isLoading ? 'Fetching history…' : 'Refresh history'}
        </Button>
      </div>

      {!history.hasRelay ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            This needs the price relay. Open <span className="font-medium text-foreground">Prices</span> and add your price
            relay address, then come back here.
          </CardContent>
        </Card>
      ) : null}

      {history.problem ? (
        <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          {history.problem}
        </div>
      ) : null}

      {failed.length > 0 || unpriced.length > 0 || missing.length > 0 ? (
        <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {failed.length > 0 ? (
            <p>
              No history for{' '}
              {failed.map((symbol, index) => (
                <span key={symbol}>
                  {index > 0 ? ', ' : ''}
                  <span className="font-medium text-foreground">{symbol}</span> ({history.errors[symbol]})
                </span>
              ))}
              .
            </p>
          ) : null}
          {unpriced.length > 0 ? <p>Left out (no latest price): {unpriced.join(', ')}.</p> : null}
          {missing.length > 0 && !history.isLoading ? <p>Left out (no price history yet): {missing.join(', ')}.</p> : null}
        </div>
      ) : null}

      {report.stocks.length > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Portfolio volatility"
              value={report.portfolioVolatility !== null ? `${percent(report.portfolioVolatility)} a year` : '—'}
              hint={
                report.benchmarkVolatility !== null
                  ? `${BENCHMARK_NAME}: ${percent(report.benchmarkVolatility)} a year`
                  : 'How much the stocks together swing'
              }
              icon={Activity}
              iconClass="bg-sky-500/10 text-sky-600 dark:text-sky-400"
            />
            <Stat
              label="Typical month"
              value={monthMove !== null ? `± ${formatWhole(monthMove, currency)}` : '—'}
              hint="About 2 months in 3 stay within this"
              icon={Shuffle}
              iconClass="bg-violet-500/10 text-violet-600 dark:text-violet-400"
            />
            <Stat
              label="Average correlation"
              value={report.averageCorrelation !== null ? report.averageCorrelation.toFixed(2) : '—'}
              hint={
                report.averageVolatility !== null && report.portfolioVolatility !== null
                  ? `Holding them together: ${percent(report.portfolioVolatility)} instead of ${percent(report.averageVolatility)}`
                  : 'Between each pair of stocks'
              }
              icon={Link2}
              iconClass="bg-orange-500/10 text-orange-600 dark:text-orange-400"
            />
            <Stat
              label="Worst day"
              value={report.portfolioWorstDay ? signedPercent(report.portfolioWorstDay.change) : '—'}
              hint={
                report.portfolioWorstDay
                  ? `${shortDate(report.portfolioWorstDay.date)}${topRisk ? `. Most of the swings: ${topRisk.name} (${percent(topRisk.riskShare, 0)})` : ''}`
                  : 'Largest one-day fall in the last year'
              }
              icon={TrendingDown}
              iconClass="bg-rose-500/10 text-rose-600 dark:text-rose-400"
            />
          </div>

          <Card className="gap-0 py-0">
            <CardHeader className="border-b px-5 py-4">
              <CardTitle className="text-base">Volatility</CardTitle>
              <CardDescription>
                How much each stock swings in a year, most volatile first. Share of swings is how much of the portfolio's
                ups and downs come from that stock, which depends on its size as well as its volatility.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-5">Stock</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="text-right">Weight</TableHead>
                      <TableHead className="text-right">Volatility</TableHead>
                      <TableHead className="text-right">Worst day</TableHead>
                      <TableHead className="text-right">With {BENCHMARK_NAME}</TableHead>
                      <TableHead className="pr-5 text-right">Share of swings</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byVolatility.map((stock) => (
                      <TableRow key={stock.symbol}>
                        <TableCell className="pl-5">
                          <span className="whitespace-nowrap">
                            <span className="font-medium">{stock.name}</span>{' '}
                            <span className="text-xs text-muted-foreground">{stock.symbol}</span>
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatWhole(stock.value, currency)}</TableCell>
                        <TableCell className="text-right tabular-nums">{percent(stock.weight)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <VolatilityCell stock={stock} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {stock.worstDay ? (
                            <span className="whitespace-nowrap">
                              <span className="text-rose-600 dark:text-rose-400">{signedPercent(stock.worstDay.change)}</span>{' '}
                              <span className="text-xs text-muted-foreground">{shortDate(stock.worstDay.date)}</span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {stock.benchmarkCorrelation !== null ? stock.benchmarkCorrelation.toFixed(2) : '—'}
                        </TableCell>
                        <TableCell className="pr-5 text-right tabular-nums">{percent(stock.riskShare)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {byVolatility.some((stock) => stock.days < 200) ? (
                <p className="border-t px-5 py-3 text-xs text-muted-foreground">
                  Stocks with less than a year of prices use what there is; under 20 trading days shows “—”.
                </p>
              ) : null}
            </CardContent>
          </Card>

          {grid.length > 1 ? (
            <Card className="gap-0 py-0">
              <CardHeader className="border-b px-5 py-4">
                <CardTitle className="text-base">Correlation</CardTitle>
                <CardDescription>
                  How closely each pair of stocks moves day to day, from −1 (opposite) through 0 (unrelated) to 1 (in step).
                  Stocks that move together give less protection when one falls.
                  {report.stocks.length > GRID_MAX ? ` Showing your ${GRID_MAX} largest holdings.` : ''}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 px-5 py-4">
                <div className="overflow-x-auto">
                  <table className="border-separate border-spacing-0.5 text-xs tabular-nums">
                    <thead>
                      <tr>
                        <th />
                        {grid.map(({ stock }) => (
                          <th key={stock.symbol} className="w-12 min-w-12 px-1 pb-1 text-center font-medium text-muted-foreground">
                            {shortSymbol(stock.symbol)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {grid.map(({ stock, index: row }) => (
                        <tr key={stock.symbol}>
                          <th className="max-w-44 truncate pr-3 text-left font-medium" title={stock.name}>
                            {stock.name}
                          </th>
                          {grid.map(({ stock: other, index: column }) => {
                            const value = report.correlations[row][column];
                            const same = row === column;
                            return (
                              <td key={other.symbol} className="p-0">
                                <Tooltip delayDuration={150}>
                                  <TooltipTrigger asChild>
                                    <div
                                      className={cn(
                                        'grid h-9 w-12 place-items-center rounded-sm',
                                        same ? 'bg-muted text-muted-foreground' : value === null && 'bg-muted/40 text-muted-foreground',
                                      )}
                                      style={same ? undefined : cellStyle(value)}
                                    >
                                      {same ? '' : value === null ? '—' : value.toFixed(2)}
                                    </div>
                                  </TooltipTrigger>
                                  {!same ? (
                                    <TooltipContent side="top">
                                      {stock.name} and {other.name}:{' '}
                                      {value === null ? 'too few shared days' : `${value.toFixed(2)}, ${correlationWord(value).toLowerCase()}`}
                                    </TooltipContent>
                                  ) : null}
                                </Tooltip>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>−1</span>
                  <span
                    className="h-2.5 w-40 rounded-full"
                    style={{ background: 'linear-gradient(to right, rgba(37,99,235,0.85), rgba(127,127,127,0.12), rgba(234,88,12,0.85))' }}
                  />
                  <span>+1</span>
                  <span className="ml-2">Blue: move apart. Orange: move together.</span>
                </div>

                {pairs.length > 1 ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <PairList
                      title="Move most alike"
                      pairs={pairs.slice(0, 3)}
                      nameOf={nameOf}
                    />
                    <PairList
                      title="Best diversifiers"
                      pairs={pairs.slice(-3).reverse().filter((pair) => !pairs.slice(0, 3).includes(pair))}
                      nameOf={nameOf}
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : history.isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Fetching a year of prices…</CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function PairList({
  title,
  pairs,
  nameOf,
}: {
  title: string;
  pairs: { a: string; b: string; correlation: number }[];
  nameOf: Map<string, string>;
}) {
  if (pairs.length === 0) return null;
  return (
    <div>
      <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      <ul className="space-y-1.5 text-sm">
        {pairs.map((pair) => (
          <li key={`${pair.a}|${pair.b}`} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">
              {nameOf.get(pair.a)} <span className="text-muted-foreground">and</span> {nameOf.get(pair.b)}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {pair.correlation.toFixed(2)} · {correlationWord(pair.correlation).toLowerCase()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
