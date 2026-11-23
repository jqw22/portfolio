import { describe, expect, it } from 'vitest';

import {
  formatCurrency,
  formatWhole,
  LABEL_MAX_LENGTH,
  normalizeNewLabel,
  noteCount,
  parseLedger,
  renameAccount,
  setAccountNote,
  type Ledger,
} from './portfolio';

const empty: Ledger = { transactions: [], cash: [], labels: [], accounts: [], stockNotes: {}, accountNotes: {}, watchlist: [], watchLabels: [] };

const trade = (symbol: string, account: string) => ({
  id: `${account}-${symbol}`,
  symbol,
  date: '2026-01-02',
  type: 'buy',
  quantity: 1,
  price: 10,
  fees: 0,
  account,
});

describe('account notes', () => {
  it('copies shared notes from older payloads into each account that traded the stock', () => {
    const ledger = parseLedger({
      version: 6,
      transactions: [trade('AAPL', 'ISA'), trade('AAPL', 'SIPP'), trade('MSFT', 'ISA')],
      stockNotes: { AAPL: 'Long term' },
    });
    expect(ledger.accountNotes).toEqual({ ISA: { AAPL: 'Long term' }, SIPP: { AAPL: 'Long term' } });
    expect(ledger.stockNotes).toEqual({ AAPL: 'Long term' });
  });

  it('reads stored account notes as they are, without copying shared notes', () => {
    const ledger = parseLedger({
      version: 7,
      transactions: [trade('AAPL', 'ISA'), trade('AAPL', 'SIPP')],
      accounts: ['ISA', 'SIPP'],
      stockNotes: { AAPL: 'Watchlist note' },
      accountNotes: { isa: { aapl: ' Only in the ISA ' }, SIPP: { AAPL: '  ' }, Bad: 'nope' },
    });
    expect(ledger.accountNotes).toEqual({ ISA: { AAPL: 'Only in the ISA' } });
  });

  it('sets and deletes a note in one account only', () => {
    const base = { ...empty, accounts: ['ISA', 'SIPP'] };
    const isa = setAccountNote(base, 'ISA', 'aapl', 'Buy more');
    const both = setAccountNote(isa, 'SIPP', 'AAPL', 'Hold');
    expect(both.accountNotes).toEqual({ ISA: { AAPL: 'Buy more' }, SIPP: { AAPL: 'Hold' } });
    expect(noteCount(both)).toBe(2);
    const cleared = setAccountNote(both, 'ISA', 'AAPL', '   ');
    expect(cleared.accountNotes).toEqual({ SIPP: { AAPL: 'Hold' } });
  });

  it('moves notes with a renamed account', () => {
    const ledger = setAccountNote({ ...empty, accounts: ['ISA'] }, 'ISA', 'AAPL', 'Buy more');
    expect(renameAccount(ledger, 'ISA', 'Stocks ISA').accountNotes).toEqual({ 'Stocks ISA': { AAPL: 'Buy more' } });
  });
});

describe('labels', () => {
  it('cuts new labels to the maximum length', () => {
    expect(LABEL_MAX_LENGTH).toBe(10);
    expect(normalizeNewLabel('  Technology stocks ')).toBe('Technology');
    expect(normalizeNewLabel('US  Equity')).toBe('US Equity');
    expect(normalizeNewLabel('Long name with space')).toBe('Long name');
    expect(normalizeNewLabel('   ')).toBeUndefined();
  });
});

describe('money formatting', () => {
  it('leaves out the currency symbol', () => {
    expect(formatCurrency(1234.5, 'GBP')).not.toMatch(/£|GBP/);
    expect(formatCurrency(1234.5, 'GBP')).toMatch(/1,?234\.50/);
    expect(formatWhole(-2772.4, 'USD')).not.toMatch(/\$|USD/);
    expect(formatWhole(-2772.4, 'USD')).toMatch(/-2,?772/);
  });
});
