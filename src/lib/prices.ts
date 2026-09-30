/**
 * Latest prices, currency conversion and unrealised gains.
 *
 * Everything here is pure so the maths can be unit tested; the network calls
 * live in `priceSources.ts` and the React state in `usePrices`.
 */

import type { Holding } from './portfolio';

const EPSILON = 1e-9;

export type PriceProviderId = 'alphavantage' | 'finnhub';

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
  alphaVantageKey: string;
  finnhubKey: string;
  symbols: Record<string, SymbolPriceSettings>;
}

export const DEFAULT_PRICE_SETTINGS: PriceSettings = { alphaVantageKey: '', finnhubKey: '', symbols: {} };

/** A price fetched from a source, in the currency the source quotes. */
export interface Quote {
  price: number;
  currency: string;
  /** When the market data is from: an ISO date (`YYYY-MM-DD`) or date-time. */
  asOf: string;
  /** When it was fetched (ms since epoch). */
  fetchedAt: number;
  provider: PriceProviderId;
  /** The symbol the source was asked for. */
  quoteSymbol: string;
}

/** Exchange rates: one unit of `base` buys `rates[code]` of each currency. */
export interface FxRates {
  base: string;
  /** Date the rates are for (`YYYY-MM-DD`). */
  date: string;
  rates: Record<string, number>;
  fetchedAt: number;
}

/** What to show for a symbol after picking manual vs fetched and converting. */
export interface ResolvedPrice {
  /** Price in the ledger currency, or `null` when there is no exchange rate for it. */
  price: number | null;
  /** The price as entered or quoted, before conversion. */
  nativePrice: number;
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

export interface QuotePlan {
  provider: PriceProviderId;
  quoteSymbol: string;
  currency: string;
}

/**
 * Decide which source to ask for a symbol, or `null` when no key can price it.
 * US tickers go to Finnhub when its key is set (it allows far more calls);
 * everything else goes to Alpha Vantage.
 */
export function planQuote(symbol: string, settings: PriceSettings): QuotePlan | null {
  const own = settings.symbols[symbol] ?? {};
  const quoteSymbol = own.quoteSymbol?.trim().toUpperCase() || quoteSymbolFor(symbol);
  const currency = own.quoteCurrency || quoteCurrencyFor(quoteSymbol);
  if (settings.finnhubKey.trim() && isUsSymbol(quoteSymbol)) {
    return { provider: 'finnhub', quoteSymbol, currency };
  }
  if (settings.alphaVantageKey.trim()) return { provider: 'alphavantage', quoteSymbol, currency };
  return null;
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
      nativeCurrency,
      source: 'manual',
      asOf: updatedAt ? new Date(updatedAt).toISOString() : '',
      updatedAt,
    };
  }
  const quote = quotes[symbol];
  if (!quote) return null;
  // A currency set after the quote was fetched still applies.
  const nativeCurrency = own.quoteCurrency || quote.currency;
  return {
    price: convertAmount(quote.price, nativeCurrency, currency, fx),
    nativePrice: quote.price,
    nativeCurrency,
    source: 'quote',
    asOf: quote.asOf,
    updatedAt: quote.fetchedAt,
  };
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

/** Read an Alpha Vantage `GLOBAL_QUOTE` response. */
export function parseAlphaVantageQuote(json: unknown): { price: number; asOf: string } {
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
  return { price, asOf: typeof day === 'string' ? day : '' };
}

/** Read a Finnhub `/quote` response (`c` is the current price, `t` a unix time). */
export function parseFinnhubQuote(json: unknown): { price: number; asOf: string } {
  const record = asRecord(json);
  if (!record) throw new PriceSourceError('Unexpected response from Finnhub.');
  if (typeof record.error === 'string') {
    throw new PriceSourceError(record.error, /limit/i.test(record.error));
  }
  const price = Number(record.c);
  if (!Number.isFinite(price) || price <= 0) throw new PriceSourceError('Symbol not found.');
  const time = Number(record.t);
  return { price, asOf: Number.isFinite(time) && time > 0 ? new Date(time * 1000).toISOString() : '' };
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
