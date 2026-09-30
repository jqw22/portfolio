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
}

/** Everything that is stored: the trades plus the user's list of labels. */
export interface Ledger {
  transactions: Transaction[];
  /** User-defined labels, in the order they were created. */
  labels: string[];
}

/** Aggregated position for a single symbol, computed with the average-cost method. */
export interface Holding {
  symbol: string;
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
  /** Every symbol that has at least one transaction, ordered by cost basis. */
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
    labels: ledger.labels.filter((existing) => existing.toLowerCase() !== target),
    transactions: ledger.transactions.map((tx) =>
      tx.label && tx.label.toLowerCase() === target ? { ...tx, label: undefined } : tx,
    ),
  };
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

    let holding = map.get(symbol);
    if (!holding) {
      holding = {
        symbol,
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
      map.set(symbol, holding);
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

  const holdings = Array.from(map.values()).sort((a, b) => b.costBasis - a.costBasis);
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
  return computePortfolio(transactions)
    .holdings.filter((holding) => holding.unmatchedSellQuantity > 0)
    .map((holding) => holding.symbol)
    .sort();
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
    });
  }

  return result;
}

/**
 * Coerce a stored payload into a `Ledger`. Accepts the current
 * `{ transactions, labels }` object as well as the original bare transaction
 * array. Labels used by transactions but missing from the list are added.
 */
export function parseLedger(value: unknown): Ledger {
  let rawTransactions: unknown = value;
  let rawLabels: unknown = [];
  if (!Array.isArray(value) && typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    rawTransactions = record.transactions;
    rawLabels = record.labels;
  }
  const parsed = parseTransactions(rawTransactions);
  const labels = mergeLabels(Array.isArray(rawLabels) ? rawLabels : [], parsed.map((tx) => tx.label));
  // Snap each transaction's label to the list's spelling.
  const transactions = parsed.map((tx) => (tx.label ? { ...tx, label: findLabel(labels, tx.label) } : tx));
  return { transactions, labels };
}
