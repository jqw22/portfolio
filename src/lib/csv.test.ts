import { describe, it, expect } from 'vitest';

import { csvToTransactions, transactionsToCsv } from '@/lib/csv';
import { makeCashMovement, makeTransaction } from '@/lib/portfolio';

describe('CSV with cash movements', () => {
  it('round-trips trades, deposits and withdrawals', () => {
    const transactions = [
      makeTransaction({ symbol: 'AAPL', date: '2024-01-10', type: 'buy', quantity: 10, price: 100, fees: 1, account: 'ISA' }),
    ];
    const cash = [
      makeCashMovement({ date: '2024-01-01', type: 'deposit', amount: 2000, account: 'ISA', notes: 'Funding, January' }),
      makeCashMovement({ date: '2024-02-01', type: 'withdrawal', amount: 500, account: 'ISA' }),
    ];

    const csv = transactionsToCsv(transactions, cash);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Date,Symbol,Name,Type,Quantity,Price,Fees,Notes,Label,Account,Amount');
    expect(lines[1]).toBe('2024-01-01,,,Deposit,,,,"Funding, January",,ISA,2000');

    const result = csvToTransactions(csv);
    expect(result.skipped).toBe(0);
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]).toMatchObject({ symbol: 'AAPL', type: 'buy', quantity: 10, account: 'ISA' });
    expect(result.cash).toEqual([
      expect.objectContaining({ date: '2024-01-01', type: 'deposit', amount: 2000, account: 'ISA', notes: 'Funding, January' }),
      expect.objectContaining({ date: '2024-02-01', type: 'withdrawal', amount: 500, account: 'ISA' }),
    ]);
  });

  it('accepts negative withdrawal amounts and skips cash rows with no amount', () => {
    const csv = ['Date,Type,Symbol,Quantity,Price,Account,Amount', '2024-01-01,Withdrawal,,,,ISA,-250', '2024-01-02,Deposit,,,,ISA,'].join('\n');
    const result = csvToTransactions(csv);

    expect(result.cash).toEqual([expect.objectContaining({ type: 'withdrawal', amount: 250 })]);
    expect(result.skipped).toBe(1);
  });

  it('still reads files exported before the Amount column existed', () => {
    const csv = ['Date,Symbol,Name,Type,Quantity,Price,Fees,Notes,Label,Account', '2024-01-10,AAPL,,buy,10,100,1,,,ISA'].join('\n');
    const result = csvToTransactions(csv);

    expect(result.transactions).toHaveLength(1);
    expect(result.cash).toEqual([]);
  });
});
