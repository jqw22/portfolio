import { makeTransaction, type Transaction, type TransactionInput } from './portfolio';

/** A small, realistic set of trades used to seed the ledger from the empty state. */
export function sampleTransactions(): Transaction[] {
  const inputs: TransactionInput[] = [
    { symbol: 'AAPL', name: 'Apple Inc.', date: '2023-01-17', type: 'buy', quantity: 20, price: 135.94, fees: 1, notes: 'Opening position' },
    { symbol: 'AAPL', name: 'Apple Inc.', date: '2023-08-04', type: 'buy', quantity: 10, price: 172.3, fees: 1 },
    { symbol: 'AAPL', name: 'Apple Inc.', date: '2024-06-21', type: 'sell', quantity: 8, price: 225.1, fees: 1.5, notes: 'Trimmed into strength' },
    { symbol: 'MSFT', name: 'Microsoft Corp.', date: '2023-03-10', type: 'buy', quantity: 12, price: 242, fees: 1 },
    { symbol: 'MSFT', name: 'Microsoft Corp.', date: '2024-01-30', type: 'sell', quantity: 4, price: 405.5, fees: 1 },
    { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', date: '2023-05-02', type: 'buy', quantity: 15, price: 380.5, fees: 0, notes: 'Core index allocation' },
    { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', date: '2024-02-15', type: 'buy', quantity: 5, price: 452.75, fees: 0 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', date: '2023-06-12', type: 'buy', quantity: 30, price: 265.1, fees: 1 },
    { symbol: 'NVDA', name: 'NVIDIA Corp.', date: '2024-03-08', type: 'sell', quantity: 10, price: 880, fees: 2, notes: 'Partial exit' },
  ];

  return inputs.map((input) => makeTransaction(input));
}
