import { Coins, FileUp, Plus, ShieldCheck, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  onAdd: () => void;
  onLoadSample: () => void;
  onImport: () => void;
  isLoggedIn: boolean;
}

export function EmptyState({ onAdd, onLoadSample, onImport, isLoggedIn }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed bg-card/50 px-6 py-14 text-center sm:px-12 sm:py-20">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
        <Coins className="size-7" />
      </div>

      <h2 className="mt-6 text-xl font-semibold tracking-tight sm:text-2xl">Start your ledger</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Record each buy and sell — date, quantity, price and fees. We'll work out your cost basis,
        open positions and realized profit/loss automatically.
      </p>

      <div className="mt-8 flex flex-col items-center justify-center gap-2 sm:flex-row">
        <Button onClick={onAdd} className="w-full sm:w-auto">
          <Plus />
          Add transaction
        </Button>
        <Button variant="outline" onClick={onImport} className="w-full sm:w-auto">
          <FileUp />
          Import CSV
        </Button>
        <Button variant="ghost" onClick={onLoadSample} className="w-full sm:w-auto">
          <Sparkles />
          Load sample data
        </Button>
      </div>

      <p className="mx-auto mt-8 flex max-w-md items-start justify-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span>
          {isLoggedIn
            ? 'Your ledger is encrypted to your own Nostr key and synced across your devices.'
            : 'Your data is stored in this browser. Sign in to encrypt it to your Nostr key and sync across devices.'}
        </span>
      </p>
    </div>
  );
}
