/**
 * Daily snapshots of each account's value, for the chart on the Analysis tab.
 *
 * Prices are only known from the day the app starts fetching them, so the
 * history is built forward: each day the app is open, it records every
 * account's current value (open positions at latest prices plus cash). A
 * later recording on the same day replaces the earlier one.
 *
 * Pure functions only, so they can be tested without React.
 */

import type { GroupSummaryTable } from './analysis';

/** Shown for holdings and cash with no account. */
export const NO_ACCOUNT = 'No account';

export interface Snapshot {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  /** Currency the values are in; the chart only shows the current one. */
  currency: string;
  /** Each account's value in whole units of `currency`. */
  values: Record<string, number>;
  /** When it was recorded (ms since epoch); the later wins when two copies merge. */
  takenAt: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Today's local date as `YYYY-MM-DD`. */
export function localDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Each account's current value from the By account summary, rounded to whole units. */
export function accountValues(summary: GroupSummaryTable): Record<string, number> {
  const values: Record<string, number> = {};
  for (const row of summary.rows) values[row.name ?? NO_ACCOUNT] = Math.round(row.currentValue);
  return values;
}

function sameValues(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** Keep snapshots in date order, one per day. */
function sortByDate(snapshots: Snapshot[]): Snapshot[] {
  return [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Record `snapshot`, replacing any earlier one for the same day. Returns the
 * same array when nothing changed, so callers can skip saving.
 */
export function upsertSnapshot(snapshots: Snapshot[], snapshot: Snapshot): Snapshot[] {
  const index = snapshots.findIndex((entry) => entry.date === snapshot.date);
  if (index === -1) return sortByDate([...snapshots, snapshot]);
  const existing = snapshots[index];
  if (existing.currency === snapshot.currency && sameValues(existing.values, snapshot.values)) return snapshots;
  const next = [...snapshots];
  next[index] = snapshot;
  return next;
}

/** Combine two copies (e.g. this browser's and the relay's), keeping the later snapshot for each day. */
export function mergeSnapshots(a: Snapshot[], b: Snapshot[]): Snapshot[] {
  const byDate = new Map<string, Snapshot>();
  for (const snapshot of [...a, ...b]) {
    const existing = byDate.get(snapshot.date);
    if (!existing || snapshot.takenAt > existing.takenAt) byDate.set(snapshot.date, snapshot);
  }
  return sortByDate([...byDate.values()]);
}

/** Whether two snapshot lists hold the same data. */
export function sameSnapshots(a: Snapshot[], b: Snapshot[]): boolean {
  return (
    a.length === b.length &&
    a.every((snapshot, index) => {
      const other = b[index];
      return (
        snapshot.date === other.date &&
        snapshot.currency === other.currency &&
        snapshot.takenAt === other.takenAt &&
        sameValues(snapshot.values, other.values)
      );
    })
  );
}

/** Rename an account in every snapshot, e.g. after it is renamed in the ledger. */
export function renameSnapshotAccount(snapshots: Snapshot[], from: string, to: string): Snapshot[] {
  if (from === to) return snapshots;
  let changed = false;
  const next = snapshots.map((snapshot) => {
    const key = Object.keys(snapshot.values).find((name) => name.toLowerCase() === from.toLowerCase());
    if (key === undefined) return snapshot;
    changed = true;
    const values = { ...snapshot.values };
    const value = values[key];
    delete values[key];
    values[to] = (values[to] ?? 0) + value;
    return { ...snapshot, values };
  });
  return changed ? next : snapshots;
}

/** Read snapshots from stored JSON, dropping anything malformed. */
export function parseSnapshots(json: unknown): Snapshot[] {
  const list = Array.isArray(json)
    ? json
    : typeof json === 'object' && json !== null && Array.isArray((json as { snapshots?: unknown }).snapshots)
      ? (json as { snapshots: unknown[] }).snapshots
      : [];
  const snapshots: Snapshot[] = [];
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.date !== 'string' || !DATE_PATTERN.test(record.date)) continue;
    if (typeof record.currency !== 'string' || !record.currency) continue;
    if (typeof record.values !== 'object' || record.values === null || Array.isArray(record.values)) continue;
    const values: Record<string, number> = {};
    for (const [account, value] of Object.entries(record.values as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) values[account] = value;
    }
    snapshots.push({
      date: record.date,
      currency: record.currency,
      values,
      takenAt: typeof record.takenAt === 'number' && Number.isFinite(record.takenAt) ? record.takenAt : 0,
    });
  }
  return mergeSnapshots(snapshots, []);
}

/** Move a `YYYY-MM-DD` date by whole months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const target = new Date(year, month - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return localDate(target);
}

export interface SnapshotChartData {
  /** Accounts to draw, in the ledger's account order, then any older names. */
  accounts: string[];
  /** One row per recorded day; `values[i]` belongs to `accounts[i]`, `null` when it had no value then. */
  rows: Array<{ date: string; values: Array<number | null>; total: number }>;
  /** First and last day of the chart's time axis. */
  start: string;
  end: string;
}

/**
 * Chart rows for a window of `months` months in `currency`. Until the history
 * is that long, the window starts at the first snapshot and the line fills in
 * from the left; after that it rolls, ending today.
 */
export function chartData(
  snapshots: Snapshot[],
  currency: string,
  accountOrder: string[],
  today: string,
  months = 3,
): SnapshotChartData {
  const rollingStart = addMonths(today, -months);
  const inCurrency = snapshots.filter((snapshot) => snapshot.currency === currency && snapshot.date <= today);
  const first = inCurrency.find((snapshot) => snapshot.date >= rollingStart)?.date;
  const filling = first !== undefined && first > rollingStart && !inCurrency.some((snapshot) => snapshot.date < first);
  const start = filling ? first : rollingStart;
  const end = filling ? addMonths(first, months) : today;
  const shown = inCurrency.filter((snapshot) => snapshot.date >= start);
  const seen = new Set<string>();
  for (const snapshot of shown) for (const account of Object.keys(snapshot.values)) seen.add(account);
  const known = accountOrder.filter((account) => seen.has(account));
  const others = [...seen].filter((account) => !accountOrder.includes(account)).sort((a, b) => {
    // "No account" goes after the named ones.
    if (a === NO_ACCOUNT) return 1;
    if (b === NO_ACCOUNT) return -1;
    return a.localeCompare(b);
  });
  const accounts = [...known, ...others];
  const rows = shown.map((snapshot) => {
    const values = accounts.map((account) => snapshot.values[account] ?? null);
    return { date: snapshot.date, values, total: values.reduce<number>((sum, value) => sum + (value ?? 0), 0) };
  });
  return { accounts, rows, start, end };
}
