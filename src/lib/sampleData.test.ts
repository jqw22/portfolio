import { describe, expect, it } from 'vitest';

import { computeCashBalances } from './cash';
import { oversoldSymbols } from './portfolio';
import { sampleLedger } from './sampleData';

describe('sampleLedger', () => {
  const ledger = sampleLedger();

  it('puts every entry in a known account', () => {
    for (const entry of [...ledger.transactions, ...ledger.cash]) {
      expect(entry.account).toBeDefined();
      expect(ledger.accounts).toContain(entry.account);
    }
  });

  it('names and labels every trade', () => {
    for (const tx of ledger.transactions) {
      expect(tx.name?.trim()).toBeTruthy();
      expect(tx.label).toBeDefined();
      expect(ledger.labels).toContain(tx.label);
    }
  });

  it('never sells more than is held', () => {
    expect(oversoldSymbols(ledger.transactions)).toEqual([]);
  });

  it('never takes an account below zero cash', () => {
    for (const balance of computeCashBalances(ledger).values()) {
      expect(balance.lowest).toBeGreaterThanOrEqual(0);
    }
  });
});
