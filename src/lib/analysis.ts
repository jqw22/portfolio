/**
 * Summaries for the Analysis tab: positions rolled up by account and by label.
 *
 * Pure functions only, like `portfolio.ts`, so the numbers can be checked without React.
 */

import type { CashBalance } from './cash';
import { positionKey, sortByDate, type Holding, type Transaction } from './portfolio';
import { unrealisedGain, type ResolvedPrice } from './prices';

const EPSILON = 1e-9;

export interface GroupSummary {
  key: string;
  /** Account or label name; `undefined` for the "No account" / "Unlabelled" row. */
  name?: string;
  /** Set on the row that holds uninvested cash in the label summary. */
  isCash?: boolean;
  /** Open positions in the group. */
  positions: number;
  /** Cost basis of open positions plus cash. */
  costBasis: number;
  /** Open positions at their latest price (at cost when unpriced) plus cash. */
  currentValue: number;
  /** Unrealised gain of the priced open positions. */
  unrealised: number;
  /** Open positions with a price. */
  priced: number;
  /** Open positions without a price, counted at cost. */
  unpriced: number;
  cash: number;
  /** Share of the total current value, 0 to 1. */
  share: number;
}

export interface GroupSummaryTable {
  rows: GroupSummary[];
  total: GroupSummary;
}

type Prices = Record<string, ResolvedPrice | null | undefined>;

function emptyGroup(key: string, name?: string): GroupSummary {
  return {
    key,
    name,
    positions: 0,
    costBasis: 0,
    currentValue: 0,
    unrealised: 0,
    priced: 0,
    unpriced: 0,
    cash: 0,
    share: 0,
  };
}

function addHolding(group: GroupSummary, holding: Holding, prices: Prices): void {
  if (holding.quantity <= EPSILON) return;
  group.positions += 1;
  group.costBasis += holding.costBasis;
  const result = unrealisedGain(holding, prices[holding.symbol]?.price);
  if (result) {
    group.priced += 1;
    group.unrealised += result.gain;
    group.currentValue += result.marketValue;
  } else {
    group.unpriced += 1;
    group.currentValue += holding.costBasis;
  }
}

function addCash(group: GroupSummary, balance: number): void {
  group.cash += balance;
  group.costBasis += balance;
  group.currentValue += balance;
}

/** Add the total row and each row's share of the total current value. */
function finish(rows: GroupSummary[]): GroupSummaryTable {
  const total = emptyGroup('total');
  for (const row of rows) {
    total.positions += row.positions;
    total.costBasis += row.costBasis;
    total.currentValue += row.currentValue;
    total.unrealised += row.unrealised;
    total.priced += row.priced;
    total.unpriced += row.unpriced;
    total.cash += row.cash;
  }
  const denominator = Math.abs(total.currentValue) > EPSILON ? total.currentValue : 0;
  for (const row of rows) row.share = denominator ? row.currentValue / denominator : 0;
  total.share = denominator ? 1 : 0;
  return { rows, total };
}

/** Rank for the fixed rows at the bottom: named rows first, then the unnamed row, then cash. */
function rank(group: GroupSummary): number {
  if (group.isCash) return 2;
  return group.name === undefined ? 1 : 0;
}

/** Named rows A to Z (ignoring case), then the "No account" / "Unlabelled" row, then cash. */
function sortGroups(groups: Iterable<GroupSummary>): GroupSummary[] {
  return Array.from(groups).sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.name ?? '').localeCompare(b.name ?? '', undefined, { sensitivity: 'base', numeric: true }),
  );
}

/** One row per account: its open positions plus its cash. */
export function summariseByAccount(
  holdings: Holding[],
  cashBalances: CashBalance[],
  prices: Prices,
): GroupSummaryTable {
  const groups = new Map<string, GroupSummary>();
  const groupFor = (account: string | undefined) => {
    const key = account ?? '';
    let group = groups.get(key);
    if (!group) {
      group = emptyGroup(`account:${key}`, account);
      groups.set(key, group);
    }
    return group;
  };
  for (const holding of holdings) addHolding(groupFor(holding.account), holding, prices);
  for (const cash of cashBalances) addCash(groupFor(cash.account), cash.balance);
  return finish(sortGroups(groups.values()));
}

/**
 * The label each position counts under: the label of its latest labelled trade,
 * so a position relabelled part way through follows its newest label.
 */
export function positionLabels(transactions: Transaction[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const tx of sortByDate(transactions)) {
    const symbol = tx.symbol.trim().toUpperCase();
    if (symbol && tx.label) labels.set(positionKey(tx.account, symbol), tx.label);
  }
  return labels;
}

/**
 * One row per label, an "Unlabelled" row for positions with no labelled trades,
 * and a Cash row so the total matches the account summary.
 */
export function summariseByLabel(
  holdings: Holding[],
  transactions: Transaction[],
  cashBalances: CashBalance[],
  prices: Prices,
): GroupSummaryTable {
  const byPosition = positionLabels(transactions);
  const groups = new Map<string, GroupSummary>();
  for (const holding of holdings) {
    const label = byPosition.get(holding.key);
    const key = label?.toLowerCase() ?? '';
    let group = groups.get(key);
    if (!group) {
      group = emptyGroup(`label:${key}`, label);
      groups.set(key, group);
    }
    addHolding(group, holding, prices);
  }
  const rows = sortGroups(groups.values());
  if (cashBalances.length > 0) {
    const cash = { ...emptyGroup('cash', 'Cash'), isCash: true };
    for (const balance of cashBalances) addCash(cash, balance.balance);
    rows.push(cash);
  }
  return finish(rows);
}
