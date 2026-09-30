import { useState, type FormEvent } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { computeCashBalances } from '@/lib/cash';
import { cn } from '@/lib/utils';
import { findLabel, formatCurrency, normalizeLabel, type CashMovement, type Transaction } from '@/lib/portfolio';

interface AccountsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: string[];
  transactions: Transaction[];
  cash?: CashMovement[];
  currency: string;
  onAdd: (account: string) => string | undefined;
  onRename: (from: string, to: string) => boolean;
  onDelete: (account: string) => void;
}

export function AccountsDialog({
  open,
  onOpenChange,
  accounts,
  transactions,
  cash = [],
  currency,
  onAdd,
  onRename,
  onDelete,
}: AccountsDialogProps) {
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const usage: Record<string, number> = {};
  for (const entry of [...transactions, ...cash]) {
    if (entry.account) usage[entry.account] = (usage[entry.account] ?? 0) + 1;
  }
  const balances = computeCashBalances({ transactions, cash });

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = normalizeLabel(newName);
    if (!name) {
      setAddError('Enter an account name.');
      return;
    }
    if (findLabel(accounts, name)) {
      setAddError('That account already exists.');
      return;
    }
    onAdd(name);
    setNewName('');
    setAddError(null);
  };

  const startEdit = (account: string) => {
    setEditing(account);
    setEditName(account);
    setEditError(null);
  };

  const saveEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    if (!normalizeLabel(editName)) {
      setEditError('Enter an account name.');
      return;
    }
    if (!onRename(editing, editName)) {
      setEditError('Another account already has that name.');
      return;
    }
    setEditing(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setEditing(null);
          setAddError(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Accounts</DialogTitle>
          <DialogDescription>
            The accounts you trade in, such as an ISA or a general account. Holdings and cash are tracked
            separately per account. An account can only be deleted once no transactions use it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleAdd} className="space-y-2" noValidate>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(event) => {
                setNewName(event.target.value);
                setAddError(null);
              }}
              placeholder="New account name"
              aria-label="New account name"
              aria-invalid={Boolean(addError)}
              maxLength={64}
            />
            <Button type="submit">
              <Plus />
              Add
            </Button>
          </div>
          {addError ? <p className="text-xs text-destructive">{addError}</p> : null}
        </form>

        {accounts.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No accounts yet.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {accounts.map((account) => {
              const count = usage[account] ?? 0;
              const balance = balances.get(account)?.balance ?? 0;
              if (editing === account) {
                return (
                  <li key={account} className="p-2">
                    <form onSubmit={saveEdit} className="flex items-center gap-1" noValidate>
                      <Input
                        value={editName}
                        onChange={(event) => {
                          setEditName(event.target.value);
                          setEditError(null);
                        }}
                        aria-label={`New name for ${account}`}
                        aria-invalid={Boolean(editError)}
                        maxLength={64}
                        autoFocus
                        className="h-8"
                      />
                      <Button type="submit" variant="ghost" size="icon-sm" aria-label="Save name">
                        <Check />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Cancel rename"
                        onClick={() => setEditing(null)}
                      >
                        <X />
                      </Button>
                    </form>
                    {editError ? <p className="mt-1 px-1 text-xs text-destructive">{editError}</p> : null}
                  </li>
                );
              }
              return (
                <li key={account} className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{account}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className={cn('tabular-nums', balance < 0 && 'text-destructive')}>
                        {formatCurrency(balance, currency)} cash
                      </span>
                      {' · '}
                      {count === 0 ? 'No transactions' : `${count} transaction${count === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Rename ${account}`}
                    onClick={() => startEdit(account)}
                  >
                    <Pencil />
                  </Button>
                  {count > 0 ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        {/* A disabled button swallows hover, so the tooltip sits on a wrapper. */}
                        <span tabIndex={0} className="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Delete ${account} (in use)`}
                            disabled
                          >
                            <Trash2 />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Move or delete its transactions first</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${account}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(account)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
