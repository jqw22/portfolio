import { describe, expect, it } from 'vitest';

import {
  addToWatchlist,
  parseLedger,
  parseWatchlist,
  removeFromWatchlist,
  restoreWatchItem,
  setWatchTrigger,
  triggerReached,
  type Ledger,
} from './portfolio';

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

  it('sets a trigger below the latest price to fire when the price falls to it', () => {
    let ledger = addToWatchlist(empty, 'VOD.L');
    ledger = setWatchTrigger(ledger, 'vod.l', 0.65, 0.71);
    const item = ledger.watchlist[0];
    expect(item).toMatchObject({ triggerPrice: 0.65, triggerWhen: 'below' });
    expect(triggerReached(item, 0.7)).toBe(false);
    expect(triggerReached(item, 0.65)).toBe(true);
    expect(triggerReached(item, 0.6)).toBe(true);
  });

  it('sets a trigger above the latest price to fire when the price rises to it', () => {
    const item = setWatchTrigger(addToWatchlist(empty, 'NVDA'), 'NVDA', 150, 134.7).watchlist[0];
    expect(item.triggerWhen).toBe('above');
    expect(triggerReached(item, 149.99)).toBe(false);
    expect(triggerReached(item, 151)).toBe(true);
  });

  it('keeps a trigger with no direction when there is no price, and clears it', () => {
    let ledger = setWatchTrigger(addToWatchlist(empty, 'GRF.MC'), 'GRF.MC', 10, null);
    expect(ledger.watchlist[0]).toMatchObject({ triggerPrice: 10 });
    expect(ledger.watchlist[0].triggerWhen).toBeUndefined();
    expect(triggerReached(ledger.watchlist[0], 9)).toBeNull();
    ledger = setWatchTrigger(ledger, 'GRF.MC', undefined);
    expect(ledger.watchlist[0].triggerPrice).toBeUndefined();
    // A zero or negative trigger counts as clearing it.
    expect(setWatchTrigger(ledger, 'GRF.MC', 0, 5).watchlist[0].triggerPrice).toBeUndefined();
  });

  it('parses stored triggers and drops invalid ones', () => {
    expect(
      parseWatchlist([
        { symbol: 'A', addedOn: '2026-11-01', triggerPrice: 12.5, triggerWhen: 'above' },
        { symbol: 'B', addedOn: '2026-11-01', triggerPrice: -1, triggerWhen: 'below' },
        { symbol: 'C', addedOn: '2026-11-01', triggerPrice: 3, triggerWhen: 'sideways' },
      ]),
    ).toEqual([
      { symbol: 'A', name: undefined, addedOn: '2026-11-01', triggerPrice: 12.5, triggerWhen: 'above' },
      { symbol: 'B', name: undefined, addedOn: '2026-11-01' },
      { symbol: 'C', name: undefined, addedOn: '2026-11-01', triggerPrice: 3 },
    ]);
  });

  it('restores a removed item with its date and trigger', () => {
    const item = { symbol: 'AAPL', name: 'Apple', addedOn: '2026-10-01', triggerPrice: 150, triggerWhen: 'below' as const };
    const ledger = removeFromWatchlist({ ...empty, watchlist: [item] }, 'AAPL');
    expect(restoreWatchItem(ledger, item).watchlist).toEqual([item]);
  });
});
