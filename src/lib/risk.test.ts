import { describe, expect, it } from 'vitest';

import { alignedReturns, analyseRisk, convertSeries, correlation, correlationPairs, fxSymbolFor, type PriceSeries } from './risk';

/** Weekday dates from 2026-01-05 onwards. */
function weekdays(count: number): string[] {
  const out: string[] = [];
  const date = new Date('2026-01-05T00:00:00Z');
  while (out.length < count) {
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) out.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return out;
}

/** A series whose daily returns are `returns`, starting at 100. */
function series(returns: number[], currency = 'GBP', dates = weekdays(returns.length + 1)): PriceSeries {
  const closes = [100];
  for (const change of returns) closes.push(closes[closes.length - 1] * (1 + change));
  return { currency, dates, closes };
}

/** Alternating up and down days, size `size`. */
function zigzag(days: number, size: number, offset = 0): number[] {
  return Array.from({ length: days }, (_, index) => ((index + offset) % 2 === 0 ? size : -size));
}

describe('fxSymbolFor', () => {
  it('names the Yahoo rate, treating pence as pounds', () => {
    expect(fxSymbolFor('USD', 'GBP')).toBe('USDGBP=X');
    expect(fxSymbolFor('GBp', 'GBP')).toBeNull();
    expect(fxSymbolFor('GBX', 'USD')).toBe('GBPUSD=X');
  });
});

describe('convertSeries', () => {
  it('uses each day’s rate or the last one before it, and drops days before the first rate', () => {
    const prices: PriceSeries = { currency: 'USD', dates: ['2026-01-01', '2026-01-02', '2026-01-05'], closes: [10, 11, 12] };
    const rate: PriceSeries = { currency: 'GBP', dates: ['2026-01-02', '2026-01-03'], closes: [0.8, 0.75] };
    expect(convertSeries(prices, rate)).toEqual({ currency: 'GBP', dates: ['2026-01-02', '2026-01-05'], closes: [8.8, 9] });
  });
});

describe('correlation', () => {
  it('is 1 for stocks in step, -1 for opposite and null with too few days', () => {
    const a = zigzag(40, 0.01);
    expect(correlation(a, a.map((value) => value * 2))).toBeCloseTo(1);
    expect(correlation(a, a.map((value) => -value))).toBeCloseTo(-1);
    expect(correlation(a.slice(0, 5), a.slice(0, 5))).toBeNull();
  });
});

describe('alignedReturns', () => {
  it('skips days only a minority traded and carries the last close over gaps', () => {
    const stock: PriceSeries = { currency: 'GBP', dates: ['2026-01-02', '2026-01-05', '2026-01-06'], closes: [100, 110, 121] };
    const other: PriceSeries = { currency: 'GBP', dates: ['2026-01-02', '2026-01-05', '2026-01-06'], closes: [50, 50, 55] };
    // A coin that also trades at the weekend.
    const coin: PriceSeries = { currency: 'GBP', dates: ['2026-01-02', '2026-01-03', '2026-01-05', '2026-01-06'], closes: [10, 20, 11, 11] };
    const { dates, returns } = alignedReturns([stock, other, coin]);
    expect(dates).toEqual(['2026-01-05', '2026-01-06']);
    expect(returns[0].map((value) => value?.toFixed(2))).toEqual(['0.10', '0.10']);
    // The weekend move rolls into Monday.
    expect(returns[2].map((value) => value?.toFixed(2))).toEqual(['0.10', '0.00']);
  });
});

describe('analyseRisk', () => {
  it('works out yearly volatility, share of swings and diversification', () => {
    const days = 60;
    const steady = series(zigzag(days, 0.005));
    const wild = series(zigzag(days, 0.02));
    // Moves opposite to `steady`, so holding both cancels out some swings.
    const hedge = series(zigzag(days, 0.005, 1));
    const report = analyseRisk(
      [
        { symbol: 'STEADY', name: 'Steady', value: 1000, series: steady },
        { symbol: 'WILD', name: 'Wild', value: 1000, series: wild },
        { symbol: 'HEDGE', name: 'Hedge', value: 1000, series: hedge },
      ],
      steady,
    );
    const [steadyRisk, wildRisk, hedgeRisk] = report.stocks;
    // A 0.5% daily swing is about 8% a year over ~252 trading days.
    expect(steadyRisk.volatility).toBeGreaterThan(0.07);
    expect(steadyRisk.volatility).toBeLessThan(0.09);
    expect(wildRisk.volatility! / steadyRisk.volatility!).toBeCloseTo(4, 0);
    expect(steadyRisk.weight).toBeCloseTo(1 / 3);
    expect(steadyRisk.benchmarkCorrelation).toBeCloseTo(1);
    expect(hedgeRisk.benchmarkCorrelation).toBeCloseTo(-1);
    // Shares of swings add up to the whole, and the wild stock causes them all here.
    const shares = report.stocks.reduce((sum, stock) => sum + (stock.riskShare ?? 0), 0);
    expect(shares).toBeCloseTo(1);
    expect(wildRisk.riskShare).toBeCloseTo(1);
    expect(report.portfolioVolatility!).toBeLessThan(report.averageVolatility!);
    expect(report.correlations[0][2]).toBeCloseTo(-1);
    expect(correlationPairs(report)[0].correlation).toBeCloseTo(1);
    expect(steadyRisk.worstDay?.change).toBeCloseTo(-0.005);
  });

  it('leaves figures out when there is too little history', () => {
    const report = analyseRisk([{ symbol: 'NEW', name: 'New', value: 500, series: series(zigzag(5, 0.01)) }], null);
    expect(report.stocks[0].volatility).toBeNull();
    expect(report.portfolioVolatility).toBeNull();
    expect(report.benchmarkVolatility).toBeNull();
  });

  it('only uses the last year', () => {
    const dates = weekdays(421);
    const returns = [...zigzag(150, 0.05), ...zigzag(270, 0.005)];
    const report = analyseRisk([{ symbol: 'A', name: 'A', value: 1, series: series(returns, 'GBP', dates) }], null);
    // The wild early months are more than a year before the last price.
    expect(report.stocks[0].volatility).toBeLessThan(0.1);
  });
});
