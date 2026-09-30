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
import { formatCurrency, formatDate, formatPrice, formatQuantity, type Transaction } from '@/lib/portfolio';

type SortKey = 'date' | 'account' | 'symbol' | 'label' | 'quantity' | 'price' | 'total';
type SortDirection = 'asc' | 'desc';
type TypeFilter = 'all' | 'buy' | 'sell';

/** Select values for the label filter that can't collide with a label name. */
const ALL_LABELS = '\u0000all';
const NO_LABEL = '\u0000none';
const ALL_ACCOUNTS = '\u0000all';
const NO_ACCOUNT = '\u0000none';

interface TransactionsTableProps {
  transactions: Transaction[];
  labels: string[];
  accounts: string[];
  currency: string;
  onEdit: (transaction: Transaction) => void;
  onDelete: (id: string) => void;
}

function sortValue(transaction: Transaction, key: SortKey): string | number {
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

export function TransactionsTable({
  transactions,
  labels,
  accounts,
  currency,
  onEdit,
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
  const [pendingDelete, setPendingDelete] = useState<Transaction | null>(null);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = transactions.filter((transaction) => {
      if (typeFilter !== 'all' && transaction.type !== typeFilter) return false;
      if (accountFilter === NO_ACCOUNT && transaction.account) return false;
      if (accountFilter !== ALL_ACCOUNTS && accountFilter !== NO_ACCOUNT && transaction.account !== accountFilter) {
        return false;
      }
      if (labelFilter === NO_LABEL && transaction.label) return false;
      if (labelFilter !== ALL_LABELS && labelFilter !== NO_LABEL && transaction.label !== labelFilter) return false;
      if (!query) return true;
      return (
        transaction.symbol.toLowerCase().includes(query) ||
        (transaction.name ?? '').toLowerCase().includes(query) ||
        (transaction.notes ?? '').toLowerCase().includes(query) ||
        (transaction.label ?? '').toLowerCase().includes(query) ||
        (transaction.account ?? '').toLowerCase().includes(query)
      );
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
  }, [transactions, search, typeFilter, accountFilter, labelFilter, sortKey, sortDir]);

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
          <SelectTrigger className="w-full sm:w-32" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="buy">Buy</SelectItem>
            <SelectItem value="sell">Sell</SelectItem>
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
              {rows.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell className="pl-6 whitespace-nowrap text-muted-foreground">
                    {formatDate(transaction.date)}
                  </TableCell>
                  <TableCell>
                    {transaction.account ? (
                      <span className="block max-w-[10rem] truncate font-medium">{transaction.account}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold">{transaction.symbol}</div>
                    {transaction.name ? (
                      <p className="max-w-[14rem] truncate text-xs text-muted-foreground">{transaction.name}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={cn(
                        'border-transparent',
                        transaction.type === 'buy'
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          : 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
                      )}
                    >
                      {transaction.type === 'buy' ? 'Buy' : 'Sell'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {transaction.label ? (
                      <LabelBadge label={transaction.label} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatQuantity(transaction.quantity)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPrice(transaction.price, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {transaction.fees > 0 ? formatCurrency(transaction.fees, currency) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(transaction.quantity * transaction.price, currency)}
                  </TableCell>
                  <TableCell className="hidden max-w-[16rem] truncate text-muted-foreground lg:table-cell">
                    {transaction.notes ?? '—'}
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${transaction.symbol} transaction`}
                        onClick={() => onEdit(transaction)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${transaction.symbol} transaction`}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setPendingDelete(transaction)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `This removes the ${pendingDelete.type} of ${formatQuantity(pendingDelete.quantity)} ${pendingDelete.symbol} on ${formatDate(pendingDelete.date)}.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.id);
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
