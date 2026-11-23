import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useSeoMeta } from '@unhead/react';
import { LineChart, Plus, Printer, RefreshCw, Wallet, X } from 'lucide-react';

import { LoginArea } from '@/components/auth/LoginArea';
import { StoredKeyNotice } from '@/components/auth/StoredKeyNotice';
import { AccountsDialog } from '@/components/ledger/AccountsDialog';
import { AccountValueChart } from '@/components/ledger/AccountValueChart';
import { AnalysisPrintSheet } from '@/components/ledger/AnalysisPrintSheet';
import { AnalysisTable } from '@/components/ledger/AnalysisTable';
import { AppHeader } from '@/components/ledger/AppHeader';
import { DataMenu } from '@/components/ledger/DataMenu';
import { EmptyState } from '@/components/ledger/EmptyState';
import { HoldingsTable, HoldingsTotal } from '@/components/ledger/HoldingsTable';
import { PricesDialog } from '@/components/ledger/PricesDialog';
import { PriceStatus, type PriceRefreshReport } from '@/components/ledger/PriceStatus';
import { RiskAnalysis } from '@/components/ledger/RiskAnalysis';
import { SummaryCards } from '@/components/ledger/SummaryCards';
import { TransactionDialog, type TradePrefill } from '@/components/ledger/TransactionDialog';
import { TotalValueChart } from '@/components/ledger/TotalValueChart';
import { TransactionsTable } from '@/components/ledger/TransactionsTable';
import { WatchlistTable } from '@/components/ledger/WatchlistTable';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ToastAction } from '@/components/ui/toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAccountSnapshots } from '@/hooks/useAccountSnapshots';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { usePrices } from '@/hooks/usePrices';
import { useStockTransactions } from '@/hooks/useStockTransactions';
import { useToast } from '@/hooks/useToast';
import { positionLabels, summariseByAccount, summariseByLabel, type GroupSummary } from '@/lib/analysis';
import { cashBalanceList, newCashShortfalls, type CashBalance } from '@/lib/cash';
import { csvToTransactions } from '@/lib/csv';
import { accountValues } from '@/lib/snapshots';
import { DEFAULT_CURRENCY } from '@/lib/currency';
import {
  computePortfolio,
  DEFAULT_HOLDING_SORT,
  formatCurrency,
  isHoldingSort,
  formatDate,
  mergeLabels,
  sortByDate,
  type CashMovement,
  type CashMovementInput,
  type Holding,
  type HoldingSort,
  type Transaction,
  type TransactionInput,
  type WatchItem,
} from '@/lib/portfolio';
import { sampleLedger } from '@/lib/sampleData';
import { yahooQuoteUrl } from '@/lib/prices';

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

/** Which positions Holdings shows when opened from a Summary table. `name` is undefined for No account / Unlabelled. */
interface HoldingsFilter {
  kind: 'account' | 'label';
  name?: string;
}

function filterTitle(filter: HoldingsFilter): string {
  if (filter.kind === 'account') return filter.name ?? 'No account';
  return filter.name ? `Label: ${filter.name}` : 'Unlabelled';
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
    title: 'Virtual Stock Portfolio — Private stock transaction tracker',
    description:
      'Record stock buys and sells with dates, quantities, prices and fees. Track cost basis, value and gains — encrypted and synced to your own Nostr relays.',
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
    accounts: savedAccounts,
    addAccount,
    renameAccount,
    deleteAccount,
    stockNotes,
    setStockNote,
    accountNotes,
    setAccountNote,
    watchlist,
    addWatch,
    removeWatch,
    restoreWatch,
    setWatchTrigger,
    watchLabels,
    addWatchLabel,
    deleteWatchLabel,
    setWatchLabel,
    refresh,
  } = useStockTransactions();
  const { toast } = useToast();

  const [currency, setCurrency] = useLocalStorage('stock-ledger:currency', DEFAULT_CURRENCY);
  const [storedSort, setHoldingSort] = useLocalStorage<HoldingSort>('stock-ledger:holdings-sort', DEFAULT_HOLDING_SORT);
  const holdingSort = isHoldingSort(storedSort) ? storedSort : DEFAULT_HOLDING_SORT;
  const [storedGrouped, setGroupByAccount] = useLocalStorage<boolean>('stock-ledger:holdings-grouped', true);
  const groupHoldings = storedGrouped !== false;
  const [storedWatchSort, setWatchSort] = useLocalStorage<HoldingSort>('stock-ledger:watchlist-sort', DEFAULT_HOLDING_SORT);
  const watchSort = isHoldingSort(storedWatchSort) ? storedWatchSort : DEFAULT_HOLDING_SORT;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [editingCash, setEditingCash] = useState<CashMovement | null>(null);
  const [prefill, setPrefill] = useState<TradePrefill | null>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [pricesOpen, setPricesOpen] = useState(false);
  const [tab, setTab] = useState('analysis');
  const [priceReport, setPriceReport] = useState<PriceRefreshReport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Accounts are listed A to Z everywhere: drop-downs, holdings, charts and the Accounts dialog.
  const accounts = useMemo(
    () => [...savedAccounts].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })),
    [savedAccounts],
  );
  const portfolio = useMemo(() => computePortfolio(transactions), [transactions]);
  const cashBalances = useMemo(
    () => cashBalanceList({ transactions, cash }, accounts),
    [transactions, cash, accounts],
  );
  const cashTotal = cashBalances.reduce((sum, balance) => sum + balance.balance, 0);
  // Set from the Summary tables' Positions links: Holdings shows only that account's or label's positions.
  const [holdingsFilter, setHoldingsFilter] = useState<HoldingsFilter | null>(null);
  const labelByPosition = useMemo(() => positionLabels(transactions), [transactions]);
  const { shownHoldings, shownCash } = useMemo(() => {
    if (!holdingsFilter) return { shownHoldings: portfolio.openHoldings, shownCash: cashBalances };
    const target = holdingsFilter.name?.toLowerCase();
    if (holdingsFilter.kind === 'account') {
      return {
        shownHoldings: portfolio.openHoldings.filter((holding) => holding.account?.toLowerCase() === target),
        shownCash: cashBalances.filter((balance) => balance.account?.toLowerCase() === target),
      };
    }
    return {
      shownHoldings: portfolio.openHoldings.filter((holding) => labelByPosition.get(holding.key)?.toLowerCase() === target),
      // Cash has no label.
      shownCash: [],
    };
  }, [holdingsFilter, portfolio.openHoldings, cashBalances, labelByPosition]);
  const shownSymbols = useMemo(
    () => Array.from(new Set(shownHoldings.map((holding) => holding.symbol))).sort(),
    [shownHoldings],
  );
  const accountPositions = useMemo(
    () => groupByAccount(shownHoldings, shownCash, accounts),
    [shownHoldings, shownCash, accounts],
  );
  const openSymbols = useMemo(
    () => Array.from(new Set(portfolio.openHoldings.map((holding) => holding.symbol))).sort(),
    [portfolio.openHoldings],
  );
  // Held and watched stocks share one price fetch.
  const priceSymbols = useMemo(
    () => Array.from(new Set([...openSymbols, ...watchlist.map((item) => item.symbol)])).sort(),
    [openSymbols, watchlist],
  );
  const heldSymbols = useMemo(() => new Set(openSymbols), [openSymbols]);
  const watchSymbols = useMemo(() => watchlist.map((item) => item.symbol), [watchlist]);
  const knownNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const tx of sortByDate(transactions)) {
      const name = tx.name?.trim();
      if (name) names.set(tx.symbol, name);
    }
    return names;
  }, [transactions]);
  const {
    prices,
    settings: priceSettings,
    setSettings: setPriceSettings,
    quotes,
    hasKey,
    isRefreshing,
    refresh: refreshPrices,
    fetchOne: fetchPrice,
  } = usePrices(priceSymbols, currency);
  // Holdings notes belong to the stock in its account; a holding with no account falls back to the shared note.
  const setHoldingNote = useCallback(
    (account: string | undefined, symbol: string, note: string) => {
      if (account) setAccountNote(account, symbol, note);
      else setStockNote(symbol, note);
    },
    [setAccountNote, setStockNote],
  );
  const quoteUrlFor = useCallback((symbol: string) => yahooQuoteUrl(symbol, priceSettings), [priceSettings]);
  const accountSummary = useMemo(
    () => summariseByAccount(portfolio.holdings, cashBalances, prices),
    [portfolio.holdings, cashBalances, prices],
  );
  const {
    snapshots,
    record: recordSnapshot,
    renameAccount: renameSnapshotAccount,
    clear: clearSnapshots,
  } = useAccountSnapshots();
  // Save today's value of each account whenever it changes (e.g. after prices refresh).
  useEffect(() => {
    if (isLoading || isRefreshing || accountSummary.rows.length === 0) return;
    recordSnapshot(accountValues(accountSummary), currency);
  }, [isLoading, isRefreshing, accountSummary, currency, recordSnapshot]);
  const labelSummary = useMemo(
    () => summariseByLabel(portfolio.holdings, transactions, cashBalances, prices),
    [portfolio.holdings, transactions, cashBalances, prices],
  );

  /** Pull the ledger from relays (when signed in) and fetch the latest prices. */
  const handleRefresh = async () => {
    if (isLoggedIn) refresh();
    if (priceSymbols.length === 0) return;
    const result = await refreshPrices();
    // Without a key only exchange rates are fetched; that's not worth a toast.
    if (!hasKey && !result.fxFailed) return;
    const problems: string[] = [];
    if (result.rateLimited) problems.push('The daily price limit was reached; try again tomorrow.');
    // Name each source's reason, so a failing relay shows up even when the daily limit hides it.
    for (const failure of result.failed) problems.push(`No price for ${failure.symbol}. ${failure.message}`);
    if (hasKey && result.needKey.length > 0) problems.push('Add an API key in Prices, or enter prices by hand.');
    if (result.fxFailed) problems.push('Exchange rates could not be updated.');
    const notes =
      result.skipped > 0
        ? [`${result.skipped} price${result.skipped === 1 ? ' was' : 's were'} fetched in the last 4 hours and kept.`]
        : [];
    const title =
      result.updated > 0
        ? `Updated ${result.updated} price${result.updated === 1 ? '' : 's'}`
        : result.skipped > 0 && problems.length === 0
          ? 'Prices are up to date'
          : 'No prices updated';
    // The details go at the bottom of each tab; the toast only says what happened.
    setPriceReport({ title, problems, notes });
    toast({
      title,
      description:
        problems.length > 0
          ? `${problems.length} problem${problems.length === 1 ? '' : 's'}, listed at the bottom of the page.`
          : undefined,
      variant: result.updated === 0 && problems.length > 0 ? 'destructive' : undefined,
    });
  };

  /** Open Holdings showing only one account's or label's positions. */
  const showPositions = (kind: HoldingsFilter['kind'], row: GroupSummary) => {
    setHoldingsFilter({ kind, name: row.name });
    setTab('holdings');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSavePrices = (next: typeof priceSettings) => {
    const keysChanged =
      next.relayUrl !== priceSettings.relayUrl ||
      next.alphaVantageKey !== priceSettings.alphaVantageKey ||
      next.finnhubKey !== priceSettings.finnhubKey;
    setPriceSettings(next);
    toast({
      title: 'Price settings saved',
      description:
        keysChanged && (next.relayUrl || next.alphaVantageKey || next.finnhubKey) ? 'Press Refresh to fetch prices.' : undefined,
    });
  };

  const handleAddWatch = (symbol: string, name?: string) => {
    addWatch(symbol, name);
    const quoted = Boolean(prices[symbol]);
    toast({
      title: `${name ?? symbol} added to your watchlist`,
      description: quoted ? undefined : 'Press Refresh to fetch its price.',
    });
  };

  const handleRemoveWatch = (item: WatchItem) => {
    removeWatch(item.symbol);
    toast({
      title: `${item.name ?? item.symbol} removed from your watchlist`,
      action: (
        <ToastAction altText="Put it back on the watchlist" onClick={() => restoreWatch(item)}>
          Undo
        </ToastAction>
      ),
    });
  };

  const openAdd = () => {
    setEditing(null);
    setEditingCash(null);
    setPrefill(null);
    setDialogOpen(true);
  };

  // A new trade for one holdings row: its account, stock and the label of its latest labelled trade.
  const openAddFor = (holding: Holding) => {
    const latestLabel = sortByDate(transactions)
      .filter((tx) => tx.symbol === holding.symbol && tx.account === holding.account && tx.label)
      .at(-1)?.label;
    setEditing(null);
    setEditingCash(null);
    setPrefill({ symbol: holding.symbol, name: holding.name, account: holding.account, label: latestLabel });
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
    replaceLedger({
      ...sample,
      labels: mergeLabels(labels, sample.labels),
      accounts: mergeLabels(savedAccounts, sample.accounts),
    });
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
  const [printingAnalysis, setPrintingAnalysis] = useState(false);
  const finishPrinting = useCallback(() => setPrintingAnalysis(false), []);

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
          ledger={{ transactions, cash, labels, accounts: savedAccounts, stockNotes, accountNotes, watchlist, watchLabels }}
          onRequestImport={() => fileInputRef.current?.click()}
          onLoadSample={handleLoadSample}
          onReset={() => {
            resetLedger();
            clearSnapshots();
          }}
        />
        <LoginArea className="max-w-44 sm:max-w-56" />
      </AppHeader>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <StoredKeyNotice />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Portfolio</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isLoggedIn
                ? 'Your data is encrypted to your Nostr key and synced to your relays.'
                : 'Sign in to encrypt and sync your data over Nostr.'}
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
                prices={prices}
              />

              <Tabs
                value={tab}
                onValueChange={(next) => {
                  setTab(next);
                  // A filter set from Summary lasts until you leave Holdings.
                  if (next !== 'holdings') setHoldingsFilter(null);
                }}
                className="min-w-0"
              >
                <TabsList>
                  <TabsTrigger value="analysis">Summary</TabsTrigger>
                  <TabsTrigger value="holdings">Holdings</TabsTrigger>
                  <TabsTrigger value="transactions">Transactions</TabsTrigger>
                  <TabsTrigger value="risk">Analysis</TabsTrigger>
                  <TabsTrigger value="watchlist">Watchlist</TabsTrigger>
                </TabsList>

                <TabsContent value="holdings" className="mt-4 space-y-6">
                  <section aria-labelledby="open-positions-heading" className="space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1.5">
                        <h2 id="open-positions-heading" className="text-lg font-semibold tracking-tight">
                          Open positions
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          {groupHoldings
                            ? 'Grouped by account. '
                            : 'All accounts in one table; a stock held in more than one account has a row for each. '}
                          Cost basis is calculated with the average-cost method.
                          Cash is what each account holds after deposits, withdrawals, buys and sells.
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
                        <div className="flex items-center gap-2">
                          <Switch
                            id="group-by-account"
                            checked={groupHoldings}
                            onCheckedChange={(checked) => setGroupByAccount(checked)}
                          />
                          <Label htmlFor="group-by-account" className="text-sm font-normal">
                            Group by account
                          </Label>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setPricesOpen(true)} aria-label="Price settings">
                          <LineChart />
                          {hasKey ? 'Prices' : 'Set up prices'}
                        </Button>
                      </div>
                    </div>
                    {holdingsFilter ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm">
                        <span>
                          Showing only <span className="font-medium">{filterTitle(holdingsFilter)}</span>
                          {' · '}
                          {shownHoldings.length} position{shownHoldings.length === 1 ? '' : 's'}
                        </span>
                        <Button variant="outline" size="sm" className="h-7" onClick={() => setHoldingsFilter(null)}>
                          <X />
                          Show all
                        </Button>
                      </div>
                    ) : null}
                    {groupHoldings ? (
                      <>
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
                            sort={holdingSort}
                            onSortChange={setHoldingSort}
                            stockNotes={stockNotes}
                            accountNotes={accountNotes}
                            onNoteChange={setHoldingNote}
                            quoteUrlFor={quoteUrlFor}
                            onAddTransaction={openAddFor}
                          />
                        ))}
                        {accountPositions.length > 1 ? (
                          <HoldingsTotal
                            title={holdingsFilter ? 'Total' : 'All accounts'}
                            holdings={shownHoldings}
                            cashBalances={shownCash}
                            currency={currency}
                            prices={prices}
                          />
                        ) : null}
                      </>
                    ) : (
                      <HoldingsTable
                        holdings={shownHoldings}
                        currency={currency}
                        title={holdingsFilter ? filterTitle(holdingsFilter) : 'All accounts'}
                        cashBalances={shownCash}
                        prices={prices}
                        showAccount
                        footerLabel="Total"
                        showFooter
                        sort={holdingSort}
                        onSortChange={setHoldingSort}
                        stockNotes={stockNotes}
                        accountNotes={accountNotes}
                        onNoteChange={setHoldingNote}
                        quoteUrlFor={quoteUrlFor}
                        onAddTransaction={openAddFor}
                      />
                    )}
                  </section>
                  <PriceStatus symbols={shownSymbols} prices={prices} names={knownNames} report={priceReport} />
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

                <TabsContent value="watchlist" className="mt-4 space-y-6">
                  <WatchlistTable
                    items={watchlist}
                    currency={currency}
                    prices={prices}
                    heldSymbols={heldSymbols}
                    knownNames={knownNames}
                    stockNotes={stockNotes}
                    onNoteChange={setStockNote}
                    quoteUrlFor={quoteUrlFor}
                    onAdd={handleAddWatch}
                    onRemove={handleRemoveWatch}
                    onTriggerChange={setWatchTrigger}
                    labels={watchLabels}
                    onLabelChange={setWatchLabel}
                    onCreateLabel={addWatchLabel}
                    onDeleteLabel={deleteWatchLabel}
                    sort={watchSort}
                    onSortChange={setWatchSort}
                  />
                  <PriceStatus symbols={watchSymbols} prices={prices} names={knownNames} report={priceReport} />
                </TabsContent>

                <TabsContent value="risk" className="mt-4">
                  <RiskAnalysis
                    holdings={portfolio.openHoldings}
                    prices={prices}
                    priceSettings={priceSettings}
                    currency={currency}
                    names={knownNames}
                    priceReport={priceReport}
                  />
                </TabsContent>

                <TabsContent value="analysis" className="mt-4 space-y-6">
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPrintingAnalysis(true)}
                      disabled={printingAnalysis}
                      aria-label="Print the By account and By label tables"
                    >
                      <Printer />
                      Print tables
                    </Button>
                  </div>
                  <TotalValueChart
                    snapshots={snapshots}
                    accounts={accounts}
                    currency={currency}
                  />
                  <AccountValueChart snapshots={snapshots} accounts={accounts} currency={currency} />
                  <AnalysisTable
                    title="By account"
                    description="Each account's open positions and cash. Unpriced holdings count at cost."
                    groupHeading="Account"
                    unnamedLabel="No account"
                    summary={accountSummary}
                    currency={currency}
                    showShare={false}
                    showCash
                    onPositionsClick={(row) => showPositions('account', row)}
                  />
                  <AnalysisTable
                    title="By label"
                    description="Each position counts under the label of its latest labelled trade. Cash has no label, so it gets its own row."
                    groupHeading="Label"
                    unnamedLabel="Unlabelled"
                    summary={labelSummary}
                    currency={currency}
                    nameWidth="w-32"
                    onPositionsClick={(row) => showPositions('label', row)}
                  />
                  <PriceStatus symbols={openSymbols} prices={prices} names={knownNames} report={priceReport} />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>
      </main>

      {printingAnalysis ? (
        <AnalysisPrintSheet
          accountSummary={accountSummary}
          labelSummary={labelSummary}
          currency={currency}
          onDone={finishPrinting}
        />
      ) : null}


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
        prefill={prefill}
      />

      <PricesDialog
        open={pricesOpen}
        onOpenChange={setPricesOpen}
        symbols={priceSymbols}
        settings={priceSettings}
        quotes={quotes}
        onSave={handleSavePrices}
        onFetch={fetchPrice}
      />

      <AccountsDialog
        open={accountsOpen}
        onOpenChange={setAccountsOpen}
        accounts={accounts}
        transactions={transactions}
        cash={cash}
        currency={currency}
        onAdd={addAccount}
        onRename={(from, to) => {
          const renamed = renameAccount(from, to);
          if (renamed) renameSnapshotAccount(from, to);
          return renamed;
        }}
        onDelete={deleteAccount}
      />
    </div>
  );
}
