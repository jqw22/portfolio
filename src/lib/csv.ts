/**
 * CSV import/export for the transaction ledger.
 *
 * The exported format is intentionally spreadsheet-friendly:
 *
 *   Date,Symbol,Name,Type,Quantity,Price,Fees,Notes,Label,Account,Amount
 *
 * Trades leave `Amount` blank. Deposits and withdrawals use the `Deposit` or
 * `Withdrawal` type with `Date`, `Account`, `Amount` and optional `Notes`.
 *
 * The importer is far more forgiving — it matches headers case-insensitively,
 * accepts common synonyms (`qty`, `shares`, `ticker`, ...) and falls back to
 * positional columns when no header row is present.
 */

import {
  newId,
  normalizeDate,
  normalizeLabel,
  parseNumber,
  type CashMovement,
  type CashType,
  type Transaction,
  type TransactionType,
} from './portfolio';

export const CSV_HEADERS = ['Date', 'Symbol', 'Name', 'Type', 'Quantity', 'Price', 'Fees', 'Notes', 'Label', 'Account', 'Amount'] as const;

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serialize trades and cash movements to a CSV string, oldest first. */
export function transactionsToCsv(transactions: Transaction[], cash: CashMovement[] = []): string {
  const rows = [CSV_HEADERS.join(',')];
  const entries = [
    ...cash.map((entry) => ({ date: entry.date, row: cashRow(entry) })),
    ...transactions.map((tx) => ({ date: tx.date, row: tradeRow(tx) })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const entry of entries) rows.push(entry.row.map(csvCell).join(','));
  return rows.join('\n');
}

function cashRow(entry: CashMovement): string[] {
  return [
    entry.date,
    '',
    '',
    entry.type === 'deposit' ? 'Deposit' : 'Withdrawal',
    '',
    '',
    '',
    entry.notes ?? '',
    '',
    entry.account ?? '',
    String(entry.amount),
  ];
}

function tradeRow(tx: Transaction): string[] {
  return [
    tx.date,
    tx.symbol,
    tx.name ?? '',
    tx.type,
    String(tx.quantity),
    String(tx.price),
    String(tx.fees),
    tx.notes ?? '',
    tx.label ?? '',
    tx.account ?? '',
    '',
  ];
}

/** Parse CSV text into rows of cells, honoring quoted fields and escaped quotes. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

function normalizeType(value: string): TransactionType | CashType | null {
  const normalized = value.trim().toLowerCase();
  if (['buy', 'b', 'bought', 'purchase', 'purchased', 'long'].includes(normalized)) return 'buy';
  if (['sell', 's', 'sold', 'sale', 'short'].includes(normalized)) return 'sell';
  if (['deposit', 'deposited', 'cash in', 'contribution', 'top up', 'top-up', 'transfer in'].includes(normalized)) {
    return 'deposit';
  }
  if (['withdrawal', 'withdraw', 'withdrew', 'cash out', 'transfer out'].includes(normalized)) return 'withdrawal';
  return null;
}

export interface CsvImportResult {
  transactions: Transaction[];
  cash: CashMovement[];
  /** Rows that could not be parsed. */
  skipped: number;
}

/** Convert CSV text into trades and cash movements, skipping rows that don't parse cleanly. */
export function csvToTransactions(text: string): CsvImportResult {
  const rows = parseCsv(text);
  if (rows.length === 0) return { transactions: [], cash: [], skipped: 0 };

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const knownHeaders = ['date', 'symbol', 'type', 'quantity', 'price'];
  const matched = knownHeaders.filter((name) => header.includes(name)).length;
  const hasHeader = matched >= 3;
  const dataRows = hasHeader ? rows.slice(1) : rows;

  const column = (...names: string[]): number => {
    if (!hasHeader) return -1;
    for (const name of names) {
      const index = header.indexOf(name);
      if (index !== -1) return index;
    }
    return -1;
  };

  const dateCol = hasHeader ? column('date', 'transaction date', 'trade date', 'transacted') : 0;
  const symbolCol = hasHeader ? column('symbol', 'ticker', 'stock', 'asset', 'security') : 1;
  const nameCol = hasHeader ? column('name', 'company', 'description', 'security name') : 2;
  const typeCol = hasHeader ? column('type', 'action', 'side', 'transaction type', 'direction') : 3;
  const quantityCol = hasHeader ? column('quantity', 'qty', 'shares', 'units', 'amount') : 4;
  const priceCol = hasHeader ? column('price', 'price per share', 'unit price', 'cost', 'unit cost') : 5;
  const feesCol = hasHeader ? column('fees', 'fee', 'commission', 'commissions') : 6;
  const notesCol = hasHeader ? column('notes', 'note', 'memo', 'comment', 'comments') : 7;
  const labelCol = hasHeader ? column('label', 'tag', 'category') : 8;
  const accountCol = hasHeader ? column('account', 'account name', 'portfolio', 'wrapper') : 9;
  const amountCol = hasHeader ? column('amount', 'cash amount', 'value') : 10;

  const cell = (row: string[], index: number): string => (index >= 0 && index < row.length ? row[index].trim() : '');

  const transactions: Transaction[] = [];
  const cash: CashMovement[] = [];
  let skipped = 0;

  for (const row of dataRows) {
    const date = normalizeDate(cell(row, dateCol));
    const type = normalizeType(cell(row, typeCol));

    if (type === 'deposit' || type === 'withdrawal') {
      // Withdrawals are often exported as negative amounts; the type carries the sign.
      const raw = parseNumber(cell(row, amountCol)) ?? parseNumber(cell(row, priceCol));
      const amount = raw === null ? null : Math.abs(raw);
      if (!date || amount === null || amount <= 0) {
        skipped += 1;
        continue;
      }
      const notes = cell(row, notesCol);
      cash.push({
        id: newId(),
        date,
        type,
        amount,
        account: normalizeLabel(cell(row, accountCol)),
        notes: notes || undefined,
      });
      continue;
    }

    const symbol = cell(row, symbolCol).replace(/\s+/g, '').toUpperCase();
    const quantity = parseNumber(cell(row, quantityCol));
    const price = parseNumber(cell(row, priceCol));
    const fees = parseNumber(cell(row, feesCol)) ?? 0;

    if (!date || !symbol || !type || quantity === null || quantity <= 0 || price === null || price < 0) {
      skipped += 1;
      continue;
    }

    const name = cell(row, nameCol);
    const notes = cell(row, notesCol);

    transactions.push({
      id: newId(),
      symbol,
      name: name || undefined,
      date,
      type,
      quantity,
      price,
      fees,
      notes: notes || undefined,
      label: normalizeLabel(cell(row, labelCol)),
      account: normalizeLabel(cell(row, accountCol)),
    });
  }

  return { transactions, cash, skipped };
}
