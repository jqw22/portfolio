import { describe, expect, it } from 'vitest';

import { parseLedger, setStockNote, STOCK_NOTE_MAX_LENGTH, type Ledger } from './portfolio';

const empty: Ledger = { transactions: [], cash: [], labels: [], accounts: [], stockNotes: {} };

describe('stock notes', () => {
  it('reads notes keyed by upper-cased symbol and drops blanks and junk', () => {
    const ledger = parseLedger({
      version: 5,
      transactions: [],
      cash: [],
      labels: [],
      accounts: [],
      stockNotes: { aapl: '  Hold for the long run  ', MSFT: '   ', VOO: 42, ' ': 'no symbol' },
    });
    expect(ledger.stockNotes).toEqual({ AAPL: 'Hold for the long run' });
  });

  it('reads older payloads without notes as having none', () => {
    expect(parseLedger({ version: 4, transactions: [], cash: [], labels: [], accounts: [] }).stockNotes).toEqual({});
    expect(parseLedger({ version: 5, stockNotes: ['not', 'a', 'map'] }).stockNotes).toEqual({});
    expect(parseLedger([]).stockNotes).toEqual({});
  });

  it('sets, replaces and deletes a note', () => {
    const added = setStockNote(empty, 'dge.l', ' Dividend payer\nReview in March ');
    expect(added.stockNotes).toEqual({ 'DGE.L': 'Dividend payer\nReview in March' });

    const replaced = setStockNote(added, 'DGE.L', 'Sold half');
    expect(replaced.stockNotes).toEqual({ 'DGE.L': 'Sold half' });

    const removed = setStockNote(replaced, 'DGE.L', '   ');
    expect(removed.stockNotes).toEqual({});
  });

  it('caps a note at the maximum length', () => {
    const long = 'x'.repeat(STOCK_NOTE_MAX_LENGTH + 50);
    expect(setStockNote(empty, 'AAPL', long).stockNotes.AAPL).toHaveLength(STOCK_NOTE_MAX_LENGTH);
  });
});
