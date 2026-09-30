/**
 * Domain model for the stock transaction ledger.
 *
 * Everything in this file is pure and side-effect free so the numbers can be
 * reasoned about (and unit tested) independently of React or Nostr.
 */

import { DEFAULT_CURRENCY } from './currency';

export type TransactionType = 'buy' | 'sell';

/** A single recorded trade. Dates are stored as `YYYY-MM-DD` (no timezone). */
export interface Transaction {
  id: string;
  /** Ticker symbol, e.g. `AAPL`. Always stored upper-cased. */
  symbol: string;
  /** Optional company / instrument name. */
  name?: string;
  /** Trade date as `YYYY-MM-DD`. */
  date: string;
  type: TransactionType;
  /** Number of shares / units. Always positive. */
  quantity: number;
  /** Price per share. */
  price: number;
  /** Commission or other fees paid for this trade. */
  fees: number;
  notes?: string;
  /** Optional user-defined label, one of the ledger's `labels`. */
  label?: string;
  /** Optional account the trade was made in, one of the ledger's `accounts`. */
  account?: string;
}

/** The user-editable subset of a transaction (no `id`). */
export interface TransactionInput {
  symbol: string;
  name?: string;
  date: string;
  type: TransactionType;
  quantity: number;
  price: number;
  fees?: number;
  notes?: string;
  label?: string;
  account?: string;
}

export type CashType = 'deposit' | 'withdrawal';

/** Cash paid into or taken out of an account. Amounts are in the default currency. */
export interface CashMovement {
  id: string;
  /** Date as `YYYY-MM-DD`. */
  date: string;
  type: CashType;
  /** Amount of cash moved. Always positive. */
  amount: number;
  /** Account the cash moved in or out of, one of the ledger's `accounts`. */
  account?: string;
  notes?: string;
}

/** The user-editable subset of a cash movement (no `id`). */
export interface CashMovementInput {
  date: string;
  type: CashType;
  amount: number;
  account?: string;
  notes?: string;
}

/** Everything that is stored: trades, cash movements, and the user's labels and accounts. */
export interface Ledger {
  transactions: Transaction[];
  /** Deposits and withdrawals. */
  cash: CashMovement[];
  /** User-defined labels, in the order they were created. */
  labels: string[];
  /** Accounts trades are made in, in the order they were created. */
  accounts: string[];
}

/**
 * Aggregated position for a single symbol within one account (or with no
 * account), computed with the average-cost method.
 */
export interface Holding {
  /** Unique per account + symbol; see `positionKey`. */
  key: string;
  symbol: string;
  account?: string;
  name?: string;
  /** Shares still held. */
  quantity: number;
  /** Remaining cost basis of the open position (purchase cost + buy fees). */
  costBasis: number;
  /** Cost basis divided by quantity (0 when the position is closed). */
  averageCost: number;
  /** Realized profit/loss from sells (proceeds net of fees minus cost of shares sold). */
  realizedPnl: number;
  /** Total cash spent acquiring shares. */
  totalBought: number;
  /** Total cash received from selling shares (net of fees). */
  totalSold: number;
  /** Sum of all fees recorded for this symbol. */
  totalFees: number;
  /** Shares sold beyond what was held at the time. Ignored in the P&L; non-zero means bad data. */
  unmatchedSellQuantity: number;
  transactionCount: number;
  firstDate: string;
  lastDate: string;
  /** Distinct labels used by this symbol's transactions, sorted alphabetically. */
  labels: string[];
}

export interface PortfolioSummary {
  /** Every account + symbol pair that has at least one transaction, ordered by cost basis. */
  holdings: Holding[];
  /** Holdings with shares remaining. */
  openHoldings: Holding[];
  /** Fully-exited positions. */
  closedHoldings: Holding[];
  /** Cost basis of the open positions. */
  totalCostBasis: number;
  /** Realized profit/loss across all symbols. */
  totalRealizedPnl: number;
  /** Total cash spent acquiring shares. */
  totalInvested: number;
  /** Total cash received from sells. */
  totalProceeds: number;
  /** Total fees paid. */
  totalFees: number;
  transactionCount: number;
  /** Unique symbols across all transactions, sorted alphabetically. */
  symbols: string[];
}

const EPSILON = 1e-9;

let idCounter = 0;

/** Generate a collision-resistant id, falling back when `crypto.randomUUID` is unavailable. */
export function newId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  idCounter += 1;
  return `tx-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Build a clean `Transaction` from user input, reusing an existing id when provided. */
export function makeTransaction(input: TransactionInput, id?: string): Transaction {
  const name = input.name?.trim();
  const notes = input.notes?.trim();
  const label = normalizeLabel(input.label);
  const account = normalizeLabel(input.account);
  return {
    id: id ?? newId(),
    symbol: input.symbol.trim().toUpperCase(),
    name: name ? name : undefined,
    date: input.date,
    type: input.type,
    quantity: input.quantity,
    price: input.price,
    fees: Number.isFinite(input.fees) ? (input.fees as number) : 0,
    notes: notes ? notes : undefined,
    label,
    account,
  };
}

/** Build a clean `CashMovement` from user input, reusing an existing id when provided. */
export function makeCashMovement(input: CashMovementInput, id?: string): CashMovement {
  const notes = input.notes?.trim();
  return {
    id: id ?? newId(),
    date: input.date,
    type: input.type,
    amount: input.amount,
    account: normalizeLabel(input.account),
    notes: notes ? notes : undefined,
  };
}

/** Trim and collapse whitespace in a label, returning `undefined` when empty. */
export function normalizeLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const label = value.trim().replace(/\s+/g, ' ').slice(0, 64);
  return label ? label : undefined;
}

/** Find an existing label that matches case-insensitively. */
export function findLabel(labels: string[], value: string): string | undefined {
  const needle = value.trim().toLowerCase();
  return labels.find((label) => label.toLowerCase() === needle);
}

/**
 * Merge label lists, dropping blanks and case-insensitive duplicates while
 * keeping the first spelling and order seen.
 */
export function mergeLabels(...lists: (readonly unknown[])[]): string[] {
  const result: string[] = [];
  for (const list of lists) {
    for (const value of list) {
      const label = normalizeLabel(value);
      if (label && !findLabel(result, label)) result.push(label);
    }
  }
  return result;
}

/** Remove a label from the list and clear it from every transaction that used it. */
export function removeLabel(ledger: Ledger, label: string): Ledger {
  const target = label.toLowerCase();
  return {
    ...ledger,
    labels: ledger.labels.filter((existing) => existing.toLowerCase() !== target),
    transactions: ledger.transactions.map((tx) =>
      tx.label && tx.label.toLowerCase() === target ? { ...tx, label: undefined } : tx,
    ),
  };
}

/** Rename an account in the list and on every transaction made in it. */
export function renameAccount(ledger: Ledger, from: string, to: string): Ledger {
  const name = normalizeLabel(to);
  const target = from.toLowerCase();
  if (!name) return ledger;
  const clash = findLabel(ledger.accounts, name);
  if (clash && clash.toLowerCase() !== target) return ledger;
  return {
    ...ledger,
    accounts: ledger.accounts.map((existing) => (existing.toLowerCase() === target ? name : existing)),
    transactions: ledger.transactions.map((tx) =>
      tx.account && tx.account.toLowerCase() === target ? { ...tx, account: name } : tx,
    ),
    cash: ledger.cash.map((entry) =>
      entry.account && entry.account.toLowerCase() === target ? { ...entry, account: name } : entry,
    ),
  };
}

/** Remove an account, but only when no transaction or cash movement uses it. */
export function removeAccount(ledger: Ledger, account: string): Ledger {
  const target = account.toLowerCase();
  if (ledger.transactions.some((tx) => tx.account?.toLowerCase() === target)) return ledger;
  if (ledger.cash.some((entry) => entry.account?.toLowerCase() === target)) return ledger;
  return { ...ledger, accounts: ledger.accounts.filter((existing) => existing.toLowerCase() !== target) };
}

/** Identifies a position: the same symbol in two accounts is two positions. */
export function positionKey(account: string | undefined, symbol: string): string {
  return `${account ?? ''}\u0000${symbol}`;
}

/**
 * Sort transactions oldest-first. On the same day buys come before sells, so a
 * same-day round trip nets out regardless of entry order; otherwise the sort is stable.
 */
export function sortByDate(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.type === b.type) return 0;
    return a.type === 'buy' ? -1 : 1;
  });
}

/** The name a holding is shown and sorted by: its stock name, or the symbol when it has none. */
export function holdingDisplayName(holding: Pick<Holding, 'name' | 'symbol'>): string {
  return holding.name?.trim() || holding.symbol;
}

/** Order holdings by stock name, then symbol, then account. */
function compareHoldings(a: Holding, b: Holding): number {
  const options: Intl.CollatorOptions = { sensitivity: 'base', numeric: true };
  return (
    holdingDisplayName(a).localeCompare(holdingDisplayName(b), undefined, options) ||
    a.symbol.localeCompare(b.symbol) ||
    (a.account ?? '').localeCompare(b.account ?? '', undefined, options)
  );
}

/**
 * Compute positions, cost basis and realized P&L using the average-cost method.
 *
 * Buys increase the cost basis (including fees). Sells realize profit/loss
 * against the running average cost and reduce the basis proportionally.
 * Only the part of a sell covered by shares held counts; any excess (and its
 * share of the fees) is recorded in `unmatchedSellQuantity` and otherwise ignored.
 */
export function computePortfolio(transactions: Transaction[]): PortfolioSummary {
  const map = new Map<string, Holding>();

  for (const tx of sortByDate(transactions)) {
    const symbol = tx.symbol.trim().toUpperCase();
    if (!symbol) continue;
    const key = positionKey(tx.account, symbol);

    let holding = map.get(key);
    if (!holding) {
      holding = {
        key,
        symbol,
        account: tx.account,
        name: tx.name,
        quantity: 0,
        costBasis: 0,
        averageCost: 0,
        realizedPnl: 0,
        totalBought: 0,
        totalSold: 0,
        totalFees: 0,
        unmatchedSellQuantity: 0,
        transactionCount: 0,
        firstDate: tx.date,
        lastDate: tx.date,
        labels: [],
      };
      map.set(key, holding);
    }

    if (!holding.name && tx.name) holding.name = tx.name;
    if (tx.label && !holding.labels.includes(tx.label)) holding.labels.push(tx.label);
    holding.transactionCount += 1;
    holding.totalFees += tx.fees;
    if (tx.date < holding.firstDate) holding.firstDate = tx.date;
    if (tx.date > holding.lastDate) holding.lastDate = tx.date;

    const gross = tx.quantity * tx.price;

    if (tx.type === 'buy') {
      holding.quantity += tx.quantity;
      holding.costBasis += gross + tx.fees;
      holding.totalBought += gross + tx.fees;
    } else {
      const held = holding.quantity > EPSILON ? holding.quantity : 0;
      const averageCost = held > 0 ? holding.costBasis / held : 0;
      const soldQuantity = Math.min(tx.quantity, held);
      const matchedShare = tx.quantity > 0 ? soldQuantity / tx.quantity : 0;
      const costOfSold = averageCost * soldQuantity;
      const proceeds = (gross - tx.fees) * matchedShare;
      holding.realizedPnl += proceeds - costOfSold;
      holding.quantity = Math.max(0, held - soldQuantity);
      holding.costBasis = holding.quantity > EPSILON ? Math.max(0, holding.costBasis - costOfSold) : 0;
      holding.totalSold += proceeds;
      if (tx.quantity - soldQuantity > EPSILON) holding.unmatchedSellQuantity += tx.quantity - soldQuantity;
    }

    holding.averageCost = holding.quantity > EPSILON ? holding.costBasis / holding.quantity : 0;
  }

  for (const holding of map.values()) holding.labels.sort((a, b) => a.localeCompare(b));

  const holdings = Array.from(map.values()).sort(compareHoldings);
  const openHoldings = holdings.filter((holding) => holding.quantity > EPSILON);
  const closedHoldings = holdings.filter((holding) => holding.quantity <= EPSILON);

  const symbols = Array.from(new Set(transactions.map((tx) => tx.symbol.trim().toUpperCase()).filter(Boolean))).sort();

  return {
    holdings,
    openHoldings,
    closedHoldings,
    totalCostBasis: openHoldings.reduce((sum, holding) => sum + holding.costBasis, 0),
    totalRealizedPnl: holdings.reduce((sum, holding) => sum + holding.realizedPnl, 0),
    totalInvested: holdings.reduce((sum, holding) => sum + holding.totalBought, 0),
    totalProceeds: holdings.reduce((sum, holding) => sum + holding.totalSold, 0),
    totalFees: holdings.reduce((sum, holding) => sum + holding.totalFees, 0),
    transactionCount: transactions.length,
    symbols,
  };
}

/** Symbols where at least one sell exceeds the shares held at the time, sorted alphabetically. */
export function oversoldSymbols(transactions: Transaction[]): string[] {
  const symbols = oversoldPositions(transactions).map((holding) => holding.symbol);
  return Array.from(new Set(symbols)).sort();
}

/** Positions (account + symbol) where at least one sell exceeds the shares held in that account at the time. */
export function oversoldPositions(transactions: Transaction[]): Holding[] {
  return computePortfolio(transactions).holdings.filter((holding) => holding.unmatchedSellQuantity > 0);
}

/** Format a number as currency, degrading gracefully for unsupported codes. */
export function formatCurrency(value: number, currency = DEFAULT_CURRENCY, options: Intl.NumberFormatOptions = {}): string {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, ...options }).format(safe);
  } catch {
    return `${safe.toFixed(2)} ${currency}`;
  }
}

/** Format a share quantity without trailing noise. */
export function formatQuantity(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(safe);
}

/** Format a price with up to four decimal places (stock prices rarely need more). */
export function formatPrice(value: number, currency = DEFAULT_CURRENCY): string {
  const safe = Number.isFinite(value) ? value : 0;
  return formatCurrency(safe, currency, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

/** Format a percentage with an explicit sign. */
export function formatPercent(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  const sign = safe > 0 ? '+' : '';
  return `${sign}${safe.toFixed(2)}%`;
}

/** Format an ISO (`YYYY-MM-DD`) date for display. */
export function formatDate(iso: string): string {
  if (!iso) return '—';
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** The current local date as `YYYY-MM-DD` (avoids UTC drift). */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function toIso(year: string, month: string, day: string): string | null {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Normalize a user-supplied date string to `YYYY-MM-DD`, or `null` if unparseable. */
export function normalizeDate(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(value);
  if (iso) return toIso(iso[1], iso[2], iso[3]);

  const short = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(value);
  if (short) {
    const year = short[3].length === 2 ? `20${short[3]}` : short[3];
    return toIso(year, short[1], short[2]);
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }

  return null;
}

/** Parse a loosely-formatted number, tolerating `$`, thousands separators and spaces. */
export function parseNumber(input: string): number | null {
  const cleaned = input.replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Coerce an arbitrary value into a valid `Transaction` array (drops malformed entries). */
export function parseTransactions(value: unknown): Transaction[] {
  if (!Array.isArray(value)) return [];

  const result: Transaction[] = [];

  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;

    const symbol = typeof record.symbol === 'string' ? record.symbol.trim().toUpperCase() : '';
    const date = typeof record.date === 'string' ? normalizeDate(record.date) : null;
    const type: TransactionType | null = record.type === 'buy' || record.type === 'sell' ? record.type : null;
    const quantity = typeof record.quantity === 'number' ? record.quantity : Number(record.quantity);
    const price = typeof record.price === 'number' ? record.price : Number(record.price);
    const fees = typeof record.fees === 'number' ? record.fees : Number(record.fees);

    if (!symbol || !date || !type) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    if (!Number.isFinite(price) || price < 0) continue;

    result.push({
      id: typeof record.id === 'string' && record.id ? record.id : newId(),
      symbol,
      name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : undefined,
      date,
      type,
      quantity,
      price,
      fees: Number.isFinite(fees) ? fees : 0,
      notes: typeof record.notes === 'string' && record.notes.trim() ? record.notes.trim() : undefined,
      label: normalizeLabel(record.label),
      account: normalizeLabel(record.account),
    });
  }

  return result;
}

/** Coerce an arbitrary value into a valid `CashMovement` array (drops malformed entries). */
export function parseCashMovements(value: unknown): CashMovement[] {
  if (!Array.isArray(value)) return [];

  const result: CashMovement[] = [];

  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;

    const date = typeof record.date === 'string' ? normalizeDate(record.date) : null;
    const type: CashType | null =
      record.type === 'deposit' || record.type === 'withdrawal' ? record.type : null;
    const amount = typeof record.amount === 'number' ? record.amount : Number(record.amount);

    if (!date || !type) continue;
    if (!Number.isFinite(amount) || amount <= 0) continue;

    result.push({
      id: typeof record.id === 'string' && record.id ? record.id : newId(),
      date,
      type,
      amount,
      account: normalizeLabel(record.account),
      notes: typeof record.notes === 'string' && record.notes.trim() ? record.notes.trim() : undefined,
    });
  }

  return result;
}

/**
 * Coerce a stored payload into a `Ledger`. Accepts the current
 * `{ transactions, cash, labels, accounts }` object (older ones lack `cash`,
 * `labels` or `accounts`) as well as the original bare transaction array.
 * Labels and accounts used by entries but missing from their lists are added.
 */
export function parseLedger(value: unknown): Ledger {
  let rawTransactions: unknown = value;
  let rawCash: unknown = [];
  let rawLabels: unknown = [];
  let rawAccounts: unknown = [];
  if (!Array.isArray(value) && typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    rawTransactions = record.transactions;
    rawCash = record.cash;
    rawLabels = record.labels;
    rawAccounts = record.accounts;
  }
  const parsed = parseTransactions(rawTransactions);
  const parsedCash = parseCashMovements(rawCash);
  const labels = mergeLabels(Array.isArray(rawLabels) ? rawLabels : [], parsed.map((tx) => tx.label));
  const accounts = mergeLabels(
    Array.isArray(rawAccounts) ? rawAccounts : [],
    parsed.map((tx) => tx.account),
    parsedCash.map((entry) => entry.account),
  );
  // Snap each transaction's label and account to the lists' spelling.
  const transactions = parsed.map((tx) =>
    tx.label || tx.account
      ? {
          ...tx,
          label: tx.label ? findLabel(labels, tx.label) : undefined,
          account: tx.account ? findLabel(accounts, tx.account) : undefined,
        }
      : tx,
  );
  const cash = parsedCash.map((entry) =>
    entry.account ? { ...entry, account: findLabel(accounts, entry.account) } : entry,
  );
  return { transactions, cash, labels, accounts };
}
