import { describe, it, expect } from 'vitest';
import {
  computePortfolio,
  makeTransaction,
  sortByDate,
  type Holding,
  type Transaction,
  type TransactionInput,
} from '@/lib/portfolio';

let seq = 0;

function tx(input: Partial<TransactionInput> & Pick<TransactionInput, 'type' | 'quantity' | 'price'>): Transaction {
  seq += 1;
  return makeTransaction(
    { symbol: 'AAPL', date: '2024-01-01', fees: 0, ...input },
    `tx-${seq}`,
  );
}

function holding(transactions: Transaction[], symbol = 'AAPL'): Holding {
  const found = computePortfolio(transactions).holdings.find((h) => h.symbol === symbol);
  if (!found) throw new Error(`No holding for ${symbol}`);
  return found;
}

/** Mirrors the share calculation in `AllocationBars`. */
function allocation(holdings: Holding[]): Record<string, number> {
  const total = holdings.reduce((sum, h) => sum + h.costBasis, 0);
  return Object.fromEntries(holdings.map((h) => [h.symbol, (h.costBasis / total) * 100]));
}

describe('computePortfolio', () => {
  describe('buys', () => {
    it('includes buy fees in cost basis and average cost', () => {
      const h = holding([tx({ type: 'buy', quantity: 10, price: 100, fees: 5 })]);

      expect(h.quantity).toBe(10);
      expect(h.costBasis).toBeCloseTo(1005);
      expect(h.averageCost).toBeCloseTo(100.5);
      expect(h.totalBought).toBeCloseTo(1005);
      expect(h.totalFees).toBe(5);
      expect(h.realizedPnl).toBe(0);
    });

    it('averages cost across multiple buys at different prices', () => {
      const h = holding([
        tx({ type: 'buy', quantity: 10, price: 100, date: '2024-01-01' }),
        tx({ type: 'buy', quantity: 30, price: 120, fees: 4, date: '2024-02-01' }),
      ]);

      expect(h.quantity).toBe(40);
      expect(h.costBasis).toBeCloseTo(1000 + 3600 + 4);
      expect(h.averageCost).toBeCloseTo(4604 / 40);
      expect(h.transactionCount).toBe(2);
    });

    it('supports fractional shares', () => {
      const h = holding([
        tx({ type: 'buy', quantity: 0.5, price: 200 }),
        tx({ type: 'buy', quantity: 0.25, price: 400 }),
      ]);

      expect(h.quantity).toBeCloseTo(0.75);
      expect(h.costBasis).toBeCloseTo(200);
      expect(h.averageCost).toBeCloseTo(266.6667, 4);
    });
  });

  describe('sells', () => {
    it('realizes P&L against average cost on a partial sell', () => {
      const h = holding([
        tx({ type: 'buy', quantity: 10, price: 100, fees: 10, date: '2024-01-01' }),
        tx({ type: 'sell', quantity: 4, price: 150, fees: 2, date: '2024-02-01' }),
      ]);

      // avg cost = 1010 / 10 = 101; cost of sold = 404; proceeds = 600 - 2 = 598
      expect(h.realizedPnl).toBeCloseTo(598 - 404);
      expect(h.quantity).toBe(6);
      expect(h.costBasis).toBeCloseTo(606);
      expect(h.averageCost).toBeCloseTo(101);
      expect(h.totalSold).toBeCloseTo(598);
      expect(h.totalFees).toBe(12);
    });

    it('keeps average cost unchanged after a partial sell, then re-averages on the next buy', () => {
      const h = holding([
        tx({ type: 'buy', quantity: 10, price: 100, date: '2024-01-01' }),
        tx({ type: 'sell', quantity: 5, price: 80, date: '2024-02-01' }),
        tx({ type: 'buy', quantity: 5, price: 60, date: '2024-03-01' }),
      ]);

      expect(h.realizedPnl).toBeCloseTo(400 - 500);
      expect(h.quantity).toBe(10);
      expect(h.costBasis).toBeCloseTo(500 + 300);
      expect(h.averageCost).toBeCloseTo(80);
    });

    it('closes the position on a full sell and zeroes basis and average cost', () => {
      const summary = computePortfolio([
        tx({ type: 'buy', quantity: 10, price: 100, fees: 5, date: '2024-01-01' }),
        tx({ type: 'sell', quantity: 10, price: 90, fees: 5, date: '2024-02-01' }),
      ]);
      const [h] = summary.holdings;

      expect(h.quantity).toBe(0);
      expect(h.costBasis).toBeCloseTo(0);
      expect(h.averageCost).toBe(0);
      expect(h.realizedPnl).toBeCloseTo(895 - 1005);
      expect(summary.openHoldings).toHaveLength(0);
      expect(summary.closedHoldings.map((c) => c.symbol)).toEqual(['AAPL']);
      expect(summary.totalCostBasis).toBe(0);
    });

    it('accumulates realized P&L across several sells', () => {
      const h = holding([
        tx({ type: 'buy', quantity: 9, price: 10, date: '2024-01-01' }),
        tx({ type: 'sell', quantity: 3, price: 12, date: '2024-02-01' }),
        tx({ type: 'sell', quantity: 3, price: 8, date: '2024-03-01' }),
        tx({ type: 'sell', quantity: 3, price: 20, date: '2024-04-01' }),
      ]);

      expect(h.realizedPnl).toBeCloseTo(6 - 6 + 30);
      expect(h.quantity).toBe(0);
      expect(h.totalSold).toBeCloseTo(36 + 24 + 60);
    });

    it('treats a fractional round trip that nets to ~0 shares as closed', () => {
      const summary = computePortfolio([
        tx({ type: 'buy', quantity: 0.1, price: 100, date: '2024-01-01' }),
        tx({ type: 'buy', quantity: 0.2, price: 100, date: '2024-01-02' }),
        tx({ type: 'sell', quantity: 0.3, price: 110, date: '2024-01-03' }),
      ]);

      expect(summary.openHoldings).toHaveLength(0);
      expect(summary.holdings[0].averageCost).toBe(0);
      expect(summary.holdings[0].realizedPnl).toBeCloseTo(3);
    });
  });

  describe('multiple tickers', () => {
    const transactions = [
      tx({ symbol: 'msft', type: 'buy', quantity: 5, price: 300, date: '2024-01-05' }),
      tx({ symbol: 'AAPL', type: 'buy', quantity: 10, price: 150, fees: 1, date: '2024-01-02' }),
      tx({ symbol: 'TSLA', type: 'buy', quantity: 2, price: 200, date: '2024-01-03' }),
      tx({ symbol: 'TSLA', type: 'sell', quantity: 2, price: 250, fees: 1, date: '2024-03-01' }),
      tx({ symbol: 'AAPL', type: 'sell', quantity: 5, price: 170, fees: 1, date: '2024-02-01' }),
    ];

    it('tracks each symbol independently and normalizes case', () => {
      const summary = computePortfolio(transactions);

      expect(summary.symbols).toEqual(['AAPL', 'MSFT', 'TSLA']);
      expect(holding(transactions, 'MSFT').costBasis).toBeCloseTo(1500);
      expect(holding(transactions, 'AAPL').realizedPnl).toBeCloseTo(849 - 750.5);
      expect(holding(transactions, 'TSLA').realizedPnl).toBeCloseTo(499 - 400);
    });

    it('sums totals across symbols', () => {
      const summary = computePortfolio(transactions);

      expect(summary.totalCostBasis).toBeCloseTo(1500 + 750.5);
      expect(summary.totalRealizedPnl).toBeCloseTo(98.5 + 99);
      expect(summary.totalInvested).toBeCloseTo(1500 + 1501 + 400);
      expect(summary.totalProceeds).toBeCloseTo(849 + 499);
      expect(summary.totalFees).toBe(3);
      expect(summary.transactionCount).toBe(5);
    });

    it('splits open and closed holdings and orders holdings by cost basis', () => {
      const summary = computePortfolio(transactions);

      expect(summary.holdings.map((h) => h.symbol)).toEqual(['MSFT', 'AAPL', 'TSLA']);
      expect(summary.openHoldings.map((h) => h.symbol)).toEqual(['MSFT', 'AAPL']);
      expect(summary.closedHoldings.map((h) => h.symbol)).toEqual(['TSLA']);
    });

    it('gives an allocation over open cost basis that sums to 100%', () => {
      const shares = allocation(computePortfolio(transactions).openHoldings);

      expect(shares.MSFT).toBeCloseTo((1500 / 2250.5) * 100);
      expect(shares.AAPL).toBeCloseTo((750.5 / 2250.5) * 100);
      expect(shares.TSLA).toBeUndefined();
      expect(Object.values(shares).reduce((a, b) => a + b, 0)).toBeCloseTo(100);
    });
  });

  describe('ordering and dates', () => {
    it('processes transactions by date regardless of input order', () => {
      const h = holding([
        tx({ type: 'sell', quantity: 5, price: 20, date: '2024-02-01' }),
        tx({ type: 'buy', quantity: 10, price: 10, date: '2024-01-01' }),
      ]);

      expect(h.realizedPnl).toBeCloseTo(50);
      expect(h.quantity).toBe(5);
      expect(h.firstDate).toBe('2024-01-01');
      expect(h.lastDate).toBe('2024-02-01');
    });

    it('sortByDate is stable for same-day entries and does not mutate its input', () => {
      const a = tx({ type: 'buy', quantity: 1, price: 1, date: '2024-01-02' });
      const b = tx({ type: 'buy', quantity: 1, price: 1, date: '2024-01-01' });
      const c = tx({ type: 'sell', quantity: 1, price: 1, date: '2024-01-02' });
      const input = [a, b, c];

      expect(sortByDate(input)).toEqual([b, a, c]);
      expect(input).toEqual([a, b, c]);
    });
  });

  describe('edge cases', () => {
    it('returns an empty summary for no transactions', () => {
      const summary = computePortfolio([]);

      expect(summary.holdings).toEqual([]);
      expect(summary.symbols).toEqual([]);
      expect(summary.totalCostBasis).toBe(0);
      expect(summary.totalRealizedPnl).toBe(0);
      expect(summary.transactionCount).toBe(0);
    });

    it('skips transactions with a blank symbol', () => {
      const summary = computePortfolio([tx({ symbol: '   ', type: 'buy', quantity: 1, price: 1 })]);

      expect(summary.holdings).toEqual([]);
      expect(summary.symbols).toEqual([]);
    });

    it('handles a zero-price buy (e.g. a stock grant)', () => {
      const h = holding([
        tx({ type: 'buy', quantity: 10, price: 0, date: '2024-01-01' }),
        tx({ type: 'sell', quantity: 5, price: 10, date: '2024-02-01' }),
      ]);

      expect(h.averageCost).toBe(0);
      expect(h.realizedPnl).toBeCloseTo(50);
    });

    it('keeps the first recorded name for a symbol', () => {
      const h = holding([
        tx({ type: 'buy', quantity: 1, price: 1, date: '2024-01-01' }),
        tx({ name: 'Apple Inc.', type: 'buy', quantity: 1, price: 1, date: '2024-01-02' }),
        tx({ name: 'Apple', type: 'buy', quantity: 1, price: 1, date: '2024-01-03' }),
      ]);

      expect(h.name).toBe('Apple Inc.');
    });
  });

  // These pin the current behavior of cases that look wrong. See the PR description;
  // update the expectations if the math is changed.
  describe('current behavior of suspect cases', () => {
    it('overselling counts proceeds for all shares but cost only for shares held', () => {
      const h = holding([
        tx({ type: 'buy', quantity: 10, price: 10, date: '2024-01-01' }),
        tx({ type: 'sell', quantity: 15, price: 12, date: '2024-02-01' }),
      ]);

      // 15 * 12 = 180 proceeds against a cost of 10 * 10 = 100.
      // Matching only the 10 held shares would give 120 - 100 = 20.
      expect(h.realizedPnl).toBeCloseTo(80);
      expect(h.quantity).toBe(0);
      expect(h.totalSold).toBeCloseTo(180);
    });

    it('a sell with no prior position books the entire proceeds as profit', () => {
      const h = holding([tx({ type: 'sell', quantity: 5, price: 20 })]);

      expect(h.realizedPnl).toBeCloseTo(100);
      expect(h.quantity).toBe(0);
    });

    it('a same-day sell entered before its buy is processed first', () => {
      const h = holding([
        tx({ type: 'sell', quantity: 5, price: 20, date: '2024-01-01' }),
        tx({ type: 'buy', quantity: 5, price: 10, date: '2024-01-01' }),
      ]);

      // Buy-then-sell would realize 100 - 50 = 50 and leave 0 shares.
      expect(h.realizedPnl).toBeCloseTo(100);
      expect(h.quantity).toBe(5);
    });
  });
});
