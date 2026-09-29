import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CURRENCIES } from '@/lib/currency';
import { ThemeToggle } from './ThemeToggle';

interface AppHeaderProps {
  currency: string;
  onCurrencyChange: (currency: string) => void;
  isLoggedIn: boolean;
  isSyncing: boolean;
  canSync: boolean;
  children?: ReactNode;
}

function SyncStatus({ isLoggedIn, isSyncing, canSync }: Omit<AppHeaderProps, 'currency' | 'onCurrencyChange' | 'children'>) {
  if (!isLoggedIn) {
    return (
      <span className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground sm:inline-flex">
        <span className="size-1.5 rounded-full bg-amber-500" />
        Local only
      </span>
    );
  }

  if (!canSync) {
    return (
      <span className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground sm:inline-flex">
        <span className="size-1.5 rounded-full bg-amber-500" />
        Not encrypted
      </span>
    );
  }

  if (isSyncing) {
    return (
      <span className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-emerald-700 sm:inline-flex dark:text-emerald-400">
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
        Syncing
      </span>
    );
  }

  return (
    <span className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-emerald-700 sm:inline-flex dark:text-emerald-400">
      <ShieldCheck className="size-3.5" />
      Encrypted
    </span>
  );
}

export function AppHeader({
  currency,
  onCurrencyChange,
  isLoggedIn,
  isSyncing,
  canSync,
  children,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden="true">
              <path
                d="M4 19V9m0 0 3.5 3L12 6l4.5 4L20 5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-base font-semibold tracking-tight">Ledger</p>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
              Private stock transaction log
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <SyncStatus isLoggedIn={isLoggedIn} isSyncing={isSyncing} canSync={canSync} />
          <Select value={currency} onValueChange={onCurrencyChange}>
            <SelectTrigger size="sm" className="hidden w-20 sm:flex" aria-label="Display currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ThemeToggle />
          {children}
        </div>
      </div>
    </header>
  );
}
