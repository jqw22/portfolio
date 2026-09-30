/**
 * Cash balances per account, derived from the ledger history.
 *
 * Cash is never stored: each account's balance is its deposits, minus its
 * withdrawals, minus what its buys cost (including fees), plus what its sells
 * raised (net of fees). Like `portfolio.ts`, everything here is pure.
 */

import type { CashMovement, Transaction } from './portfolio';

const EPSILON = 1e-9;

export interface CashBalance {
  /** The account, or `undefined` for entries with no account. */
  account?: string;
  /** Cash held now, after every entry. */
  balance: number;
  deposits: number;
  withdrawals: number;
  /** Cash spent on buys, including fees. */
  spent: number;
  /** Cash received from sells, net of fees. */
  received: number;
  /** The lowest end-of-day balance the account ever had (0 before its first entry). */
  lowest: number;
  /** The first date the balance reached `lowest`; `undefined` when it never went below zero. */
  lowestDate?: string;
}

/** The entries whose cash an account sees; only the parts that move cash. */
export interface CashHistory {
  transactions: Transaction[];
  cash: CashMovement[];
}

/** The cash effect of a trade: negative for buys (cost plus fees), positive for sells (proceeds less fees). */
export function tradeCashEffect(tx: Transaction): number {
  const gross = tx.quantity * tx.price;
  return tx.type === 'buy' ? -(gross + tx.fees) : gross - tx.fees;
}

/** The cash effect of a deposit (positive) or withdrawal (negative). */
export function cashMovementEffect(entry: CashMovement): number {
  return entry.type === 'deposit' ? entry.amount : -entry.amount;
}

function accountKey(account: string | undefined): string {
  return account ?? '';
}

/**
 * Compute each account's cash balance. Balances are checked at the end of each
 * day, so the order of same-day entries doesn't matter: a deposit and a buy
 * on the same day are fine in either order.
 *
 * Returns one balance per account that has any entry, keyed by account name
 * (`''` for entries with no account).
 */
export function computeCashBalances({ transactions, cash }: CashHistory): Map<string, CashBalance> {
  interface Move {
    account?: string;
    date: string;
    amount: number;
  }

  const moves: Move[] = [
    ...cash.map((entry) => ({ account: entry.account, date: entry.date, amount: cashMovementEffect(entry) })),
    ...transactions.map((tx) => ({ account: tx.account, date: tx.date, amount: tradeCashEffect(tx) })),
  ];

  const balances = new Map<string, CashBalance>();
  const byAccount = new Map<string, Move[]>();

  for (const move of moves) {
    const key = accountKey(move.account);
    let balance = balances.get(key);
    if (!balance) {
      balance = { account: move.account, balance: 0, deposits: 0, withdrawals: 0, spent: 0, received: 0, lowest: 0 };
      balances.set(key, balance);
      byAccount.set(key, []);
    }
    byAccount.get(key)?.push(move);
  }

  for (const entry of cash) {
    const balance = balances.get(accountKey(entry.account));
    if (!balance) continue;
    if (entry.type === 'deposit') balance.deposits += entry.amount;
    else balance.withdrawals += entry.amount;
  }
  for (const tx of transactions) {
    const balance = balances.get(accountKey(tx.account));
    if (!balance) continue;
    const effect = tradeCashEffect(tx);
    if (effect < 0) balance.spent -= effect;
    else balance.received += effect;
  }

  for (const [key, accountMoves] of byAccount) {
    const balance = balances.get(key);
    if (!balance) continue;
    accountMoves.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let running = 0;
    for (let i = 0; i < accountMoves.length; i += 1) {
      running += accountMoves[i].amount;
      const endOfDay = i === accountMoves.length - 1 || accountMoves[i + 1].date !== accountMoves[i].date;
      if (endOfDay && running < balance.lowest - EPSILON) {
        balance.lowest = running;
        balance.lowestDate = accountMoves[i].date;
      }
    }
    balance.balance = running;
  }

  return balances;
}

/** Cash balances as a list, in the order of `accounts` (unknown accounts and no-account last). */
export function cashBalanceList(history: CashHistory, accounts: string[]): CashBalance[] {
  const balances = computeCashBalances(history);
  const order = (balance: CashBalance): number => {
    const index = balance.account ? accounts.indexOf(balance.account) : -1;
    return index === -1 ? accounts.length + (balance.account ? 0 : 1) : index;
  };
  return Array.from(balances.values()).sort((a, b) => order(a) - order(b));
}

/**
 * Accounts that a change makes overdrawn: after the change their balance dips
 * below zero on some day, lower than it did before. Accounts that were
 * already overdrawn don't block a change unless it makes things worse, so bad
 * existing data can't lock the ledger.
 */
export function newCashShortfalls(before: CashHistory, after: CashHistory): CashBalance[] {
  const previous = computeCashBalances(before);
  const next = computeCashBalances(after);
  const result: CashBalance[] = [];
  for (const [key, balance] of next) {
    if (balance.lowest >= -EPSILON) continue;
    const old = previous.get(key)?.lowest ?? 0;
    if (balance.lowest < old - EPSILON) result.push(balance);
  }
  return result;
}
