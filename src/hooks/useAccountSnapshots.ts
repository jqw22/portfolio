/**
 * Daily account value snapshots with Nostr-backed sync.
 *
 * Kept apart from the ledger in their own encrypted (NIP-44, encrypt-to-self)
 * NIP-78 event (`kind 30078`, `d = stock-ledger-snapshots`), so a year of
 * history never eats into the ledger event's size. A local cache keeps them
 * when signed out or offline.
 *
 * Snapshots only ever grow, so the relay copy and the local copy are merged
 * (the later snapshot wins for each day) rather than one replacing the other.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useCurrentUser } from './useCurrentUser';
import { useNostrPublish } from './useNostrPublish';
import { LEDGER_KIND } from './useStockTransactions';
import {
  localDate,
  mergeSnapshots,
  parseSnapshots,
  renameSnapshotAccount,
  sameSnapshots,
  upsertSnapshot,
  type Snapshot,
} from '@/lib/snapshots';

/** `d` tag of the snapshots event within kind 30078. */
export const SNAPSHOTS_D_TAG = 'stock-ledger-snapshots';

const CACHE_PREFIX = 'stock-ledger:snapshots:';
/** Version of the decrypted relay payload (see NIP.md). */
const PAYLOAD_VERSION = 1;
/** Prices refresh one by one, so wait for them to settle before publishing. */
const PUBLISH_DELAY_MS = 5000;

const EMPTY: Snapshot[] = [];

function cacheKey(pubkey?: string): string {
  return `${CACHE_PREFIX}${pubkey ?? 'anon'}`;
}

function readCache(pubkey?: string): Snapshot[] {
  try {
    const raw = localStorage.getItem(cacheKey(pubkey));
    return raw ? parseSnapshots(JSON.parse(raw)) : EMPTY;
  } catch (error) {
    console.warn('Failed to read cached snapshots:', error);
    return EMPTY;
  }
}

function writeCache(pubkey: string | undefined, snapshots: Snapshot[]): void {
  try {
    localStorage.setItem(cacheKey(pubkey), JSON.stringify({ version: PAYLOAD_VERSION, snapshots }));
  } catch (error) {
    console.warn('Failed to cache snapshots:', error);
  }
}

export function useAccountSnapshots() {
  const { user } = useCurrentUser();
  const { nostr } = useNostr();
  const { mutateAsync: publish } = useNostrPublish();
  const queryClient = useQueryClient();

  const pubkey = user?.pubkey;
  const queryKey = useMemo(() => ['stock-ledger-snapshots', pubkey ?? 'anon'] as const, [pubkey]);

  const lastCreatedAtRef = useRef(0);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const publishSnapshots = useCallback(
    async (snapshots: Snapshot[]) => {
      const nip44 = user?.signer.nip44;
      if (!user || !nip44) return;
      const ciphertext = await nip44.encrypt(
        user.pubkey,
        JSON.stringify({ version: PAYLOAD_VERSION, snapshots }),
      );
      const createdAt = Math.max(Math.floor(Date.now() / 1000), lastCreatedAtRef.current + 1);
      const event = await publish({
        kind: LEDGER_KIND,
        content: ciphertext,
        tags: [
          ['d', SNAPSHOTS_D_TAG],
          ['alt', 'Encrypted daily account value snapshots'],
        ],
        created_at: createdAt,
      });
      lastCreatedAtRef.current = event.created_at;
    },
    [publish, user],
  );

  /** Publish the latest snapshots once changes have settled (or right away). */
  const schedulePublish = useCallback(
    (delay = PUBLISH_DELAY_MS) => {
      if (!user?.signer.nip44) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        chainRef.current = chainRef.current
          .then(() => publishSnapshots(queryClient.getQueryData<Snapshot[]>(queryKey) ?? EMPTY))
          .catch((error: unknown) => console.warn('Failed to sync snapshots:', error));
      }, delay);
    },
    [publishSnapshots, queryClient, queryKey, user],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const query = useQuery<Snapshot[], Error>({
    queryKey,
    queryFn: async (context) => {
      const local = readCache(pubkey);
      const nip44 = user?.signer.nip44;
      if (!user || !nip44) return local;
      try {
        const events = await nostr.query(
          [{ kinds: [LEDGER_KIND], authors: [user.pubkey], '#d': [SNAPSHOTS_D_TAG], limit: 1 }],
          { signal: context.signal },
        );
        const event = events[0];
        const remote = event ? parseSnapshots(JSON.parse(await nip44.decrypt(user.pubkey, event.content))) : EMPTY;
        if (event) lastCreatedAtRef.current = Math.max(lastCreatedAtRef.current, event.created_at);
        // Snapshots recorded while this was loading are in the cache by now.
        const merged = mergeSnapshots(readCache(pubkey), remote);
        writeCache(pubkey, merged);
        if (!sameSnapshots(merged, remote)) schedulePublish();
        return merged;
      } catch (error) {
        console.warn('Failed to load snapshots from relays, using local copy:', error);
        return readCache(pubkey);
      }
    },
  });

  const commit = useCallback(
    (updater: (previous: Snapshot[]) => Snapshot[], delay?: number) => {
      const previous = queryClient.getQueryData<Snapshot[]>(queryKey) ?? readCache(pubkey);
      const next = updater(previous);
      if (next === previous) return;
      queryClient.setQueryData<Snapshot[]>(queryKey, next);
      writeCache(pubkey, next);
      schedulePublish(delay);
    },
    [pubkey, queryClient, queryKey, schedulePublish],
  );

  /** Record today's value of each account; replaces today's earlier snapshot if the values changed. */
  const record = useCallback(
    (values: Record<string, number>, currency: string) => {
      commit((previous) => upsertSnapshot(previous, { date: localDate(), currency, values, takenAt: Date.now() }));
    },
    [commit],
  );

  const renameAccount = useCallback(
    (from: string, to: string) => commit((previous) => renameSnapshotAccount(previous, from, to)),
    [commit],
  );

  /** Delete every snapshot, e.g. when the ledger is reset. */
  const clear = useCallback(() => commit((previous) => (previous.length === 0 ? previous : EMPTY), 0), [commit]);

  return {
    snapshots: query.data ?? EMPTY,
    isLoading: query.isLoading,
    record,
    renameAccount,
    clear,
  };
}
