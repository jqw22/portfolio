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
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  formatCurrency,
  parseNumber,
  todayIso,
  type Transaction,
  type TransactionInput,
  type TransactionType,
} from '@/lib/portfolio';

interface TransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: Transaction | null;
  symbols: string[];
  currency: string;
  onSubmit: (input: TransactionInput) => void;
}

interface FormState {
  type: TransactionType;
  symbol: string;
  name: string;
  date: string;
  quantity: string;
  price: string;
  fees: string;
  notes: string;
}

type FormErrors = Partial<Record<keyof FormState, string>>;

function initialForm(transaction: Transaction | null): FormState {
  return {
    type: transaction?.type ?? 'buy',
    symbol: transaction?.symbol ?? '',
    name: transaction?.name ?? '',
    date: transaction?.date ?? todayIso(),
    quantity: transaction ? String(transaction.quantity) : '',
    price: transaction ? String(transaction.price) : '',
    fees: transaction && transaction.fees ? String(transaction.fees) : '',
    notes: transaction?.notes ?? '',
  };
}

export function TransactionDialog({
  open,
  onOpenChange,
  transaction,
  symbols,
  currency,
  onSubmit,
}: TransactionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{transaction ? 'Edit transaction' : 'Add transaction'}</DialogTitle>
          <DialogDescription>Record a buy or sell. Amounts are entered in {currency}.</DialogDescription>
        </DialogHeader>
        <TransactionForm
          key={transaction?.id ?? 'new'}
          transaction={transaction}
          symbols={symbols}
          currency={currency}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

interface TransactionFormProps {
  transaction: Transaction | null;
  symbols: string[];
  currency: string;
  onCancel: () => void;
  onSubmit: (input: TransactionInput) => void;
}

function TransactionForm({ transaction, symbols, currency, onCancel, onSubmit }: TransactionFormProps) {
  const [form, setForm] = useState<FormState>(() => initialForm(transaction));
  const [errors, setErrors] = useState<FormErrors>({});

  const updateForm = (patch: Partial<FormState>) => {
    setForm((previous) => ({ ...previous, ...patch }));
  };

  const quantityValue = parseNumber(form.quantity);
  const priceValue = parseNumber(form.price);
  const feesValue = form.fees.trim() === '' ? 0 : parseNumber(form.fees);
  const gross = quantityValue !== null && priceValue !== null ? quantityValue * priceValue : 0;
  const total = gross + (feesValue ?? 0);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const symbol = form.symbol.trim().toUpperCase();
    const nextErrors: FormErrors = {};

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

    onSubmit({
      symbol,
      name: form.name,
      date: form.date,
      type: form.type,
      quantity: quantityValue ?? 0,
      price: priceValue ?? 0,
      fees: feesValue ?? 0,
      notes: form.notes,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label>Type</Label>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Transaction type">
          {(['buy', 'sell'] as const).map((option) => {
            const active = form.type === option;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => updateForm({ type: option })}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  active
                    ? cn(
                        'bg-background shadow-sm',
                        option === 'buy'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-rose-700 dark:text-rose-400',
                      )
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>

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
        <Label htmlFor="tx-notes">
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="tx-notes"
          value={form.notes}
          onChange={(event) => updateForm({ notes: event.target.value })}
          placeholder="Reason, broker, strategy..."
          rows={2}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2.5 text-sm">
        <span className="text-muted-foreground">Total with fees</span>
        <span className="font-semibold tabular-nums">{formatCurrency(total, currency)}</span>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">{transaction ? 'Save changes' : 'Add transaction'}</Button>
      </div>
    </form>
  );
}
