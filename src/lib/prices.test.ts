import { describe, it, expect } from 'vitest';

import { computePortfolio, makeTransaction, type TransactionInput } from '@/lib/portfolio';
import {
  convertAmount,
  DEFAULT_PRICE_SETTINGS,
  parseAlphaVantageQuote,
  parseFinnhubQuote,
  parseFxRates,
  planQuote,
  PriceSourceError,
  quoteCurrencyFor,
  quoteSymbolFor,
  resolvePrice,
  totalUnrealised,
  unrealisedGain,
  type FxRates,
  type PriceSettings,
  type Quote,
} from '@/lib/prices';

// ECB-style rates against the euro: 1 EUR = 0.85 GBP = 1.10 USD.
const fx: FxRates = { base: 'EUR', date: '2026-09-29', rates: { GBP: 0.85, USD: 1.1, CHF: 0.95 }, fetchedAt: 0 };

let seq = 0;
function trade(input: Partial<TransactionInput> & Pick<TransactionInput, 'type' | 'quantity' | 'price'>) {
  seq += 1;
  return makeTransaction({ symbol: 'AAPL', date: '2024-01-10', fees: 0, account: 'ISA', ...input }, `tx-${seq}`);
}

function quote(price: number, currency: string): Quote {
  return { price, currency, asOf: '2026-09-29', fetchedAt: 1000, provider: 'alphavantage', quoteSymbol: 'X' };
}

function settingsWith(patch: Partial<PriceSettings>): PriceSettings {
  return { ...DEFAULT_PRICE_SETTINGS, ...patch };
}

describe('symbols and currencies', () => {
  it('maps Yahoo-style suffixes to Alpha Vantage ones', () => {
    expect(quoteSymbolFor('aapl')).toBe('AAPL');
    expect(quoteSymbolFor('VOD.L')).toBe('VOD.LON');
    expect(quoteSymbolFor('SAP.DE')).toBe('SAP.DEX');
    expect(quoteSymbolFor('MC.PA')).toBe('MC.PAR');
    expect(quoteSymbolFor('ASML.AS')).toBe('ASML.AMS');
    expect(quoteSymbolFor('BP.LON')).toBe('BP.LON');
    expect(quoteSymbolFor('BRK.B')).toBe('BRK.B');
  });

  it('infers the quote currency from the exchange', () => {
    expect(quoteCurrencyFor('AAPL')).toBe('USD');
    expect(quoteCurrencyFor('VOD.LON')).toBe('GBX');
    expect(quoteCurrencyFor('SAP.DEX')).toBe('EUR');
    expect(quoteCurrencyFor('NESN.SW')).toBe('CHF');
  });

  it('sends US tickers to Finnhub only when its key is set', () => {
    const avOnly = settingsWith({ alphaVantageKey: 'av' });
    const both = settingsWith({ alphaVantageKey: 'av', finnhubKey: 'fh' });
    expect(planQuote('AAPL', avOnly)?.provider).toBe('alphavantage');
    expect(planQuote('AAPL', both)?.provider).toBe('finnhub');
    expect(planQuote('VOD.L', both)).toEqual({ provider: 'alphavantage', quoteSymbol: 'VOD.LON', currency: 'GBX' });
    expect(planQuote('VOD.L', settingsWith({ finnhubKey: 'fh' }))).toBeNull();
    expect(planQuote('AAPL', DEFAULT_PRICE_SETTINGS)).toBeNull();
  });

  it('uses the symbol overrides', () => {
    const settings = settingsWith({
      alphaVantageKey: 'av',
      symbols: { VOD: { quoteSymbol: 'vod.lon' }, RDSB: { quoteSymbol: 'SHEL.LON', quoteCurrency: 'GBP' } },
    });
    expect(planQuote('VOD', settings)).toEqual({ provider: 'alphavantage', quoteSymbol: 'VOD.LON', currency: 'GBX' });
    expect(planQuote('RDSB', settings)?.currency).toBe('GBP');
  });
});

describe('convertAmount', () => {
  it('returns the amount unchanged in the same currency', () => {
    expect(convertAmount(12.5, 'GBP', 'GBP', null)).toBe(12.5);
  });

  it('turns pence into pounds without needing rates', () => {
    expect(convertAmount(245, 'GBX', 'GBP', null)).toBeCloseTo(2.45);
    expect(convertAmount(245, 'GBp', 'GBP', null)).toBeCloseTo(2.45);
  });

  it('converts through the rate base', () => {
    // 110 USD = 100 EUR = 85 GBP
    expect(convertAmount(110, 'USD', 'GBP', fx)).toBeCloseTo(85);
    expect(convertAmount(100, 'EUR', 'GBP', fx)).toBeCloseTo(85);
    expect(convertAmount(85, 'GBP', 'EUR', fx)).toBeCloseTo(100);
    expect(convertAmount(100, 'GBX', 'USD', fx)).toBeCloseTo(1.1 / 0.85);
  });

  it('returns null when a rate is missing', () => {
    expect(convertAmount(10, 'USD', 'GBP', null)).toBeNull();
    expect(convertAmount(10, 'JPY', 'GBP', fx)).toBeNull();
  });
});

describe('resolvePrice', () => {
  it('converts a fetched quote to the ledger currency', () => {
    const price = resolvePrice('AAPL', DEFAULT_PRICE_SETTINGS, { AAPL: quote(220, 'USD') }, fx, 'GBP');
    expect(price?.source).toBe('quote');
    expect(price?.price).toBeCloseTo(170);
    expect(price?.nativePrice).toBe(220);
  });

  it('prefers a manual price, in the quote currency by default', () => {
    const settings = settingsWith({ symbols: { 'VOD.L': { manualPrice: 72, manualUpdatedAt: 5 } } });
    const price = resolvePrice('VOD.L', settings, { 'VOD.L': quote(80, 'GBX') }, fx, 'GBP');
    expect(price).toMatchObject({ source: 'manual', nativeCurrency: 'GBX', updatedAt: 5 });
    expect(price?.price).toBeCloseTo(0.72);
  });

  it('uses the manual price currency when set', () => {
    const settings = settingsWith({ symbols: { AAPL: { manualPrice: 150, manualCurrency: 'GBP' } } });
    expect(resolvePrice('AAPL', settings, {}, null, 'GBP')?.price).toBe(150);
  });

  it('applies a quote currency set after the quote was fetched', () => {
    const settings = settingsWith({ symbols: { SHEL: { quoteCurrency: 'GBX' } } });
    expect(resolvePrice('SHEL', settings, { SHEL: quote(2500, 'USD') }, fx, 'GBP')?.price).toBeCloseTo(25);
  });

  it('keeps the native price when there is no exchange rate', () => {
    const price = resolvePrice('AAPL', DEFAULT_PRICE_SETTINGS, { AAPL: quote(220, 'USD') }, null, 'GBP');
    expect(price).toMatchObject({ price: null, nativePrice: 220, nativeCurrency: 'USD' });
  });

  it('returns null with no quote and no manual price', () => {
    expect(resolvePrice('AAPL', DEFAULT_PRICE_SETTINGS, {}, fx, 'GBP')).toBeNull();
  });
});

describe('unrealisedGain', () => {
  it('is (latest price - average cost) x shares, with fees in the cost', () => {
    const [holding] = computePortfolio([trade({ type: 'buy', quantity: 10, price: 100, fees: 10 })]).openHoldings;
    // Average cost 101, so a price of 120 gains 19 a share.
    expect(unrealisedGain(holding, 120)).toEqual({ marketValue: 1200, gain: 190, percent: (190 / 1010) * 100 });
  });

  it('uses the remaining shares after a partial sell', () => {
    const [holding] = computePortfolio([
      trade({ type: 'buy', quantity: 10, price: 100 }),
      trade({ type: 'buy', quantity: 10, price: 200, date: '2024-02-01' }),
      trade({ type: 'sell', quantity: 5, price: 180, date: '2024-03-01' }),
    ]).openHoldings;
    // Average cost 150 on 15 shares.
    expect(unrealisedGain(holding, 130)?.gain).toBeCloseTo(-300);
  });

  it('returns null without a price or for a closed position', () => {
    const portfolio = computePortfolio([
      trade({ type: 'buy', quantity: 5, price: 10 }),
      trade({ type: 'sell', quantity: 5, price: 12, date: '2024-02-01' }),
    ]);
    expect(unrealisedGain(portfolio.closedHoldings[0], 20)).toBeNull();
    expect(unrealisedGain({ quantity: 5, averageCost: 10, costBasis: 50 }, null)).toBeNull();
  });
});

describe('totalUnrealised', () => {
  it('sums priced holdings and counts the unpriced ones', () => {
    const { openHoldings } = computePortfolio([
      trade({ type: 'buy', symbol: 'AAPL', quantity: 10, price: 100 }),
      trade({ type: 'buy', symbol: 'AAPL', quantity: 5, price: 100, account: 'GIA' }),
      trade({ type: 'buy', symbol: 'VOD.L', quantity: 100, price: 1 }),
      trade({ type: 'buy', symbol: 'MSFT', quantity: 1, price: 300 }),
    ]);
    const base = { nativePrice: 0, nativeCurrency: 'GBP', source: 'quote' as const, asOf: '', updatedAt: 0 };
    const total = totalUnrealised(openHoldings, {
      AAPL: { ...base, price: 110 },
      'VOD.L': { ...base, price: 0.8 },
      MSFT: { ...base, price: null },
    });
    // AAPL: +10 x 15 shares across both accounts; VOD: -0.2 x 100.
    expect(total.gain).toBeCloseTo(150 - 20);
    expect(total.marketValue).toBeCloseTo(1650 + 80);
    expect(total.costBasis).toBeCloseTo(1600);
    expect(total.priced).toBe(3);
    expect(total.missing).toBe(1);
  });
});

describe('response parsers', () => {
  it('reads an Alpha Vantage quote', () => {
    const json = { 'Global Quote': { '01. symbol': 'VOD.LON', '05. price': '72.4600', '07. latest trading day': '2026-09-29' } };
    expect(parseAlphaVantageQuote(json)).toEqual({ price: 72.46, asOf: '2026-09-29' });
  });

  it('flags Alpha Vantage limits and unknown symbols', () => {
    const limited = () =>
      parseAlphaVantageQuote({ Information: 'Our standard API rate limit is 25 requests per day.' });
    expect(limited).toThrow(PriceSourceError);
    try {
      limited();
    } catch (error) {
      expect((error as PriceSourceError).rateLimited).toBe(true);
    }
    expect(() => parseAlphaVantageQuote({ 'Global Quote': {} })).toThrow('Symbol not found.');
  });

  it('reads a Finnhub quote and rejects unknown symbols', () => {
    expect(parseFinnhubQuote({ c: 227.5, t: 1790000000 })).toEqual({
      price: 227.5,
      asOf: new Date(1790000000 * 1000).toISOString(),
    });
    expect(() => parseFinnhubQuote({ c: 0, t: 0 })).toThrow('Symbol not found.');
  });

  it('reads Frankfurter rates, dropping bad values', () => {
    const rates = parseFxRates({ base: 'EUR', date: '2026-09-29', rates: { GBP: 0.85, XXX: 'no', ZZZ: 0 } }, 7);
    expect(rates).toEqual({ base: 'EUR', date: '2026-09-29', rates: { GBP: 0.85 }, fetchedAt: 7 });
    expect(() => parseFxRates({ nope: true }, 0)).toThrow(PriceSourceError);
  });
});
