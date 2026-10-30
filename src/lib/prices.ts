/**
 * Latest prices, currency conversion and unrealised gains.
 *
 * Everything here is pure so the maths can be unit tested; the network calls
 * live in `priceSources.ts` and the React state in `usePrices`.
 */

import type { Holding } from './portfolio';

const EPSILON = 1e-9;

export type PriceProviderId = 'relay' | 'alphavantage' | 'finnhub';

/** How one ledger symbol is priced. Every field is optional. */
export interface SymbolPriceSettings {
  /** Symbol to look up with the price source, e.g. `VOD.LON`. Defaults to `quoteSymbolFor(symbol)`. */
  quoteSymbol?: string;
  /** Currency the source quotes in, e.g. `GBX`. Defaults to `quoteCurrencyFor(quoteSymbol)`. */
  quoteCurrency?: string;
  /** A price typed in by hand; always wins over a fetched quote. */
  manualPrice?: number;
  /** Currency of `manualPrice`. Defaults to the quote currency. */
  manualCurrency?: string;
  /** When the manual price was set (ms since epoch). */
  manualUpdatedAt?: number;
}

/** Kept in this browser only (never synced), because it holds API keys. */
export interface PriceSettings {
  /** Address of the user's own price relay (see `relay/`), which fetches Yahoo prices. */
  relayUrl: string;
  alphaVantageKey: string;
  finnhubKey: string;
  symbols: Record<string, SymbolPriceSettings>;
}

export const DEFAULT_PRICE_SETTINGS: PriceSettings = { relayUrl: '', alphaVantageKey: '', finnhubKey: '', symbols: {} };

/** A price fetched from a source, in the currency the source quotes. */
export interface Quote {
  price: number;
  /** The last session's closing price, in the same currency. Missing from older quotes and relays. */
  previousClose?: number;
  currency: string;
  /** When the market data is from: an ISO date (`YYYY-MM-DD`) or date-time. */
  asOf: string;
  /** When it was fetched (ms since epoch). */
  fetchedAt: number;
  provider: PriceProviderId;
  /** The symbol the source was asked for. */
  quoteSymbol: string;
  /**
   * True when the source didn't say which currency it quoted in (Alpha Vantage, Finnhub), so
   * `currency` is a guess. Missing on older quotes, where only the relay's are taken as reported.
   */
  currencyGuessed?: boolean;
  /** The currency a source last reported for this symbol, kept on later quotes that had to guess. */
  reportedCurrency?: string;
}

/** The last currency a source reported for a symbol, from an earlier quote. */
function lastReportedCurrency(previous: Quote | undefined): string | undefined {
  if (!previous) return undefined;
  return previous.reportedCurrency ?? (isCurrencyGuessed(previous) ? undefined : previous.currency);
}

/** `{ reportedCurrency }` for a new quote: the one its source reported, else the last one known. */
export function withReportedCurrency(reported: string | undefined, previous: Quote | undefined): { reportedCurrency?: string } {
  const currency = reported || lastReportedCurrency(previous);
  return currency ? { reportedCurrency: currency } : {};
}

/** Whether a quote's currency came from Ledger's guess rather than from the source. */
export function isCurrencyGuessed(quote: Pick<Quote, 'currencyGuessed' | 'provider'>): boolean {
  return quote.currencyGuessed ?? quote.provider !== 'relay';
}

function isSterling(currency: string): boolean {
  return isPence(currency) || currency.toUpperCase() === 'GBP';
}

function inPence(price: number, currency: string): number {
  return isPence(currency) ? price : price * 100;
}

/**
 * The currency for a new quote from a source that doesn't say which one it used. London prices
 * can be in pounds or pence, and the exchange suffix alone can't tell, so:
 * - a currency a source reported for the symbol earlier is reused, even after quotes that guessed;
 * - a sterling price that is about 100 times off the last price is taken to be in the other unit.
 */
export function guessQuoteCurrency(price: number, guess: string, previous: Quote | undefined): string {
  if (!previous) return guess;
  const currency = lastReportedCurrency(previous) ?? guess;
  if (!isSterling(currency) || !isSterling(previous.currency)) return currency;
  const before = inPence(previous.price, previous.currency);
  const asPence = Math.abs(Math.log(price / before));
  const asPounds = Math.abs(Math.log((price * 100) / before));
  // Only switch when the other unit fits clearly better (over a 10x move either way).
  if (isPence(currency) && asPounds + Math.log(10) < asPence) return 'GBP';
  if (!isPence(currency) && asPence + Math.log(10) < asPounds) return 'GBX';
  return currency;
}

/** Exchange rates: one unit of `base` buys `rates[code]` of each currency. */
export interface FxRates {
  base: string;
  /** Date the rates are for (`YYYY-MM-DD`). */
  date: string;
  rates: Record<string, number>;
  fetchedAt: number;
}

/** The day a price was fetched, in UK style, e.g. `18 Oct 2026`. */
export function formatFetchedOn(updatedAt: number): string {
  if (!updatedAt) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(updatedAt));
}

/** What to show for a symbol after picking manual vs fetched and converting. */
export interface ResolvedPrice {
  /** Price in the ledger currency, or `null` when there is no exchange rate for it. */
  price: number | null;
  /** The price as entered or quoted, before conversion. */
  nativePrice: number;
  /** Change since the last session's close as a percentage, or `null` when unknown (always for manual prices). */
  dayChangePercent: number | null;
  nativeCurrency: string;
  source: 'manual' | 'quote';
  /** When the price is from: an ISO date or date-time. */
  asOf: string;
  /** When it was fetched or typed in (ms since epoch). */
  updatedAt: number;
}

/** Yahoo-style exchange suffixes and the Alpha Vantage suffix for the same exchange. */
const SUFFIX_TO_ALPHA_VANTAGE: Record<string, string> = {
  L: 'LON',
  DE: 'DEX',
  F: 'FRK',
  PA: 'PAR',
  AS: 'AMS',
  TO: 'TRT',
};

/** Alpha Vantage suffixes and the Yahoo suffix for the same exchange. */
const ALPHA_VANTAGE_TO_YAHOO: Record<string, string> = Object.fromEntries(
  Object.entries(SUFFIX_TO_ALPHA_VANTAGE).map(([yahoo, alphaVantage]) => [alphaVantage, yahoo]),
);

/** Currency each exchange suffix quotes in (Alpha Vantage and Yahoo spellings). */
const SUFFIX_CURRENCY: Record<string, string> = {
  LON: 'GBX',
  L: 'GBX',
  DEX: 'EUR',
  DE: 'EUR',
  FRK: 'EUR',
  F: 'EUR',
  PAR: 'EUR',
  PA: 'EUR',
  AMS: 'EUR',
  AS: 'EUR',
  BR: 'EUR',
  MI: 'EUR',
  MC: 'EUR',
  LS: 'EUR',
  HE: 'EUR',
  VI: 'EUR',
  IR: 'EUR',
  SW: 'CHF',
  ST: 'SEK',
  CO: 'DKK',
  OL: 'NOK',
  TRT: 'CAD',
  TO: 'CAD',
};

function splitSuffix(symbol: string): [string, string | undefined] {
  const value = symbol.trim().toUpperCase();
  const dot = value.lastIndexOf('.');
  if (dot <= 0 || dot === value.length - 1) return [value, undefined];
  return [value.slice(0, dot), value.slice(dot + 1)];
}

/** The symbol to ask the price source for, e.g. `VOD.L` → `VOD.LON`. */
export function quoteSymbolFor(symbol: string): string {
  const [base, suffix] = splitSuffix(symbol);
  if (!suffix) return base;
  return `${base}.${SUFFIX_TO_ALPHA_VANTAGE[suffix] ?? suffix}`;
}

/** The currency a quote symbol trades in: USD without a suffix, else by exchange. */
export function quoteCurrencyFor(quoteSymbol: string): string {
  const [, suffix] = splitSuffix(quoteSymbol);
  if (!suffix) return 'USD';
  return SUFFIX_CURRENCY[suffix] ?? 'USD';
}

/** True for US-style tickers (no exchange suffix), which Finnhub's free tier covers. */
export function isUsSymbol(quoteSymbol: string): boolean {
  return splitSuffix(quoteSymbol)[1] === undefined;
}

/** The symbol to ask Yahoo (via the relay) for, e.g. `VOD.LON` → `VOD.L`. */
export function yahooSymbolFor(quoteSymbol: string): string {
  const [base, suffix] = splitSuffix(quoteSymbol);
  if (!suffix) return base;
  return `${base}.${ALPHA_VANTAGE_TO_YAHOO[suffix] ?? suffix}`;
}

/** The relay address as a URL, or `null` when it isn't a valid https (or local http) address. */
export function parseRelayUrl(value: string): URL | null {
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    return url.protocol === 'https:' || local ? url : null;
  } catch {
    return null;
  }
}

export interface QuotePlan {
  provider: PriceProviderId;
  /** The symbol in the provider's own spelling. */
  quoteSymbol: string;
  /** Currency the price is expected in; the relay's own answer wins. */
  currency: string;
  /** True when `currency` is the one set for the symbol in Prices rather than worked out. */
  currencySet?: boolean;
}

/**
 * The sources to try for a symbol, best first; empty when nothing can price it.
 * The relay comes first when set up (no daily limit). US tickers then go to
 * Finnhub when its key is set (it allows far more calls), then Alpha Vantage.
 */
export function planQuotes(symbol: string, settings: PriceSettings): QuotePlan[] {
  const own = settings.symbols[symbol] ?? {};
  const quoteSymbol = own.quoteSymbol?.trim().toUpperCase() || quoteSymbolFor(symbol);
  const currency = own.quoteCurrency || quoteCurrencyFor(quoteSymbol);
  // Only marked when set, so plans for symbols without settings stay as they were.
  const set = own.quoteCurrency ? { currencySet: true } : {};
  const plans: QuotePlan[] = [];
  if (parseRelayUrl(settings.relayUrl)) {
    plans.push({ provider: 'relay', quoteSymbol: yahooSymbolFor(quoteSymbol), currency, ...set });
  }
  if (settings.finnhubKey.trim() && isUsSymbol(quoteSymbol)) plans.push({ provider: 'finnhub', quoteSymbol, currency, ...set });
  if (settings.alphaVantageKey.trim()) plans.push({ provider: 'alphavantage', quoteSymbol, currency, ...set });
  return plans;
}

/** Whether a currency code means pence sterling (London prices are quoted in pence). */
export function isPence(currency: string): boolean {
  return currency === 'GBp' || currency.toUpperCase() === 'GBX';
}

function rateFor(currency: string, fx: FxRates | null | undefined): number | undefined {
  if (!fx) return undefined;
  if (currency === fx.base) return 1;
  const rate = fx.rates[currency];
  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}

/**
 * Convert an amount between currencies, turning pence into pounds first.
 * Returns `null` when a needed exchange rate is missing.
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  fx: FxRates | null | undefined,
): number | null {
  if (!Number.isFinite(amount)) return null;
  let value = amount;
  let source = from.trim();
  if (isPence(source)) {
    value /= 100;
    source = 'GBP';
  }
  source = source.toUpperCase();
  const target = to.trim().toUpperCase();
  if (source === target) return value;
  const fromRate = rateFor(source, fx);
  const toRate = rateFor(target, fx);
  if (fromRate === undefined || toRate === undefined) return null;
  return (value / fromRate) * toRate;
}

/** Pick the manual price if there is one, else the fetched quote, and convert it to `currency`. */
export function resolvePrice(
  symbol: string,
  settings: PriceSettings,
  quotes: Record<string, Quote>,
  fx: FxRates | null | undefined,
  currency: string,
): ResolvedPrice | null {
  const own = settings.symbols[symbol] ?? {};
  if (own.manualPrice !== undefined && Number.isFinite(own.manualPrice) && own.manualPrice >= 0) {
    const nativeCurrency =
      own.manualCurrency || own.quoteCurrency || quoteCurrencyFor(own.quoteSymbol || quoteSymbolFor(symbol));
    const updatedAt = own.manualUpdatedAt ?? 0;
    return {
      price: convertAmount(own.manualPrice, nativeCurrency, currency, fx),
      nativePrice: own.manualPrice,
      dayChangePercent: null,
      nativeCurrency,
      source: 'manual',
      asOf: updatedAt ? new Date(updatedAt).toISOString() : '',
      updatedAt,
    };
  }
  const quote = quotes[symbol];
  if (!quote) return null;
  // A currency set after the quote was fetched still applies, unless the source said which it used.
  const nativeCurrency = (isCurrencyGuessed(quote) && own.quoteCurrency) || quote.currency;
  return {
    price: convertAmount(quote.price, nativeCurrency, currency, fx),
    nativePrice: quote.price,
    dayChangePercent: dayChangePercent(quote),
    nativeCurrency,
    source: 'quote',
    asOf: quote.asOf,
    updatedAt: quote.fetchedAt,
  };
}

/** Change from the previous close to the quoted price, as a percentage. */
export function dayChangePercent(quote: Pick<Quote, 'price' | 'previousClose'>): number | null {
  const previous = quote.previousClose;
  if (previous === undefined || !Number.isFinite(previous) || previous <= 0) return null;
  return ((quote.price - previous) / previous) * 100;
}

/**
 * Today's change in value of an open holding: the latest value less its value at the previous
 * close. `null` without a price or a day change.
 */
export function dayChangeValue(holding: Pick<Holding, 'quantity'>, price: ResolvedPrice | null | undefined): number | null {
  if (!price || price.price === null || price.dayChangePercent === null || holding.quantity <= EPSILON) return null;
  const value = price.price * holding.quantity;
  return value - value / (1 + price.dayChangePercent / 100);
}

export interface DayChangeTotal {
  /** Sum of today's change across holdings that have one. */
  change: number;
  /** The change as a percentage of those holdings' value at the previous close, or `null` when there are none. */
  percent: number | null;
  /** Open holdings without a day change. */
  missing: number;
}

/** Today's change across open holdings, counting the ones without a day change. */
export function totalDayChange(
  holdings: Holding[],
  prices: Record<string, ResolvedPrice | null | undefined>,
): DayChangeTotal {
  let change = 0;
  let previousValue = 0;
  let missing = 0;
  for (const holding of holdings) {
    if (holding.quantity <= EPSILON) continue;
    const price = prices[holding.symbol];
    const value = dayChangeValue(holding, price);
    if (value === null || !price?.price) {
      missing += 1;
      continue;
    }
    change += value;
    previousValue += price.price * holding.quantity - value;
  }
  return { change, percent: previousValue > EPSILON ? (change / previousValue) * 100 : null, missing };
}

export interface Unrealised {
  /** Latest price × shares. */
  marketValue: number;
  /** (Latest price − average cost) × shares. */
  gain: number;
  /** Gain as a percentage of the cost basis, or `null` when the basis is zero. */
  percent: number | null;
}

/** Unrealised gain of an open holding at `price` (in the ledger currency). */
export function unrealisedGain(holding: Pick<Holding, 'quantity' | 'averageCost' | 'costBasis'>, price: number | null | undefined): Unrealised | null {
  if (price === null || price === undefined || !Number.isFinite(price)) return null;
  if (holding.quantity <= EPSILON) return null;
  const gain = (price - holding.averageCost) * holding.quantity;
  return {
    marketValue: price * holding.quantity,
    gain,
    percent: holding.costBasis > EPSILON ? (gain / holding.costBasis) * 100 : null,
  };
}

export interface UnrealisedTotal {
  gain: number;
  marketValue: number;
  /** Cost basis of the holdings that have a price. */
  costBasis: number;
  /** Open holdings with a usable price. */
  priced: number;
  /** Open holdings without one. */
  missing: number;
}

/** Sum unrealised gains across open holdings, counting the ones without a price. */
export function totalUnrealised(
  holdings: Holding[],
  prices: Record<string, ResolvedPrice | null | undefined>,
): UnrealisedTotal {
  const total: UnrealisedTotal = { gain: 0, marketValue: 0, costBasis: 0, priced: 0, missing: 0 };
  for (const holding of holdings) {
    if (holding.quantity <= EPSILON) continue;
    const result = unrealisedGain(holding, prices[holding.symbol]?.price);
    if (!result) {
      total.missing += 1;
      continue;
    }
    total.priced += 1;
    total.gain += result.gain;
    total.marketValue += result.marketValue;
    total.costBasis += holding.costBasis;
  }
  return total;
}

export class PriceSourceError extends Error {
  constructor(
    message: string,
    /** True when the source refused because the key's allowance is used up. */
    readonly rateLimited = false,
  ) {
    super(message);
    this.name = 'PriceSourceError';
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** `{ previousClose }` when `value` is a usable price, else nothing. */
function previousCloseFrom(value: unknown): { previousClose?: number } {
  const previousClose = Number(value);
  return value !== undefined && value !== null && Number.isFinite(previousClose) && previousClose > 0 ? { previousClose } : {};
}

/** Read an Alpha Vantage `GLOBAL_QUOTE` response. */
export function parseAlphaVantageQuote(json: unknown): { price: number; previousClose?: number; asOf: string } {
  const record = asRecord(json);
  if (!record) throw new PriceSourceError('Unexpected response from Alpha Vantage.');
  const notice = record.Note ?? record.Information;
  if (typeof notice === 'string') {
    const limited = /limit|frequency|per day|premium/i.test(notice);
    throw new PriceSourceError(limited ? 'Alpha Vantage daily limit reached.' : notice, limited);
  }
  if (typeof record['Error Message'] === 'string') throw new PriceSourceError('Symbol not found.');
  const quote = asRecord(record['Global Quote']);
  const price = Number(quote?.['05. price']);
  if (!quote || !Number.isFinite(price) || price <= 0) throw new PriceSourceError('Symbol not found.');
  const day = quote['07. latest trading day'];
  return { price, ...previousCloseFrom(quote['08. previous close']), asOf: typeof day === 'string' ? day : '' };
}

/** Read a Finnhub `/quote` response (`c` is the current price, `pc` the previous close, `t` a unix time). */
export function parseFinnhubQuote(json: unknown): { price: number; previousClose?: number; asOf: string } {
  const record = asRecord(json);
  if (!record) throw new PriceSourceError('Unexpected response from Finnhub.');
  if (typeof record.error === 'string') {
    throw new PriceSourceError(record.error, /limit/i.test(record.error));
  }
  const price = Number(record.c);
  if (!Number.isFinite(price) || price <= 0) throw new PriceSourceError('Symbol not found.');
  const time = Number(record.t);
  return {
    price,
    ...previousCloseFrom(record.pc),
    asOf: Number.isFinite(time) && time > 0 ? new Date(time * 1000).toISOString() : '',
  };
}

export interface RelayQuote {
  price: number;
  previousClose?: number;
  currency: string;
  asOf: string;
}

/**
 * Read the relay's answer: a quote or an error message for each symbol asked.
 * Symbols missing from the answer get an error too.
 */
export function parseRelayResponse(json: unknown, asked: string[]): Record<string, RelayQuote | { error: string }> {
  const record = asRecord(json);
  const quotes = asRecord(record?.quotes);
  if (!record || !quotes) {
    throw new PriceSourceError(typeof record?.error === 'string' ? `Price relay: ${record.error}` : 'Unexpected response from the price relay.');
  }
  const errors = asRecord(record.errors) ?? {};
  const out: Record<string, RelayQuote | { error: string }> = {};
  for (const symbol of asked) {
    const quote = asRecord(quotes[symbol]);
    const price = Number(quote?.price);
    if (quote && Number.isFinite(price) && price > 0) {
      const time = Number(quote.time);
      out[symbol] = {
        price,
        ...previousCloseFrom(quote.previousClose),
        currency: typeof quote.currency === 'string' ? quote.currency : '',
        asOf: Number.isFinite(time) && time > 0 ? new Date(time * 1000).toISOString() : '',
      };
    } else {
      const error = errors[symbol];
      out[symbol] = { error: typeof error === 'string' ? error : 'Symbol not found.' };
    }
  }
  return out;
}

/** Read a Frankfurter `/latest` response. */
export function parseFxRates(json: unknown, fetchedAt: number): FxRates {
  const record = asRecord(json);
  const rates = asRecord(record?.rates);
  if (!record || typeof record.base !== 'string' || !rates) {
    throw new PriceSourceError('Unexpected exchange rate response.');
  }
  const clean: Record<string, number> = {};
  for (const [code, rate] of Object.entries(rates)) {
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) clean[code] = rate;
  }
  return { base: record.base, date: typeof record.date === 'string' ? record.date : '', rates: clean, fetchedAt };
}
