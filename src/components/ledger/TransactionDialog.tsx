import { useState, type FormEvent } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { LabelPicker } from '@/components/ledger/LabelPicker';
import { cn } from '@/lib/utils';
import { computeCashBalances, newCashShortfalls, type CashBalance } from '@/lib/cash';
import {
  formatCurrency,
  formatDate,
  makeCashMovement,
  makeTransaction,
  oversoldPositions,
  parseNumber,
  todayIso,
  type CashMovement,
  type CashMovementInput,
  type CashType,
  type Transaction,
  type TransactionInput,
  type TransactionType,
} from '@/lib/portfolio';

interface TransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The trade being edited, if any. */
  transaction: Transaction | null;
  /** The deposit or withdrawal being edited, if any. */
  cashMovement?: CashMovement | null;
  /** All recorded trades, used to stop oversells and buys without enough cash. */
  transactions: Transaction[];
  /** All recorded deposits and withdrawals. */
  cash?: CashMovement[];
  symbols: string[];
  currency: string;
  labels: string[];
  accounts: string[];
  onCreateLabel: (label: string) => string | undefined;
  onDeleteLabel: (label: string) => void;
  onSubmit: (input: TransactionInput) => void;
  onSubmitCash?: (input: CashMovementInput) => void;
  /** Opens the accounts manager, offered when there are no accounts yet. */
  onManageAccounts?: () => void;
}

type EntryType = TransactionType | CashType;

const ENTRY_TYPES: { value: EntryType; label: string; className: string }[] = [
  { value: 'buy', label: 'Buy', className: 'text-emerald-700 dark:text-emerald-400' },
  { value: 'sell', label: 'Sell', className: 'text-rose-700 dark:text-rose-400' },
  { value: 'deposit', label: 'Deposit', className: 'text-sky-700 dark:text-sky-400' },
  { value: 'withdrawal', label: 'Withdraw', className: 'text-amber-700 dark:text-amber-400' },
];

function isCashType(type: EntryType): type is CashType {
  return type === 'deposit' || type === 'withdrawal';
}

interface FormState {
  type: EntryType;
  symbol: string;
  name: string;
  date: string;
  quantity: string;
  price: string;
  fees: string;
  amount: string;
  notes: string;
  label: string | undefined;
  account: string | undefined;
}

type FormErrors = Partial<Record<keyof FormState | 'cash', string>>;

function initialForm(transaction: Transaction | null, cashMovement: CashMovement | null): FormState {
  if (cashMovement) {
    return {
      type: cashMovement.type,
      symbol: '',
      name: '',
      date: cashMovement.date,
      quantity: '',
      price: '',
      fees: '',
      amount: String(cashMovement.amount),
      notes: cashMovement.notes ?? '',
      label: undefined,
      account: cashMovement.account,
    };
  }
  return {
    type: transaction?.type ?? 'buy',
    symbol: transaction?.symbol ?? '',
    name: transaction?.name ?? '',
    date: transaction?.date ?? todayIso(),
    quantity: transaction ? String(transaction.quantity) : '',
    price: transaction ? String(transaction.price) : '',
    fees: transaction && transaction.fees ? String(transaction.fees) : '',
    amount: '',
    notes: transaction?.notes ?? '',
    label: transaction?.label,
    account: transaction?.account,
  };
}

function dialogTitle(transaction: Transaction | null, cashMovement: CashMovement | null): string {
  if (cashMovement) return cashMovement.type === 'deposit' ? 'Edit deposit' : 'Edit withdrawal';
  return transaction ? 'Edit transaction' : 'Add transaction';
}

export function TransactionDialog({
  open,
  onOpenChange,
  transaction,
  cashMovement = null,
  transactions,
  cash = [],
  symbols,
  currency,
  labels,
  accounts,
  onCreateLabel,
  onDeleteLabel,
  onSubmit,
  onSubmitCash,
  onManageAccounts,
}: TransactionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{dialogTitle(transaction, cashMovement)}</DialogTitle>
          <DialogDescription>
            Record a buy, a sell, or cash paid in or out of an account. Amounts are entered in {currency}.
          </DialogDescription>
        </DialogHeader>
        <TransactionForm
          key={cashMovement?.id ?? transaction?.id ?? 'new'}
          transaction={transaction}
          cashMovement={cashMovement}
          transactions={transactions}
          cash={cash}
          symbols={symbols}
          currency={currency}
          labels={labels}
          accounts={accounts}
          onCreateLabel={onCreateLabel}
          onDeleteLabel={onDeleteLabel}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
          onSubmitCash={onSubmitCash}
          onManageAccounts={onManageAccounts}
        />
      </DialogContent>
    </Dialog>
  );
}

interface TransactionFormProps {
  transaction: Transaction | null;
  cashMovement: CashMovement | null;
  transactions: Transaction[];
  cash: CashMovement[];
  symbols: string[];
  currency: string;
  labels: string[];
  accounts: string[];
  onCreateLabel: (label: string) => string | undefined;
  onDeleteLabel: (label: string) => void;
  onCancel: () => void;
  onSubmit: (input: TransactionInput) => void;
  onSubmitCash?: (input: CashMovementInput) => void;
  onManageAccounts?: () => void;
}

function shortfallMessage(shortfall: CashBalance, currency: string): string {
  const where = shortfall.account ? `in ${shortfall.account}` : 'with no account';
  const when = shortfall.lowestDate ? ` on ${formatDate(shortfall.lowestDate)}` : '';
  return `Not enough cash ${where}. This would take the balance to ${formatCurrency(shortfall.lowest, currency)}${when}.`;
}

function TransactionForm({
  transaction,
  cashMovement,
  transactions,
  cash,
  symbols,
  currency,
  labels,
  accounts,
  onCreateLabel,
  onDeleteLabel,
  onCancel,
  onSubmit,
  onSubmitCash,
  onManageAccounts,
}: TransactionFormProps) {
  const [form, setForm] = useState<FormState>(() => initialForm(transaction, cashMovement));
  const [errors, setErrors] = useState<FormErrors>({});

  const updateForm = (patch: Partial<FormState>) => {
    setForm((previous) => ({ ...previous, ...patch }));
    setErrors((previous) => (previous.cash ? { ...previous, cash: undefined } : previous));
  };

  const editingId = cashMovement?.id ?? transaction?.id;
  const isCash = isCashType(form.type);
  // An existing entry can switch between buy and sell, or deposit and withdrawal, but not across.
  const lockedToCash = cashMovement !== null;
  const lockedToTrade = transaction !== null;

  const quantityValue = parseNumber(form.quantity);
  const priceValue = parseNumber(form.price);
  const feesValue = form.fees.trim() === '' ? 0 : parseNumber(form.fees);
  const amountValue = parseNumber(form.amount);
  const gross = quantityValue !== null && priceValue !== null ? quantityValue * priceValue : 0;
  const total = form.type === 'sell' ? gross - (feesValue ?? 0) : gross + (feesValue ?? 0);

  // Cash in the chosen account, leaving out the entry being edited.
  const otherTransactions = transactions.filter((tx) => tx.id !== editingId);
  const otherCash = cash.filter((entry) => entry.id !== editingId);
  const available = form.account
    ? (computeCashBalances({ transactions: otherTransactions, cash: otherCash }).get(form.account)?.balance ?? 0)
    : null;

  const labelUsage: Record<string, number> = {};
  for (const tx of transactions) {
    if (tx.label) labelUsage[tx.label] = (labelUsage[tx.label] ?? 0) + 1;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isCashType(form.type)) submitCash(form.type);
    else submitTrade(form.type);
  };

  const submitCash = (type: CashType) => {
    const nextErrors: FormErrors = {};
    if (!form.account) nextErrors.account = 'Choose an account.';
    if (!form.date) nextErrors.date = 'Pick a date.';
    if (amountValue === null || amountValue <= 0) nextErrors.amount = 'Enter an amount greater than zero.';
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const input: CashMovementInput = {
      date: form.date,
      type,
      amount: amountValue ?? 0,
      account: form.account,
      notes: form.notes,
    };

    const shortfall = newCashShortfalls(
      { transactions, cash },
      { transactions, cash: [...otherCash, makeCashMovement(input, editingId)] },
    );
    if (shortfall.length > 0) {
      setErrors({ amount: shortfallMessage(shortfall[0], currency) });
      return;
    }

    onSubmitCash?.(input);
  };

  const submitTrade = (type: TransactionType) => {
    const symbol = form.symbol.trim().toUpperCase();
    const nextErrors: FormErrors = {};

    if (!form.account) nextErrors.account = 'Choose an account.';
    if (!symbol) nextErrors.symbol = 'Enter a ticker symbol.';
    if (!form.date) nextErrors.date = 'Pick a trade date.';
    if (quantityValue === null || quantityValue <= 0) {
      nextErrors.quantity = 'Enter a quantity greater than zero.';
    }
    if (priceValue === null || priceValue < 0) nextErrors.price = 'Enter a valid price.';
    if (feesValue === null || feesValue < 0) nextErrors.fees = 'Enter a valid fee amount.';

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const input: TransactionInput = {
      symbol,
      name: form.name,
      date: form.date,
      type,
      quantity: quantityValue ?? 0,
      price: priceValue ?? 0,
      fees: feesValue ?? 0,
      notes: form.notes,
      label: form.label,
      account: form.account,
    };
    const next = [...otherTransactions, makeTransaction(input, editingId)];

    // Only block oversells this change introduces, so existing bad data doesn't lock the form.
    const before = new Set(oversoldPositions(transactions).map((holding) => holding.key));
    const after = oversoldPositions(next);
    const newlyOversold = after.filter(
      (holding) => !before.has(holding.key) && (holding.symbol === symbol || holding.symbol === transaction?.symbol),
    );
    if (newlyOversold.length > 0) {
      const names = Array.from(new Set(newlyOversold.map((holding) => holding.symbol))).join(', ');
      const where = form.account ? ` in ${form.account}` : accounts.length > 0 ? ' with no account' : '';
      setErrors({
        quantity: `This would sell more ${names} shares than you hold${where} at that point.`,
      });
      return;
    }

    const shortfall = newCashShortfalls({ transactions, cash }, { transactions: next, cash });
    if (shortfall.length > 0) {
      setErrors({ cash: shortfallMessage(shortfall[0], currency) });
      return;
    }

    onSubmit(input);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label>Type</Label>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 sm:grid-cols-4" role="group" aria-label="Transaction type">
          {ENTRY_TYPES.map((option) => {
            const active = form.type === option.value;
            const disabled = isCashType(option.value) ? lockedToTrade : lockedToCash;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={() => {
                  updateForm({ type: option.value });
                  setErrors({});
                }}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40',
                  active ? cn('bg-background shadow-sm', option.className) : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="tx-account">Account</Label>
        <Select value={form.account ?? ''} onValueChange={(value) => updateForm({ account: value || undefined })}>
          <SelectTrigger id="tx-account" className="w-full" aria-invalid={Boolean(errors.account)}>
            <SelectValue placeholder={accounts.length === 0 ? 'No accounts yet' : 'Choose an account'} />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account} value={account}>
                {account}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.account ? <p className="text-xs text-destructive">{errors.account}</p> : null}
        {accounts.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Every entry belongs to an account.{' '}
            {onManageAccounts ? (
              <button
                type="button"
                onClick={onManageAccounts}
                className="rounded-sm font-medium text-foreground underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                Add an account
              </button>
            ) : (
              'Add one with the Accounts button on the main page.'
            )}
          </p>
        ) : null}
      </div>

      {isCash ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="tx-date">Date</Label>
            <Input
              id="tx-date"
              type="date"
              value={form.date}
              onChange={(event) => updateForm({ date: event.target.value })}
              aria-invalid={Boolean(errors.date)}
            />
            {errors.date ? <p className="text-xs text-destructive">{errors.date}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tx-amount">Amount</Label>
            <Input
              id="tx-amount"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={form.amount}
              onChange={(event) => updateForm({ amount: event.target.value })}
              placeholder="0.00"
              aria-invalid={Boolean(errors.amount)}
            />
          </div>
          {errors.amount ? <p className="text-xs text-destructive sm:col-span-2">{errors.amount}</p> : null}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tx-symbol">Symbol</Label>
              <Input
                id="tx-symbol"
                value={form.symbol}
                onChange={(event) => updateForm({ symbol: event.target.value.toUpperCase() })}
                placeholder="AAPL"
                autoComplete="off"
                list="ledger-symbols"
                aria-invalid={Boolean(errors.symbol)}
                className="uppercase"
              />
              <datalist id="ledger-symbols">
                {symbols.map((symbol) => (
                  <option key={symbol} value={symbol} />
                ))}
              </datalist>
              {errors.symbol ? <p className="text-xs text-destructive">{errors.symbol}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="tx-date">Trade date</Label>
              <Input
                id="tx-date"
                type="date"
                value={form.date}
                onChange={(event) => updateForm({ date: event.target.value })}
                aria-invalid={Boolean(errors.date)}
              />
              {errors.date ? <p className="text-xs text-destructive">{errors.date}</p> : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tx-name">
              Name <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="tx-name"
              value={form.name}
              onChange={(event) => updateForm({ name: event.target.value })}
              placeholder="Apple Inc."
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="tx-quantity">Quantity</Label>
              <Input
                id="tx-quantity"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={form.quantity}
                onChange={(event) => updateForm({ quantity: event.target.value })}
                placeholder="10"
                aria-invalid={Boolean(errors.quantity)}
              />
              {errors.quantity ? <p className="text-xs text-destructive">{errors.quantity}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="tx-price">Price / share</Label>
              <Input
                id="tx-price"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={form.price}
                onChange={(event) => updateForm({ price: event.target.value })}
                placeholder="0.00"
                aria-invalid={Boolean(errors.price)}
              />
              {errors.price ? <p className="text-xs text-destructive">{errors.price}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="tx-fees">Fees</Label>
              <Input
                id="tx-fees"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={form.fees}
                onChange={(event) => updateForm({ fees: event.target.value })}
                placeholder="0.00"
                aria-invalid={Boolean(errors.fees)}
              />
              {errors.fees ? <p className="text-xs text-destructive">{errors.fees}</p> : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tx-label">
              Label <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <LabelPicker
              id="tx-label"
              value={form.label}
              labels={labels}
              usage={labelUsage}
              onChange={(label) => updateForm({ label })}
              onCreate={onCreateLabel}
              onDelete={onDeleteLabel}
            />
          </div>
        </>
      )}

      <div className="space-y-2">
        <Label htmlFor="tx-notes">
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="tx-notes"
          value={form.notes}
          onChange={(event) => updateForm({ notes: event.target.value })}
          placeholder={isCash ? 'Transfer reference, source...' : 'Reason, broker, strategy...'}
          rows={2}
        />
      </div>

      <div className="space-y-1.5 rounded-lg bg-muted/60 px-3 py-2.5 text-sm">
        {!isCash ? (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{form.type === 'sell' ? 'Proceeds after fees' : 'Total with fees'}</span>
            <span className="font-semibold tabular-nums">{formatCurrency(total, currency)}</span>
          </div>
        ) : null}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">
            {form.account ? `Cash in ${form.account}` : 'Cash available'}
          </span>
          <span className={cn('font-medium tabular-nums', available !== null && available < 0 && 'text-destructive')}>
            {available === null ? '—' : formatCurrency(available, currency)}
          </span>
        </div>
      </div>
      {errors.cash ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.cash}
        </p>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{transaction || cashMovement ? 'Save changes' : 'Add transaction'}</Button>
      </div>
    </form>
  );
}
