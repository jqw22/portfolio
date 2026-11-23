/**
 * Volatility and correlation from daily closing prices, for the Analysis tab.
 *
 * Everything works on daily returns (the % change from one close to the next), measured in the
 * ledger currency, so a US stock's swings include the pound/dollar rate. Volatility is the
 * standard deviation of daily returns scaled up to a year; correlation is the Pearson
 * correlation of two stocks' daily returns on the days both have prices.
 */

import { isPence } from './prices';

/** Daily closes for one symbol, oldest first. */
export interface PriceSeries {
  currency: string;
  /** `YYYY-MM-DD`, ascending. */
  dates: string[];
  closes: number[];
}

/** One stock to analyse: its current value and its price history. */
export interface RiskHolding {
  symbol: string;
  name: string;
  /** Current value in the ledger currency (all accounts together). */
  value: number;
  series: PriceSeries;
}

export interface StockRisk {
  symbol: string;
  name: string;
  value: number;
  /** Share of the analysed stocks' total value, 0 to 1. */
  weight: number;
  /** Yearly volatility as a fraction (0.25 = 25%), or `null` with too little history. */
  volatility: number | null;
  /** Largest one-day fall (a negative fraction) and its date. */
  worstDay: { change: number; date: string } | null;
  /** Change since the last close of the previous year, as a fraction; `null` when the history starts later. */
  ytd: number | null;
  /** Correlation with the benchmark's daily returns, -1 to 1. */
  benchmarkCorrelation: number | null;
  /** Share of the portfolio's swings that comes from this stock (sums to about 1). */
  riskShare: number | null;
  /** Number of daily returns the figures use. */
  days: number;
}

export interface CorrelationPair {
  a: string;
  b: string;
  correlation: number;
}

export interface RiskReport {
  stocks: StockRisk[];
  /** Total value of the analysed stocks. */
  totalValue: number;
  /** Yearly volatility of the stocks held together, weighted by value. */
  portfolioVolatility: number | null;
  /** Value-weighted average of each stock's own volatility; above `portfolioVolatility` thanks to diversification. */
  averageVolatility: number | null;
  /** Benchmark's own yearly volatility. */
  benchmarkVolatility: number | null;
  portfolioWorstDay: { change: number; date: string } | null;
  /** What the stocks held now did this year, weighted by their value at the start of the year. */
  portfolioYtd: number | null;
  benchmarkYtd: number | null;
  /** Correlation of each pair of stocks, in `stocks` order; `null` where they share too few days. */
  correlations: (number | null)[][];
  /** Simple average of all pair correlations. */
  averageCorrelation: number | null;
  /** First and last date the portfolio figures cover. */
  from: string;
  to: string;
}

/** Fewer daily returns than this and the figures are left out as unreliable. */
export const MIN_DAYS = 20;
/** Only the last year of prices is used. */
const WINDOW_DAYS = 366;

/** The currency an amount really is in, with pence counted as pounds (returns don't care about the unit). */
export function baseCurrency(currency: string): string {
  return isPence(currency) ? 'GBP' : currency.trim().toUpperCase();
}

/** Yahoo's symbol for the rate that turns `from` into `to`, e.g. `USDGBP=X`; `null` when no conversion is needed. */
export function fxSymbolFor(from: string, to: string): string | null {
  const source = baseCurrency(from);
  const target = baseCurrency(to);
  if (!source || source === target) return null;
  return `${source}${target}=X`;
}

/**
 * The series converted with daily exchange rates (`rate` turns the series' currency into the
 * ledger's). Each day uses that day's rate, or the latest one before it; days before the first
 * rate are dropped.
 */
export function convertSeries(series: PriceSeries, rate: PriceSeries | null): PriceSeries {
  if (!rate) return series;
  const dates: string[] = [];
  const closes: number[] = [];
  let at = -1;
  for (let index = 0; index < series.dates.length; index += 1) {
    const date = series.dates[index];
    while (at + 1 < rate.dates.length && rate.dates[at + 1] <= date) at += 1;
    if (at < 0) continue;
    dates.push(date);
    closes.push(series.closes[index] * rate.closes[at]);
  }
  return { currency: rate.currency, dates, closes };
}

function cutoff(series: PriceSeries[], window = WINDOW_DAYS): string {
  const last = series.reduce((latest, s) => (s.dates.length && s.dates[s.dates.length - 1] > latest ? s.dates[s.dates.length - 1] : latest), '');
  if (!last) return '';
  const date = new Date(`${last}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - window);
  return date.toISOString().slice(0, 10);
}

function trimmed(series: PriceSeries, from: string): PriceSeries {
  const start = series.dates.findIndex((date) => date >= from);
  if (start <= 0) return start < 0 ? { ...series, dates: [], closes: [] } : series;
  return { ...series, dates: series.dates.slice(start), closes: series.closes.slice(start) };
}

/** Daily returns of one series on its own trading days. */
function ownReturns(series: PriceSeries): { date: string; change: number }[] {
  const out: { date: string; change: number }[] = [];
  for (let index = 1; index < series.closes.length; index += 1) {
    const before = series.closes[index - 1];
    if (before > 0) out.push({ date: series.dates[index], change: series.closes[index] / before - 1 });
  }
  return out;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

/** Trading days a year for these dates, e.g. about 252 for shares and 365 for crypto. */
function daysPerYear(dates: string[]): number {
  if (dates.length < 2) return 252;
  const span = (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000;
  return span > 0 ? Math.min(366, Math.max(200, ((dates.length - 1) / span) * 365.25)) : 252;
}

/** Yearly volatility from daily returns on the given dates. */
function yearly(returns: number[], dates: string[]): number | null {
  if (returns.length < MIN_DAYS) return null;
  return standardDeviation(returns) * Math.sqrt(daysPerYear(dates));
}

function worst(returns: { date: string; change: number }[]): { change: number; date: string } | null {
  let found: { change: number; date: string } | null = null;
  for (const entry of returns) if (!found || entry.change < found.change) found = { change: entry.change, date: entry.date };
  return found;
}

/**
 * Change from the last close of the previous year to the latest close (the year of the latest
 * close counts as this year). `null` when the history doesn't reach back before 1 January.
 */
export function yearToDate(series: PriceSeries): number | null {
  const last = series.dates.length - 1;
  if (last < 1) return null;
  const startOfYear = `${series.dates[last].slice(0, 4)}-01-01`;
  let base = -1;
  for (let index = last; index >= 0; index -= 1) {
    if (series.dates[index] < startOfYear) {
      base = index;
      break;
    }
  }
  if (base < 0 || series.closes[base] <= 0) return null;
  return series.closes[last] / series.closes[base] - 1;
}

/**
 * This year's change for the stocks held now: today's value against what the same shares were
 * worth at the start of the year. Stocks without a year-to-date figure are left out.
 */
export function portfolioYearToDate(stocks: Pick<StockRisk, 'value' | 'ytd'>[]): number | null {
  let now = 0;
  let start = 0;
  for (const stock of stocks) {
    if (stock.ytd === null || stock.ytd <= -1) continue;
    now += stock.value;
    start += stock.value / (1 + stock.ytd);
  }
  return start > 0 ? now / start - 1 : null;
}

/**
 * Daily returns of several series on shared dates. A date counts when at least half the series
 * traded that day (so crypto weekends and one-exchange holidays don't add flat days for
 * everything else); a series that didn't trade keeps its last close. Entries are `null` before a
 * series' first price.
 */
export function alignedReturns(series: PriceSeries[]): { dates: string[]; returns: (number | null)[][] } {
  const counts = new Map<string, number>();
  for (const s of series) for (const date of s.dates) counts.set(date, (counts.get(date) ?? 0) + 1);
  const needed = Math.max(1, Math.ceil(series.length / 2));
  const dates = [...counts.keys()].filter((date) => (counts.get(date) ?? 0) >= needed).sort();
  const returns = series.map((s) => {
    const out: (number | null)[] = [];
    let at = -1;
    let previous: number | null = null;
    for (const date of dates) {
      while (at + 1 < s.dates.length && s.dates[at + 1] <= date) at += 1;
      const close = at >= 0 ? s.closes[at] : null;
      out.push(close !== null && previous !== null && previous > 0 ? close / previous - 1 : null);
      if (close !== null) previous = close;
    }
    return out;
  });
  // The first date has nothing before it.
  return { dates: dates.slice(1), returns: returns.map((r) => r.slice(1)) };
}

/** Pearson correlation over the days both have a return; `null` with fewer than `MIN_DAYS`. */
export function correlation(a: (number | null)[], b: (number | null)[]): number | null {
  const x: number[] = [];
  const y: number[] = [];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const left = a[index];
    const right = b[index];
    if (left !== null && right !== null) {
      x.push(left);
      y.push(right);
    }
  }
  if (x.length < MIN_DAYS) return null;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let index = 0; index < x.length; index += 1) {
    sxy += (x[index] - mx) * (y[index] - my);
    sxx += (x[index] - mx) ** 2;
    syy += (y[index] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

function covariance(a: (number | null)[], b: number[]): { value: number; n: number } {
  const x: number[] = [];
  const y: number[] = [];
  a.forEach((left, index) => {
    if (left !== null && Number.isFinite(b[index])) {
      x.push(left);
      y.push(b[index]);
    }
  });
  if (x.length < 2) return { value: 0, n: x.length };
  const mx = mean(x);
  const my = mean(y);
  return { value: x.reduce((sum, value, index) => sum + (value - mx) * (y[index] - my), 0) / (x.length - 1), n: x.length };
}

/**
 * Volatility and correlation for `holdings` (already converted to the ledger currency), with
 * `benchmark` (e.g. the FTSE 100) for comparison. Holdings with no value are left out.
 */
export function analyseRisk(holdings: RiskHolding[], benchmark: PriceSeries | null): RiskReport {
  const kept = holdings.filter((holding) => holding.value > 0 && holding.series.dates.length > 1);
  const from = cutoff(kept.map((holding) => holding.series));
  const series = kept.map((holding) => trimmed(holding.series, from));
  const bench = benchmark ? trimmed(benchmark, from) : null;
  const totalValue = kept.reduce((sum, holding) => sum + holding.value, 0);
  const weights = kept.map((holding) => (totalValue > 0 ? holding.value / totalValue : 0));

  const aligned = alignedReturns(series);
  // Portfolio return each day: the value-weighted average of the stocks that have a return, re-weighted when some don't yet.
  const portfolio = aligned.dates.map((_, day) => {
    let sum = 0;
    let weight = 0;
    aligned.returns.forEach((returns, index) => {
      const value = returns[day];
      if (value !== null) {
        sum += weights[index] * value;
        weight += weights[index];
      }
    });
    return weight > 0 ? sum / weight : Number.NaN;
  });
  const portfolioDays = aligned.dates.filter((_, day) => Number.isFinite(portfolio[day]));
  const portfolioReturns = portfolio.filter((value) => Number.isFinite(value));
  const portfolioVolatility = yearly(portfolioReturns, portfolioDays);
  const portfolioVariance = portfolioReturns.length >= MIN_DAYS ? standardDeviation(portfolioReturns) ** 2 : 0;

  // The benchmark lined up on the same dates as the stocks.
  const benchAligned = bench && bench.dates.length > 1 ? alignedReturns([...series, bench]) : null;
  const benchReturns = benchAligned?.returns[series.length] ?? null;

  const stocks: StockRisk[] = kept.map((holding, index) => {
    const own = ownReturns(series[index]);
    const covar = covariance(aligned.returns[index], portfolio);
    return {
      symbol: holding.symbol,
      name: holding.name,
      value: holding.value,
      weight: weights[index],
      volatility: yearly(
        own.map((entry) => entry.change),
        series[index].dates,
      ),
      worstDay: own.length >= MIN_DAYS ? worst(own) : null,
      ytd: yearToDate(holding.series),
      benchmarkCorrelation: benchAligned && benchReturns ? correlation(benchAligned.returns[index], benchReturns) : null,
      riskShare: portfolioVariance > 0 && covar.n >= MIN_DAYS ? (weights[index] * covar.value) / portfolioVariance : null,
      days: own.length,
    };
  });

  const correlations = kept.map((_, row) =>
    kept.map((__, column) => (row === column ? 1 : correlation(aligned.returns[row], aligned.returns[column]))),
  );
  const pairs: number[] = [];
  for (let row = 0; row < kept.length; row += 1) {
    for (let column = row + 1; column < kept.length; column += 1) {
      const value = correlations[row][column];
      if (value !== null) pairs.push(value);
    }
  }

  const withVolatility = stocks.filter((stock) => stock.volatility !== null);
  const volatilityWeight = withVolatility.reduce((sum, stock) => sum + stock.weight, 0);
  const benchOwn = bench ? ownReturns(bench) : [];

  return {
    stocks,
    totalValue,
    portfolioVolatility,
    averageVolatility:
      volatilityWeight > 0
        ? withVolatility.reduce((sum, stock) => sum + stock.weight * (stock.volatility ?? 0), 0) / volatilityWeight
        : null,
    benchmarkVolatility: bench
      ? yearly(
          benchOwn.map((entry) => entry.change),
          bench.dates,
        )
      : null,
    portfolioWorstDay:
      portfolioReturns.length >= MIN_DAYS
        ? worst(portfolioDays.map((date, index) => ({ date, change: portfolioReturns[index] })))
        : null,
    portfolioYtd: portfolioYearToDate(stocks),
    benchmarkYtd: benchmark ? yearToDate(benchmark) : null,
    correlations,
    averageCorrelation: pairs.length > 0 ? mean(pairs) : null,
    from: portfolioDays[0] ?? '',
    to: portfolioDays[portfolioDays.length - 1] ?? '',
  };
}

/** Every pair of different stocks with a correlation, most alike first. */
export function correlationPairs(report: Pick<RiskReport, 'stocks' | 'correlations'>): CorrelationPair[] {
  const pairs: CorrelationPair[] = [];
  report.stocks.forEach((stock, row) => {
    for (let column = row + 1; column < report.stocks.length; column += 1) {
      const value = report.correlations[row][column];
      if (value !== null) pairs.push({ a: stock.symbol, b: report.stocks[column].symbol, correlation: value });
    }
  });
  return pairs.sort((left, right) => right.correlation - left.correlation);
}

export type VolatilitySortKey = 'stock' | 'value' | 'weight' | 'volatility' | 'ytd';

export interface VolatilitySort {
  key: VolatilitySortKey;
  direction: 'asc' | 'desc';
}

export const DEFAULT_VOLATILITY_SORT: VolatilitySort = { key: 'volatility', direction: 'desc' };

export function isVolatilitySort(value: unknown): value is VolatilitySort {
  if (!value || typeof value !== 'object') return false;
  const { key, direction } = value as Record<string, unknown>;
  return (
    (key === 'stock' || key === 'value' || key === 'weight' || key === 'volatility' || key === 'ytd') && (direction === 'asc' || direction === 'desc')
  );
}

/** Order the Volatility table. Stocks without a volatility or year-to-date figure go last either way round; ties go by name. */
export function sortStockRisks(stocks: StockRisk[], sort: VolatilitySort): StockRisk[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  const byName = (a: StockRisk, b: StockRisk) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  return [...stocks].sort((a, b) => {
    if (sort.key === 'stock') return sign * byName(a, b);
    if (sort.key === 'volatility' || sort.key === 'ytd') {
      const left = a[sort.key];
      const right = b[sort.key];
      if (left === null || right === null) {
        if (left !== right) return left === null ? 1 : -1;
        return byName(a, b);
      }
      return sign * (left - right) || byName(a, b);
    }
    // Weight is value over the total, so both sort the same way.
    return sign * (a.value - b.value) || byName(a, b);
  });
}
