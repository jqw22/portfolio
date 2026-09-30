import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, Search, Trash2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LabelBadge } from '@/components/ledger/LabelBadge';
import { cn } from '@/lib/utils';
import {
  formatCurrency,
  formatDate,
  formatPrice,
  formatQuantity,
  type CashMovement,
  type Transaction,
} from '@/lib/portfolio';

type SortKey = 'date' | 'account' | 'symbol' | 'label' | 'quantity' | 'price' | 'total';
type SortDirection = 'asc' | 'desc';
type TypeFilter = 'all' | 'buy' | 'sell' | 'deposit' | 'withdrawal';

/** A row in the table: a trade or a deposit/withdrawal. */
type Row = { kind: 'trade'; entry: Transaction } | { kind: 'cash'; entry: CashMovement };

const TYPE_BADGES: Record<Exclude<TypeFilter, 'all'>, { label: string; className: string }> = {
  buy: { label: 'Buy', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  sell: { label: 'Sell', className: 'bg-rose-500/10 text-rose-700 dark:text-rose-400' },
  deposit: { label: 'Deposit', className: 'bg-sky-500/10 text-sky-700 dark:text-sky-400' },
  withdrawal: { label: 'Withdrawal', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
};

/** Select values for the label filter that can't collide with a label name. */
const ALL_LABELS = '\u0000all';
const NO_LABEL = '\u0000none';
const ALL_ACCOUNTS = '\u0000all';
const NO_ACCOUNT = '\u0000none';

interface TransactionsTableProps {
  transactions: Transaction[];
  cash?: CashMovement[];
  labels: string[];
  accounts: string[];
  currency: string;
  onEdit: (transaction: Transaction) => void;
  onEditCash?: (entry: CashMovement) => void;
  /** Delete a trade or cash movement by id. */
  onDelete: (id: string) => void;
}

function sortValue(row: Row, key: SortKey): string | number {
  if (row.kind === 'cash') {
    const entry = row.entry;
    switch (key) {
      case 'account':
        return entry.account ?? '';
      case 'symbol':
      case 'label':
        return '';
      case 'quantity':
      case 'price':
        return 0;
      case 'total':
        return entry.amount;
      case 'date':
      default:
        return entry.date;
    }
  }
  const transaction = row.entry;
  switch (key) {
    case 'symbol':
      return transaction.symbol;
    case 'account':
      return transaction.account ?? '';
    case 'label':
      return transaction.label ?? '';
    case 'quantity':
      return transaction.quantity;
    case 'price':
      return transaction.price;
    case 'total':
      return transaction.quantity * transaction.price;
    case 'date':
    default:
      return transaction.date;
  }
}

function rowName(row: Row): string {
  return row.kind === 'trade' ? `${row.entry.symbol} transaction` : row.entry.type;
}

function deleteDescription(row: Row, currency: string): string {
  if (row.kind === 'trade') {
    const tx = row.entry;
    return `This removes the ${tx.type} of ${formatQuantity(tx.quantity)} ${tx.symbol} on ${formatDate(tx.date)}.`;
  }
  const entry = row.entry;
  const direction = entry.type === 'deposit' ? 'into' : 'from';
  const where = entry.account ? ` ${direction} ${entry.account}` : '';
  return `This removes the ${entry.type} of ${formatCurrency(entry.amount, currency)}${where} on ${formatDate(entry.date)}.`;
}

export function TransactionsTable({
  transactions,
  cash = [],
  labels,
  accounts,
  currency,
  onEdit,
  onEditCash,
  onDelete,
}: TransactionsTableProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [selectedLabel, setSelectedLabel] = useState<string>(ALL_LABELS);
  // Fall back to "all" if the filtered label was deleted.
  const labelFilter = selectedLabel === ALL_LABELS || selectedLabel === NO_LABEL || labels.includes(selectedLabel)
    ? selectedLabel
    : ALL_LABELS;
  const [selectedAccount, setSelectedAccount] = useState<string>(ALL_ACCOUNTS);
  const accountFilter =
    selectedAccount === ALL_ACCOUNTS || selectedAccount === NO_ACCOUNT || accounts.includes(selectedAccount)
      ? selectedAccount
      : ALL_ACCOUNTS;
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const all: Row[] = [
      ...transactions.map((entry): Row => ({ kind: 'trade', entry })),
      ...cash.map((entry): Row => ({ kind: 'cash', entry })),
    ];
    const filtered = all.filter((row) => {
      const { entry } = row;
      const label = row.kind === 'trade' ? row.entry.label : undefined;
      if (typeFilter !== 'all' && entry.type !== typeFilter) return false;
      if (accountFilter === NO_ACCOUNT && entry.account) return false;
      if (accountFilter !== ALL_ACCOUNTS && accountFilter !== NO_ACCOUNT && entry.account !== accountFilter) {
        return false;
      }
      if (labelFilter === NO_LABEL && label) return false;
      if (labelFilter !== ALL_LABELS && labelFilter !== NO_LABEL && label !== labelFilter) return false;
      if (!query) return true;
      const haystack =
        row.kind === 'trade'
          ? [row.entry.symbol, row.entry.name, row.entry.notes, row.entry.label, row.entry.account]
          : [TYPE_BADGES[row.entry.type].label, 'cash', row.entry.notes, row.entry.account];
      return haystack.some((value) => (value ?? '').toLowerCase().includes(query));
    });

    return [...filtered].sort((a, b) => {
      const left = sortValue(a, sortKey);
      const right = sortValue(b, sortKey);
      const comparison =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right));
      return sortDir === 'asc' ? comparison : -comparison;
    });
  }, [transactions, cash, search, typeFilter, accountFilter, labelFilter, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((previous) => (previous === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const renderSortHeader = (label: string, key: SortKey, className?: string) => {
    const active = sortKey === key;
    return (
      <TableHead className={className}>
        <button
          type="button"
          onClick={() => handleSort(key)}
          className={cn(
            'inline-flex items-center gap-1 rounded-sm text-inherit transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            active ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {label}
          {active ? (
            sortDir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
          ) : (
            <ArrowUpDown className="size-3 opacity-40" />
          )}
        </button>
      </TableHead>
    );
  };

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b pb-5">
        <CardTitle className="flex items-center gap-2 text-base">
          Transactions
          <Badge variant="secondary">{rows.length}</Badge>
        </CardTitle>
      </CardHeader>

      <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search symbol, name, account, label or notes"
            aria-label="Search transactions"
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as TypeFilter)}>
          <SelectTrigger className="w-full sm:w-36" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="buy">Buy</SelectItem>
            <SelectItem value="sell">Sell</SelectItem>
            <SelectItem value="deposit">Deposit</SelectItem>
            <SelectItem value="withdrawal">Withdrawal</SelectItem>
          </SelectContent>
        </Select>
        {accounts.length > 0 ? (
          <Select value={accountFilter} onValueChange={setSelectedAccount}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Filter by account">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ACCOUNTS}>All accounts</SelectItem>
              <SelectItem value={NO_ACCOUNT}>No account</SelectItem>
              {accounts.map((account) => (
                <SelectItem key={account} value={account}>
                  {account}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {labels.length > 0 ? (
          <Select value={labelFilter} onValueChange={setSelectedLabel}>
            <SelectTrigger className="w-full sm:w-40" aria-label="Filter by label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_LABELS}>All labels</SelectItem>
              <SelectItem value={NO_LABEL}>No label</SelectItem>
              {labels.map((label) => (
                <SelectItem key={label} value={label}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No transactions match your filters.
        </CardContent>
      ) : (
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {renderSortHeader('Date', 'date', 'pl-6')}
                {renderSortHeader('Account', 'account')}
                {renderSortHeader('Symbol', 'symbol')}
                <TableHead>Type</TableHead>
                {renderSortHeader('Label', 'label')}
                {renderSortHeader('Quantity', 'quantity', 'text-right')}
                {renderSortHeader('Price', 'price', 'text-right')}
                <TableHead className="text-right">Fees</TableHead>
                {renderSortHeader('Total', 'total', 'text-right')}
                <TableHead className="hidden lg:table-cell">Notes</TableHead>
                <TableHead className="pr-6 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const badge = TYPE_BADGES[row.entry.type];
                const account = row.entry.account;
                return (
                  <TableRow key={row.entry.id}>
                    <TableCell className="pl-6 whitespace-nowrap text-muted-foreground">
                      {formatDate(row.entry.date)}
                    </TableCell>
                    <TableCell>
                      {account ? (
                        <span className="block max-w-[10rem] truncate font-medium">{account}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.kind === 'trade' ? (
                        <>
                          <div className="font-semibold">{row.entry.symbol}</div>
                          {row.entry.name ? (
                            <p className="max-w-[14rem] truncate text-xs text-muted-foreground">{row.entry.name}</p>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">Cash</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={cn('border-transparent', badge.className)}>{badge.label}</Badge>
                    </TableCell>
                    <TableCell>
                      {row.kind === 'trade' && row.entry.label ? (
                        <LabelBadge label={row.entry.label} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {row.kind === 'trade' ? (
                      <>
                        <TableCell className="text-right tabular-nums">{formatQuantity(row.entry.quantity)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPrice(row.entry.price, currency)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {row.entry.fees > 0 ? formatCurrency(row.entry.fees, currency) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(row.entry.quantity * row.entry.price, currency)}
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(row.entry.type === 'deposit' ? row.entry.amount : -row.entry.amount, currency)}
                        </TableCell>
                      </>
                    )}
                    <TableCell className="hidden max-w-[16rem] truncate text-muted-foreground lg:table-cell">
                      {row.entry.notes ?? '—'}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit ${rowName(row)}`}
                          onClick={() => (row.kind === 'trade' ? onEdit(row.entry) : onEditCash?.(row.entry))}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${rowName(row)}`}
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setPendingDelete(row)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? deleteDescription(pendingDelete, currency) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.entry.id);
                setPendingDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
