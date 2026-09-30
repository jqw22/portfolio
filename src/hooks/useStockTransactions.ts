/**
 * Stock transaction storage with Nostr-backed sync.
 *
 * Storage strategy:
 *  - Signed in: the ledger lives in a single encrypted (NIP-44, encrypt-to-self)
 *    NIP-78 event (`kind 30078`, `d = stock-ledger`). Because the event is
 *    addressable, publishing replaces the previous revision. A local cache is
 *    kept so the ledger opens instantly and survives being offline.
 *  - Signed out: the ledger is kept in local storage only, scoped to this
 *    browser. Signing in switches to the encrypted relay-backed copy.
 *
 * Conflicts are resolved "newest wins" using the event's `created_at` versus the
 * cache's own `updatedAt`, so edits made offline are not clobbered by a stale
 * remote revision (they're re-published instead).
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { useToast } from './useToast';
import {
  findLabel,
  makeTransaction,
  mergeLabels,
  normalizeLabel,
  parseLedger,
  removeLabel,
  type Ledger,
  type Transaction,
  type TransactionInput,
} from '@/lib/portfolio';

/** NIP-78 application-specific data (addressable/replaceable). */
export const LEDGER_KIND = 30078;
/** `d` tag identifying this app's payload within kind 30078. */
export const LEDGER_D_TAG = 'stock-ledger';

const CACHE_PREFIX = 'stock-ledger:cache:';
/** Version 1 caches held transactions only; version 2 adds labels. Both are readable. */
const CACHE_VERSION = 2;
/** Version of the decrypted relay payload (see NIP.md). */
const PAYLOAD_VERSION = 2;

const EMPTY_LEDGER: Ledger = { transactions: [], labels: [] };

interface LedgerCache {
  version: number;
  /** Epoch milliseconds of the last local write. */
  updatedAt: number;
  ledger: Ledger;
}

function cacheKey(pubkey?: string): string {
  return `${CACHE_PREFIX}${pubkey ?? 'anon'}`;
}

function readCache(pubkey?: string): LedgerCache | null {
  try {
    const raw = localStorage.getItem(cacheKey(pubkey));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1 && record.version !== CACHE_VERSION) return null;
    const updatedAt = typeof record.updatedAt === 'number' ? record.updatedAt : 0;
    return { version: CACHE_VERSION, updatedAt, ledger: parseLedger(record) };
  } catch (error) {
    console.warn('Failed to read cached ledger:', error);
    return null;
  }
}

function writeCache(pubkey: string | undefined, ledger: Ledger, updatedAt: number): void {
  try {
    const payload = { version: CACHE_VERSION, updatedAt, ...ledger };
    localStorage.setItem(cacheKey(pubkey), JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to cache ledger:', error);
  }
}

export interface StockTransactions {
  transactions: Transaction[];
  /** The user's labels, in creation order. */
  labels: string[];
  isLoading: boolean;
  isSyncing: boolean;
  isLoggedIn: boolean;
  /** Whether the active signer supports the encryption needed for relay sync. */
  canSync: boolean;
  error: Error | null;
  refresh: () => void;
  addTransaction: (input: TransactionInput) => void;
  updateTransaction: (id: string, input: TransactionInput) => void;
  deleteTransaction: (id: string) => void;
  replaceTransactions: (transactions: Transaction[]) => void;
  clearTransactions: () => void;
  /** Add a label (no-op if it already exists) and return its stored spelling. */
  addLabel: (label: string) => string | undefined;
  /** Delete a label and clear it from every transaction that uses it. */
  deleteLabel: (label: string) => void;
  /** The raw query, exposed for advanced callers. */
  query: UseQueryResult<Ledger, Error>;
}

export function useStockTransactions(): StockTransactions {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publish } = useNostrPublish();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const pubkey = user?.pubkey;
  const queryKey = useMemo(() => ['stock-ledger', pubkey ?? 'anon'] as const, [pubkey]);

  // Monotonic guard so two publishes in the same second can never tie, and every
  // revision strictly supersedes the last.
  const lastCreatedAtRef = useRef(0);
  // Serializes publishes so rapid edits can't race each other.
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingRef = useRef(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const publishLedger = useCallback(
    async (ledger: Ledger): Promise<void> => {
      if (!user) return;
      const nip44 = user.signer.nip44;
      if (!nip44) {
        throw new Error('Your signer does not support NIP-44 encryption, so the ledger cannot be synced.');
      }
      const payload = { version: PAYLOAD_VERSION, transactions: ledger.transactions, labels: ledger.labels };
      const ciphertext = await nip44.encrypt(user.pubkey, JSON.stringify(payload));
      const now = Math.floor(Date.now() / 1000);
      const createdAt = Math.max(now, lastCreatedAtRef.current + 1);
      const event = await publish({
        kind: LEDGER_KIND,
        content: ciphertext,
        tags: [
          ['d', LEDGER_D_TAG],
          ['alt', 'Encrypted stock transaction ledger'],
        ],
        created_at: createdAt,
      });
      lastCreatedAtRef.current = event.created_at;
      writeCache(user.pubkey, ledger, event.created_at * 1000);
    },
    [publish, user],
  );

  const enqueuePublish = useCallback(
    (ledger: Ledger): void => {
      if (!user) return;
      pendingRef.current += 1;
      setIsSyncing(true);
      chainRef.current = chainRef.current
        .then(() => publishLedger(ledger))
        .catch((error: unknown) => {
          console.error('Failed to sync ledger:', error);
          toast({
            title: 'Could not sync to relays',
            description:
              error instanceof Error
                ? error.message
                : 'Your changes are saved on this device but could not be backed up.',
            variant: 'destructive',
          });
        })
        .finally(() => {
          pendingRef.current = Math.max(0, pendingRef.current - 1);
          if (pendingRef.current === 0) setIsSyncing(false);
        });
    },
    [publishLedger, toast, user],
  );

  const query = useQuery<Ledger, Error>({
    queryKey,
    queryFn: async (context) => {
      const initial = readCache(pubkey);

      if (!user) {
        return initial?.ledger ?? EMPTY_LEDGER;
      }

      const nip44 = user.signer.nip44;
      if (!nip44) {
        return initial?.ledger ?? EMPTY_LEDGER;
      }

      try {
        const events = await nostr.query(
          [{ kinds: [LEDGER_KIND], authors: [user.pubkey], '#d': [LEDGER_D_TAG], limit: 1 }],
          { signal: context.signal },
        );

        const event = events[0];
        // Re-read the cache: the user may have edited while the network call was
        // in flight, and those edits must win over a stale relay revision.
        const local = readCache(pubkey) ?? initial;
        const localUpdatedAt = local?.updatedAt ?? 0;
        const remoteUpdatedAt = event ? event.created_at * 1000 : 0;

        if (event && remoteUpdatedAt >= localUpdatedAt) {
          const plaintext = await nip44.decrypt(user.pubkey, event.content);
          const ledger = parseLedger(JSON.parse(plaintext));
          lastCreatedAtRef.current = Math.max(lastCreatedAtRef.current, event.created_at);
          // Another edit could have landed during decryption — prefer it.
          const latest = readCache(pubkey);
          if (latest && latest.updatedAt > remoteUpdatedAt) {
            return latest.ledger;
          }
          writeCache(pubkey, ledger, remoteUpdatedAt);
          return ledger;
        }

        // Local edits are newer than the relay copy — push them back up.
        if (
          local &&
          localUpdatedAt > remoteUpdatedAt &&
          (local.ledger.transactions.length > 0 || local.ledger.labels.length > 0)
        ) {
          enqueuePublish(local.ledger);
        }

        return local?.ledger ?? EMPTY_LEDGER;
      } catch (error) {
        console.warn('Failed to load ledger from relays, using local copy:', error);
        return readCache(pubkey)?.ledger ?? initial?.ledger ?? EMPTY_LEDGER;
      }
    },
  });

  const commitLedger = useCallback(
    (updater: (previous: Ledger) => Ledger) => {
      const previous = queryClient.getQueryData<Ledger>(queryKey) ?? EMPTY_LEDGER;
      const updated = updater(previous);
      // Any label a transaction carries must also be in the list.
      const next = parseLedger(updated);
      queryClient.setQueryData<Ledger>(queryKey, next);
      writeCache(pubkey, next, Date.now());
      enqueuePublish(next);
    },
    [enqueuePublish, pubkey, queryClient, queryKey],
  );

  const commit = useCallback(
    (updater: (previous: Transaction[]) => Transaction[]) => {
      commitLedger((previous) => ({ ...previous, transactions: updater(previous.transactions) }));
    },
    [commitLedger],
  );

  const addTransaction = useCallback(
    (input: TransactionInput) => {
      commit((previous) => [...previous, makeTransaction(input)]);
    },
    [commit],
  );

  const updateTransaction = useCallback(
    (id: string, input: TransactionInput) => {
      commit((previous) =>
        previous.map((transaction) => (transaction.id === id ? makeTransaction(input, id) : transaction)),
      );
    },
    [commit],
  );

  const deleteTransaction = useCallback(
    (id: string) => {
      commit((previous) => previous.filter((transaction) => transaction.id !== id));
    },
    [commit],
  );

  const replaceTransactions = useCallback(
    (transactions: Transaction[]) => {
      commit(() => transactions);
    },
    [commit],
  );

  const clearTransactions = useCallback(() => {
    commit(() => []);
  }, [commit]);

  const addLabel = useCallback(
    (value: string): string | undefined => {
      const label = normalizeLabel(value);
      if (!label) return undefined;
      const current = queryClient.getQueryData<Ledger>(queryKey) ?? EMPTY_LEDGER;
      const existing = findLabel(current.labels, label);
      if (existing) return existing;
      commitLedger((previous) => ({ ...previous, labels: mergeLabels(previous.labels, [label]) }));
      return label;
    },
    [commitLedger, queryClient, queryKey],
  );

  const deleteLabel = useCallback(
    (label: string) => {
      commitLedger((previous) => removeLabel(previous, label));
    },
    [commitLedger],
  );

  const refresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  return {
    transactions: query.data?.transactions ?? EMPTY_LEDGER.transactions,
    labels: query.data?.labels ?? EMPTY_LEDGER.labels,
    isLoading: query.isLoading,
    isSyncing,
    isLoggedIn: Boolean(user),
    canSync: Boolean(user?.signer.nip44),
    error: query.error,
    refresh,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    replaceTransactions,
    clearTransactions,
    addLabel,
    deleteLabel,
    query,
  };
}
