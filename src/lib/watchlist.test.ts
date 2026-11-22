import { describe, expect, it } from 'vitest';

import { addToWatchlist, parseLedger, parseWatchlist, removeFromWatchlist, type Ledger } from './portfolio';

const empty: Ledger = { transactions: [], cash: [], labels: [], accounts: [], stockNotes: {}, watchlist: [] };

describe('watchlist', () => {
  it('adds a stock with an upper-cased symbol and today as the date', () => {
    const ledger = addToWatchlist(empty, ' vod.l ', ' Vodafone ');
    expect(ledger.watchlist).toHaveLength(1);
    expect(ledger.watchlist[0]).toMatchObject({ symbol: 'VOD.L', name: 'Vodafone' });
    expect(ledger.watchlist[0].addedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('does not add a symbol twice, but updates its name', () => {
    let ledger = addToWatchlist(empty, 'AAPL');
    ledger = addToWatchlist(ledger, 'aapl', 'Apple Inc.');
    expect(ledger.watchlist).toEqual([expect.objectContaining({ symbol: 'AAPL', name: 'Apple Inc.' })]);
    // Adding again without a name keeps the one it has.
    ledger = addToWatchlist(ledger, 'AAPL');
    expect(ledger.watchlist[0].name).toBe('Apple Inc.');
  });

  it('ignores a blank symbol', () => {
    expect(addToWatchlist(empty, '   ')).toBe(empty);
  });

  it('removes a stock by symbol, in any case', () => {
    const ledger = addToWatchlist(addToWatchlist(empty, 'AAPL'), 'MSFT');
    expect(removeFromWatchlist(ledger, 'aapl').watchlist.map((item) => item.symbol)).toEqual(['MSFT']);
  });

  it('drops malformed and repeated entries when parsing', () => {
    expect(
      parseWatchlist([
        { symbol: 'aapl', name: 'Apple', addedOn: '2026-11-01' },
        { symbol: 'AAPL', name: 'Again' },
        { name: 'No symbol' },
        'junk',
        { symbol: 'TSLA', addedOn: 'not a date' },
      ]),
    ).toEqual([
      { symbol: 'AAPL', name: 'Apple', addedOn: '2026-11-01' },
      expect.objectContaining({ symbol: 'TSLA', name: undefined }),
    ]);
    expect(parseWatchlist('nope')).toEqual([]);
  });

  it('reads older payloads without a watchlist as an empty one', () => {
    expect(parseLedger({ version: 5, transactions: [], stockNotes: {} }).watchlist).toEqual([]);
    expect(parseLedger([]).watchlist).toEqual([]);
    expect(parseLedger({ version: 6, watchlist: [{ symbol: 'BP.L', addedOn: '2026-11-22' }] }).watchlist).toEqual([
      { symbol: 'BP.L', name: undefined, addedOn: '2026-11-22' },
    ]);
  });
});
