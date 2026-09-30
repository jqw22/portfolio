import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useSeoMeta } from '@unhead/react';
import { LineChart, Plus, RefreshCw, Wallet } from 'lucide-react';

import { LoginArea } from '@/components/auth/LoginArea';
import { AccountsDialog } from '@/components/ledger/AccountsDialog';
import { AppHeader } from '@/components/ledger/AppHeader';
import { DataMenu } from '@/components/ledger/DataMenu';
import { EmptyState } from '@/components/ledger/EmptyState';
import { HoldingsTable, HoldingsTotal } from '@/components/ledger/HoldingsTable';
import { PricesDialog } from '@/components/ledger/PricesDialog';
import { SummaryCards } from '@/components/ledger/SummaryCards';
import { TransactionDialog } from '@/components/ledger/TransactionDialog';
import { TransactionsTable } from '@/components/ledger/TransactionsTable';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { usePrices } from '@/hooks/usePrices';
import { useStockTransactions } from '@/hooks/useStockTransactions';
import { useToast } from '@/hooks/useToast';
import { cashBalanceList, newCashShortfalls, type CashBalance } from '@/lib/cash';
import { csvToTransactions } from '@/lib/csv';
import { DEFAULT_CURRENCY } from '@/lib/currency';
import {
  computePortfolio,
  formatCurrency,
  formatDate,
  type CashMovement,
  type CashMovementInput,
  type Holding,
  type Transaction,
  type TransactionInput,
} from '@/lib/portfolio';
import { sampleLedger } from '@/lib/sampleData';

interface AccountPositions {
  key: string;
  account?: string;
  holdings: Holding[];
  cash: CashBalance[];
}

/**
 * Split open positions and cash by account, in the order of the account list,
 * with accounts that aren't in the list after it and entries with no account last.
 */
function groupByAccount(holdings: Holding[], cashBalances: CashBalance[], accounts: string[]): AccountPositions[] {
  const groups = new Map<string, AccountPositions>();
  const groupFor = (account: string | undefined): AccountPositions => {
    const key = account ?? '';
    let group = groups.get(key);
    if (!group) {
      group = { key, account, holdings: [], cash: [] };
      groups.set(key, group);
    }
    return group;
  };
  for (const holding of holdings) groupFor(holding.account).holdings.push(holding);
  for (const cash of cashBalances) groupFor(cash.account).cash.push(cash);

  const order = (group: AccountPositions): number => {
    if (!group.account) return accounts.length + 1;
    const index = accounts.indexOf(group.account);
    return index === -1 ? accounts.length : index;
  };
  return Array.from(groups.values()).sort((a, b) => order(a) - order(b));
}

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
      <div className="rounded-xl border bg-card p-5">
        <Skeleton className="h-4 w-28" />
        <div className="mt-5 space-y-3">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
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
    cash,
    addCashMovement,
    updateCashMovement,
    appendEntries,
    replaceLedger,
    resetLedger,
    labels,
    addLabel,
    deleteLabel,
    accounts,
    addAccount,
    renameAccount,
    deleteAccount,
    refresh,
  } = useStockTransactions();
  const { toast } = useToast();

  const [currency, setCurrency] = useLocalStorage('stock-ledger:currency', DEFAULT_CURRENCY);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [editingCash, setEditingCash] = useState<CashMovement | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const portfolio = useMemo(() => computePortfolio(transactions), [transactions]);
  const cashBalances = useMemo(
    () => cashBalanceList({ transactions, cash }, accounts),
    [transactions, cash, accounts],
  );
  const cashTotal = cashBalances.reduce((sum, balance) => sum + balance.balance, 0);
  const accountPositions = useMemo(
    () => groupByAccount(portfolio.openHoldings, cashBalances, accounts),
    [portfolio.openHoldings, cashBalances, accounts],
  );
  const openSymbols = useMemo(
    () => Array.from(new Set(portfolio.openHoldings.map((holding) => holding.symbol))).sort(),
    [portfolio.openHoldings],
  );
  const {
    prices,
    settings: priceSettings,
    setSettings: setPriceSettings,
    quotes,
    lastRefreshAt,
    hasKey,
    isRefreshing,
    refresh: refreshPrices,
  } = usePrices(openSymbols, currency);

  /** Pull the ledger from relays (when signed in) and fetch the latest prices. */
  const handleRefresh = async () => {
    if (isLoggedIn) refresh();
    if (openSymbols.length === 0) return;
    const result = await refreshPrices();
    // Without a key only exchange rates are fetched; that's not worth a toast.
    if (!hasKey && !result.fxFailed) return;
    const problems: string[] = [];
    if (result.rateLimited) problems.push('The price source limit was reached; try again later.');
    if (result.failed.length > 0 && !result.rateLimited) {
      problems.push(`No price for ${result.failed.map((failure) => failure.symbol).join(', ')}.`);
    }
    if (hasKey && result.needKey.length > 0) problems.push('Add an API key in Prices, or enter prices by hand.');
    if (result.fxFailed) problems.push('Exchange rates could not be updated.');
    toast({
      title: result.updated > 0 ? `Updated ${result.updated} price${result.updated === 1 ? '' : 's'}` : 'No prices updated',
      description: problems.length > 0 ? problems.join(' ') : undefined,
      variant: result.updated === 0 && problems.length > 0 ? 'destructive' : undefined,
    });
  };

  const handleSavePrices = (next: typeof priceSettings) => {
    const keysChanged =
      next.alphaVantageKey !== priceSettings.alphaVantageKey || next.finnhubKey !== priceSettings.finnhubKey;
    setPriceSettings(next);
    toast({
      title: 'Price settings saved',
      description:
        keysChanged && (next.alphaVantageKey || next.finnhubKey) ? 'Press Refresh to fetch prices with your key.' : undefined,
    });
  };

  const openAdd = () => {
    setEditing(null);
    setEditingCash(null);
    setDialogOpen(true);
  };

  const openEdit = (transaction: Transaction) => {
    setEditing(transaction);
    setEditingCash(null);
    setDialogOpen(true);
  };

  const openEditCash = (entry: CashMovement) => {
    setEditing(null);
    setEditingCash(entry);
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

  const handleSubmitCash = (input: CashMovementInput) => {
    const noun = input.type === 'deposit' ? 'Deposit' : 'Withdrawal';
    if (editingCash) {
      updateCashMovement(editingCash.id, input);
      toast({ title: `${noun} updated` });
    } else {
      addCashMovement(input);
      toast({ title: `${noun} added` });
    }
    setDialogOpen(false);
  };

  const handleDelete = (id: string) => {
    // Deleting a deposit or a sell removes cash; don't let that overdraw an account.
    const shortfall = newCashShortfalls(
      { transactions, cash },
      {
        transactions: transactions.filter((tx) => tx.id !== id),
        cash: cash.filter((entry) => entry.id !== id),
      },
    )[0];
    if (shortfall) {
      const where = shortfall.account ? ` in ${shortfall.account}` : '';
      const when = shortfall.lowestDate ? ` on ${formatDate(shortfall.lowestDate)}` : '';
      toast({
        title: 'Not enough cash',
        description: `Deleting this would take the cash${where} to ${formatCurrency(shortfall.lowest, currency)}${when}.`,
        variant: 'destructive',
      });
      return;
    }
    deleteTransaction(id);
    toast({ title: 'Transaction deleted' });
  };

  const handleLoadSample = () => {
    const sample = sampleLedger();
    replaceLedger({ ...sample, labels, accounts: [...accounts, ...sample.accounts] });
    toast({ title: 'Sample data loaded', description: 'Explore the dashboard, then reset the ledger from the data menu when ready.' });
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    try {
      const text = await file.text();
      const { transactions: imported, cash: importedCash, skipped } = csvToTransactions(text);
      const count = imported.length + importedCash.length;
      if (count === 0) {
        toast({
          title: 'Nothing imported',
          description: 'No valid rows found. Make sure your file has date, symbol, type, quantity and price columns.',
          variant: 'destructive',
        });
        return;
      }
      appendEntries(imported, importedCash);
      toast({
        title: `Imported ${count} transaction${count === 1 ? '' : 's'}`,
        description: skipped > 0 ? `${skipped} row${skipped === 1 ? '' : 's'} skipped.` : undefined,
      });
    } catch (error) {
      console.error('Failed to import CSV:', error);
      toast({ title: 'Import failed', description: 'The file could not be read.', variant: 'destructive' });
    }
  };

  const hasTransactions = transactions.length > 0 || cash.length > 0;

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
          ledger={{ transactions, cash, labels, accounts }}
          onRequestImport={() => fileInputRef.current?.click()}
          onLoadSample={handleLoadSample}
          onReset={resetLedger}
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
            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={isSyncing || isRefreshing}
              aria-label={isLoggedIn ? 'Refresh from relays and fetch latest prices' : 'Fetch latest prices'}
            >
              <RefreshCw className={isSyncing || isRefreshing ? 'animate-spin' : undefined} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button variant="outline" onClick={() => setAccountsOpen(true)} aria-label="Manage accounts">
              <Wallet />
              <span className="hidden sm:inline">Accounts</span>
            </Button>
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
              <SummaryCards
                portfolio={portfolio}
                cashTotal={cashTotal}
                cashAccounts={cashBalances.length}
                currency={currency}
              />

              <Tabs defaultValue="holdings" className="min-w-0">
                <TabsList>
                  <TabsTrigger value="holdings">Holdings</TabsTrigger>
                  <TabsTrigger value="transactions">Transactions</TabsTrigger>
                </TabsList>

                <TabsContent value="holdings" className="mt-4 space-y-6">
                  <section aria-labelledby="open-positions-heading" className="space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1.5">
                        <h2 id="open-positions-heading" className="text-lg font-semibold tracking-tight">
                          Open positions
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          Grouped by account. Cost basis and realized P&L are calculated with the average-cost method.
                          Cash is what each account holds after deposits, withdrawals, buys and sells.
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {lastRefreshAt > 0 ? (
                          <span className="text-xs text-muted-foreground" title={new Date(lastRefreshAt).toLocaleString()}>
                            Prices fetched{' '}
                            {new Date(lastRefreshAt).toLocaleString(undefined, {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        ) : null}
                        <Button variant="outline" size="sm" onClick={() => setPricesOpen(true)} aria-label="Price settings">
                          <LineChart />
                          {hasKey ? 'Prices' : 'Set up prices'}
                        </Button>
                      </div>
                    </div>
                    {accountPositions.map((group) => (
                      <HoldingsTable
                        key={group.key}
                        holdings={group.holdings}
                        currency={currency}
                        title={group.account ?? 'No account'}
                        cashBalances={group.cash}
                        prices={prices}
                        showAccount={false}
                        footerLabel="Subtotal"
                        showFooter
                      />
                    ))}
                    {accountPositions.length > 1 ? (
                      <HoldingsTotal
                        title="All accounts"
                        holdings={portfolio.openHoldings}
                        cashBalances={cashBalances}
                        currency={currency}
                        prices={prices}
                      />
                    ) : null}
                  </section>
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
                    cash={cash}
                    labels={labels}
                    accounts={accounts}
                    currency={currency}
                    onEdit={openEdit}
                    onEditCash={openEditCash}
                    onDelete={handleDelete}
                  />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </main>


      <TransactionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        transaction={editing}
        cashMovement={editingCash}
        transactions={transactions}
        cash={cash}
        symbols={portfolio.symbols}
        currency={currency}
        labels={labels}
        accounts={accounts}
        onCreateLabel={addLabel}
        onDeleteLabel={deleteLabel}
        onSubmit={handleSubmit}
        onSubmitCash={handleSubmitCash}
        onManageAccounts={() => setAccountsOpen(true)}
      />

      <PricesDialog
        open={pricesOpen}
        onOpenChange={setPricesOpen}
        symbols={openSymbols}
        settings={priceSettings}
        quotes={quotes}
        onSave={handleSavePrices}
      />

      <AccountsDialog
        open={accountsOpen}
        onOpenChange={setAccountsOpen}
        accounts={accounts}
        transactions={transactions}
        cash={cash}
        currency={currency}
        onAdd={addAccount}
        onRename={renameAccount}
        onDelete={deleteAccount}
      />
    </div>
  );
}
