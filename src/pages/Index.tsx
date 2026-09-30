import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useSeoMeta } from '@unhead/react';
import { HardDrive, Plus, RefreshCw, ShieldCheck } from 'lucide-react';

import { LoginArea } from '@/components/auth/LoginArea';
import { AllocationBars } from '@/components/ledger/AllocationBars';
import { AppHeader } from '@/components/ledger/AppHeader';
import { DataMenu } from '@/components/ledger/DataMenu';
import { EmptyState } from '@/components/ledger/EmptyState';
import { HoldingsTable } from '@/components/ledger/HoldingsTable';
import { SummaryCards } from '@/components/ledger/SummaryCards';
import { TransactionDialog } from '@/components/ledger/TransactionDialog';
import { TransactionsTable } from '@/components/ledger/TransactionsTable';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useStockTransactions } from '@/hooks/useStockTransactions';
import { useToast } from '@/hooks/useToast';
import { csvToTransactions } from '@/lib/csv';
import { DEFAULT_CURRENCY } from '@/lib/currency';
import { computePortfolio, type Transaction, type TransactionInput } from '@/lib/portfolio';
import { sampleTransactions } from '@/lib/sampleData';

function LedgerSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="rounded-xl border bg-card p-5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="size-9 rounded-lg" />
            </div>
            <Skeleton className="mt-5 h-7 w-28" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="rounded-xl border bg-card p-5">
          <Skeleton className="h-4 w-28" />
          <div className="mt-5 space-y-3">
            {[0, 1, 2, 3, 4].map((index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <Skeleton className="h-4 w-24" />
          <div className="mt-5 space-y-4">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Index() {
  useSeoMeta({
    title: 'Ledger — Private stock transaction tracker',
    description:
      'Record stock buys and sells with dates, quantities, prices and fees. Track cost basis and realized P&L — encrypted and synced to your own Nostr relays.',
  });

  const {
    transactions,
    isLoading,
    isSyncing,
    isLoggedIn,
    canSync,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    replaceTransactions,
    clearTransactions,
    refresh,
  } = useStockTransactions();
  const { toast } = useToast();

  const [currency, setCurrency] = useLocalStorage('stock-ledger:currency', DEFAULT_CURRENCY);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const portfolio = useMemo(() => computePortfolio(transactions), [transactions]);

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (transaction: Transaction) => {
    setEditing(transaction);
    setDialogOpen(true);
  };

  const handleSubmit = (input: TransactionInput) => {
    if (editing) {
      updateTransaction(editing.id, input);
      toast({ title: 'Transaction updated' });
    } else {
      addTransaction(input);
      toast({ title: 'Transaction added' });
    }
    setDialogOpen(false);
  };

  const handleDelete = (id: string) => {
    deleteTransaction(id);
    toast({ title: 'Transaction deleted' });
  };

  const handleLoadSample = () => {
    replaceTransactions(sampleTransactions());
    toast({ title: 'Sample data loaded', description: 'Explore the dashboard, then clear it when ready.' });
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const { transactions: imported, skipped } = csvToTransactions(text);
      if (imported.length === 0) {
        toast({
          title: 'Nothing imported',
          description: 'No valid rows found. Make sure your file has date, symbol, type, quantity and price columns.',
          variant: 'destructive',
        });
        return;
      }
      replaceTransactions([...transactions, ...imported]);
      toast({
        title: `Imported ${imported.length} transaction${imported.length === 1 ? '' : 's'}`,
        description: skipped > 0 ? `${skipped} row${skipped === 1 ? '' : 's'} skipped.` : undefined,
      });
    } catch (error) {
      console.error('Failed to import CSV:', error);
      toast({ title: 'Import failed', description: 'The file could not be read.', variant: 'destructive' });
    }
  };

  const hasTransactions = transactions.length > 0;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleFileChange}
      />

      <AppHeader
        currency={currency}
        onCurrencyChange={setCurrency}
        isLoggedIn={isLoggedIn}
        isSyncing={isSyncing}
        canSync={canSync}
      >
        <DataMenu
          transactions={transactions}
          onRequestImport={() => fileInputRef.current?.click()}
          onLoadSample={handleLoadSample}
          onClear={clearTransactions}
        />
        <LoginArea className="max-w-44 sm:max-w-56" />
      </AppHeader>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Portfolio</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isLoggedIn
                ? 'Your ledger is encrypted to your Nostr key and synced to your relays.'
                : 'Your ledger is stored in this browser. Sign in to encrypt and sync it.'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isLoggedIn ? (
              <Button variant="outline" onClick={refresh} disabled={isSyncing} aria-label="Refresh from relays">
                <RefreshCw className={isSyncing ? 'animate-spin' : undefined} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            ) : null}
            <Button onClick={openAdd}>
              <Plus />
              Add transaction
            </Button>
          </div>
        </div>

        <div className="mt-8">
          {isLoading ? (
            <LedgerSkeleton />
          ) : !hasTransactions ? (
            <EmptyState
              onAdd={openAdd}
              onImport={() => fileInputRef.current?.click()}
              onLoadSample={handleLoadSample}
              isLoggedIn={isLoggedIn}
            />
          ) : (
            <div className="space-y-6">
              <SummaryCards portfolio={portfolio} currency={currency} />

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <Tabs defaultValue="holdings" className="min-w-0">
                  <TabsList>
                    <TabsTrigger value="holdings">Holdings</TabsTrigger>
                    <TabsTrigger value="transactions">Transactions</TabsTrigger>
                  </TabsList>

                  <TabsContent value="holdings" className="mt-4 space-y-6">
                    <HoldingsTable
                      holdings={portfolio.openHoldings}
                      currency={currency}
                      title="Open positions"
                      description="Cost basis and realized P&L are calculated with the average-cost method."
                      showFooter
                    />
                    {portfolio.closedHoldings.length > 0 ? (
                      <HoldingsTable
                        holdings={portfolio.closedHoldings}
                        currency={currency}
                        title="Closed positions"
                        showFooter
                      />
                    ) : null}
                  </TabsContent>

                  <TabsContent value="transactions" className="mt-4">
                    <TransactionsTable
                      transactions={transactions}
                      currency={currency}
                      onEdit={openEdit}
                      onDelete={handleDelete}
                    />
                  </TabsContent>
                </Tabs>

                <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
                  <AllocationBars holdings={portfolio.openHoldings} currency={currency} />

                  <Card className="gap-0 py-0">
                    <CardContent className="space-y-4 p-5">
                      <CardTitle className="flex items-center gap-2 text-base">
                        {isLoggedIn ? (
                          <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <HardDrive className="size-4 text-muted-foreground" />
                        )}
                        Where your data lives
                      </CardTitle>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        {isLoggedIn ? (
                          <>
                            <li>End-to-end encrypted to your own Nostr key — relays only see ciphertext.</li>
                            <li>Synced across every device you sign in on.</li>
                            <li>Export to CSV or JSON whenever you like.</li>
                          </>
                        ) : (
                          <>
                            <li>Stored only in this browser, on this device.</li>
                            <li>Sign in to encrypt it to your Nostr key and sync across devices.</li>
                            <li>Export to CSV or JSON whenever you like.</li>
                          </>
                        )}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <p>Ledger — cost basis and realized P&L, calculated locally.</p>
          <a
            href="https://shakespeare.diy"
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-foreground/80 underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            Vibed with Shakespeare
          </a>
        </div>
      </footer>

      <TransactionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        transaction={editing}
        transactions={transactions}
        symbols={portfolio.symbols}
        currency={currency}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
