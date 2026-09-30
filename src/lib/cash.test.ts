import { describe, it, expect } from 'vitest';

import { cashBalanceList, computeCashBalances, newCashShortfalls, tradeCashEffect } from '@/lib/cash';
import {
  makeCashMovement,
  makeTransaction,
  parseLedger,
  removeAccount,
  renameAccount,
  type CashMovement,
  type CashMovementInput,
  type Transaction,
  type TransactionInput,
} from '@/lib/portfolio';

let seq = 0;

function trade(input: Partial<TransactionInput> & Pick<TransactionInput, 'type' | 'quantity' | 'price'>): Transaction {
  seq += 1;
  return makeTransaction({ symbol: 'AAPL', date: '2024-01-10', fees: 0, account: 'ISA', ...input }, `tx-${seq}`);
}

function money(input: Partial<CashMovementInput> & Pick<CashMovementInput, 'type' | 'amount'>): CashMovement {
  seq += 1;
  return makeCashMovement({ date: '2024-01-01', account: 'ISA', ...input }, `cash-${seq}`);
}

function balanceOf(transactions: Transaction[], cash: CashMovement[], account = 'ISA') {
  const balance = computeCashBalances({ transactions, cash }).get(account);
  if (!balance) throw new Error(`No balance for ${account}`);
  return balance;
}

describe('tradeCashEffect', () => {
  it('charges buys their cost plus fees', () => {
    expect(tradeCashEffect(trade({ type: 'buy', quantity: 10, price: 100, fees: 5 }))).toBeCloseTo(-1005);
  });

  it('credits sells their proceeds less fees', () => {
    expect(tradeCashEffect(trade({ type: 'sell', quantity: 10, price: 100, fees: 5 }))).toBeCloseTo(995);
  });
});

describe('computeCashBalances', () => {
  it('adds deposits and sells, and subtracts withdrawals and buys, fees included', () => {
    const b = balanceOf(
      [
        trade({ type: 'buy', quantity: 10, price: 100, fees: 5, date: '2024-01-10' }),
        trade({ type: 'sell', quantity: 4, price: 150, fees: 2, date: '2024-02-10' }),
      ],
      [
        money({ type: 'deposit', amount: 2000, date: '2024-01-01' }),
        money({ type: 'withdrawal', amount: 300, date: '2024-03-01' }),
      ],
    );

    expect(b.deposits).toBe(2000);
    expect(b.withdrawals).toBe(300);
    expect(b.spent).toBeCloseTo(1005);
    expect(b.received).toBeCloseTo(598);
    expect(b.balance).toBeCloseTo(2000 - 1005 + 598 - 300);
    expect(b.lowest).toBe(0);
    expect(b.lowestDate).toBeUndefined();
  });

  it('keeps each account separate', () => {
    const balances = computeCashBalances({
      transactions: [trade({ type: 'buy', quantity: 1, price: 100, account: 'General' })],
      cash: [money({ type: 'deposit', amount: 500, account: 'ISA' }), money({ type: 'deposit', amount: 200, account: 'General' })],
    });

    expect(balances.get('ISA')?.balance).toBe(500);
    expect(balances.get('General')?.balance).toBe(100);
  });

  it('records the lowest end-of-day balance and when it happened', () => {
    const b = balanceOf(
      [trade({ type: 'buy', quantity: 10, price: 100, date: '2024-01-10' })],
      [money({ type: 'deposit', amount: 1500, date: '2024-01-20' })],
    );

    expect(b.balance).toBe(500);
    expect(b.lowest).toBe(-1000);
    expect(b.lowestDate).toBe('2024-01-10');
  });

  it('nets same-day entries, whatever order they were entered in', () => {
    const b = balanceOf(
      [trade({ type: 'buy', quantity: 10, price: 100, date: '2024-01-10' })],
      [money({ type: 'deposit', amount: 1000, date: '2024-01-10' })],
    );

    expect(b.balance).toBe(0);
    expect(b.lowest).toBe(0);
  });

  it('lets a sell fund a buy on the same day', () => {
    const b = balanceOf(
      [
        trade({ type: 'buy', quantity: 10, price: 100, date: '2024-01-01' }),
        trade({ type: 'buy', quantity: 5, price: 200, symbol: 'MSFT', date: '2024-02-01' }),
        trade({ type: 'sell', quantity: 10, price: 100, date: '2024-02-01' }),
      ],
      [money({ type: 'deposit', amount: 1000, date: '2024-01-01' })],
    );

    expect(b.balance).toBe(0);
    expect(b.lowest).toBe(0);
  });

  it('is empty for an empty ledger', () => {
    expect(computeCashBalances({ transactions: [], cash: [] }).size).toBe(0);
  });
});

describe('cashBalanceList', () => {
  it('orders balances like the account list', () => {
    const list = cashBalanceList(
      {
        transactions: [],
        cash: [money({ type: 'deposit', amount: 1, account: 'ISA' }), money({ type: 'deposit', amount: 2, account: 'General' })],
      },
      ['General', 'ISA'],
    );

    expect(list.map((b) => b.account)).toEqual(['General', 'ISA']);
  });
});

describe('newCashShortfalls', () => {
  const deposit = money({ type: 'deposit', amount: 1000, date: '2024-01-01' });

  it('flags a buy the account cannot afford', () => {
    const buy = trade({ type: 'buy', quantity: 10, price: 100, fees: 1 });
    const shortfalls = newCashShortfalls({ transactions: [], cash: [deposit] }, { transactions: [buy], cash: [deposit] });

    expect(shortfalls).toHaveLength(1);
    expect(shortfalls[0].account).toBe('ISA');
    expect(shortfalls[0].lowest).toBeCloseTo(-1);
  });

  it('accepts a buy that uses exactly the cash available', () => {
    const buy = trade({ type: 'buy', quantity: 10, price: 99, fees: 10 });
    expect(newCashShortfalls({ transactions: [], cash: [deposit] }, { transactions: [buy], cash: [deposit] })).toEqual([]);
  });

  it('flags a buy dated before the cash arrived', () => {
    const buy = trade({ type: 'buy', quantity: 1, price: 10, date: '2023-12-31' });
    expect(newCashShortfalls({ transactions: [], cash: [deposit] }, { transactions: [buy], cash: [deposit] })).toHaveLength(1);
  });

  it('flags a backdated buy that a later withdrawal would overdraw', () => {
    const withdrawal = money({ type: 'withdrawal', amount: 900, date: '2024-03-01' });
    const buy = trade({ type: 'buy', quantity: 2, price: 100, date: '2024-02-01' });
    const before = { transactions: [], cash: [deposit, withdrawal] };

    expect(newCashShortfalls(before, { ...before, transactions: [buy] })).toHaveLength(1);
  });

  it('flags deleting a deposit that paid for a buy', () => {
    const buy = trade({ type: 'buy', quantity: 5, price: 100 });
    expect(newCashShortfalls({ transactions: [buy], cash: [deposit] }, { transactions: [buy], cash: [] })).toHaveLength(1);
  });

  it('does not block changes to an account that was already overdrawn, unless they make it worse', () => {
    const buy = trade({ type: 'buy', quantity: 20, price: 100 });
    const before = { transactions: [buy], cash: [deposit] };
    const topUp = money({ type: 'deposit', amount: 100, date: '2024-02-01' });
    const small = trade({ type: 'buy', quantity: 1, price: 1 });

    expect(newCashShortfalls(before, { ...before, cash: [deposit, topUp] })).toEqual([]);
    expect(newCashShortfalls(before, { ...before, transactions: [buy, small] })).toHaveLength(1);
  });
});

describe('ledger with cash', () => {
  it('reads cash movements and adds their accounts to the list', () => {
    const ledger = parseLedger({
      version: 4,
      transactions: [],
      cash: [
        { id: 'a', date: '2024-01-01', type: 'deposit', amount: 100, account: 'isa' },
        { id: 'b', date: '2024-01-02', type: 'withdrawal', amount: 50, account: 'General' },
        { id: 'c', date: '2024-01-02', type: 'deposit', amount: -5 },
        { id: 'd', date: 'nope', type: 'deposit', amount: 5 },
        { id: 'e', date: '2024-01-02', type: 'transfer', amount: 5 },
      ],
      labels: [],
      accounts: ['ISA'],
    });

    expect(ledger.cash.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(ledger.cash[0].account).toBe('ISA');
    expect(ledger.accounts).toEqual(['ISA', 'General']);
  });

  it('reads older payloads without cash as having none', () => {
    expect(parseLedger({ version: 3, transactions: [], labels: [], accounts: [] }).cash).toEqual([]);
    expect(parseLedger([]).cash).toEqual([]);
  });

  it('renames an account on its cash movements too', () => {
    const ledger = parseLedger({ transactions: [], cash: [money({ type: 'deposit', amount: 1 })], accounts: ['ISA'] });
    expect(renameAccount(ledger, 'ISA', 'Stocks ISA').cash[0].account).toBe('Stocks ISA');
  });

  it('keeps an account that only has cash movements', () => {
    const ledger = parseLedger({ transactions: [], cash: [money({ type: 'deposit', amount: 1 })], accounts: ['ISA'] });
    expect(removeAccount(ledger, 'ISA').accounts).toEqual(['ISA']);
  });
});
