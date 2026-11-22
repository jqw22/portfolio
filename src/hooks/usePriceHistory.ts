import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchRelayHistory, RELAY_BATCH } from '@/lib/priceSources';
import { parseRelayUrl, type RelayHistory } from '@/lib/prices';
import { fxSymbolFor } from '@/lib/risk';

const CACHE_KEY = 'stock-ledger:price-history';
/** Histories are fetched again once they're this old (daily closes change once a day). */
const STALE_MS = 12 * 60 * 60 * 1000;

export interface StoredHistory extends RelayHistory {
  fetchedAt: number;
}

interface HistoryCache {
  series: Record<string, StoredHistory>;
  errors: Record<string, string>;
}

const EMPTY: HistoryCache = { series: {}, errors: {} };

function loadCache(): HistoryCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? { series: parsed.series ?? {}, errors: parsed.errors ?? {} } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function save(cache: HistoryCache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn('Failed to save price history:', error);
  }
}

/** Exchange-rate symbols needed to turn each fetched history into `currency`. */
function fxSymbols(series: Record<string, StoredHistory>, symbols: string[], currency: string): string[] {
  const needed = new Set<string>();
  for (const symbol of symbols) {
    const fx = series[symbol] ? fxSymbolFor(series[symbol].currency, currency) : null;
    if (fx) needed.add(fx);
  }
  return [...needed];
}

/**
 * About a year of daily closes for Yahoo-style `symbols` from the price relay, plus the exchange
 * rates needed to convert them into `currency`. Kept in this browser and fetched again at most
 * twice a day, so opening the Analysis tab doesn't call Yahoo every time.
 */
export function usePriceHistory(relayUrl: string, symbols: string[], currency: string) {
  const [cache, setCache] = useState<HistoryCache>(loadCache);
  const [isLoading, setIsLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cacheRef = useRef(cache);
  const abortRef = useRef<AbortController | null>(null);
  const hasRelay = Boolean(parseRelayUrl(relayUrl));

  useEffect(() => {
    cacheRef.current = cache;
    save(cache);
  }, [cache]);

  const fetchSome = useCallback(
    async (wanted: string[], signal: AbortSignal) => {
      const series: Record<string, StoredHistory> = {};
      const errors: Record<string, string> = {};
      for (let start = 0; start < wanted.length; start += RELAY_BATCH) {
        const chunk = wanted.slice(start, start + RELAY_BATCH);
        const answers = await fetchRelayHistory(relayUrl, chunk, signal);
        for (const symbol of chunk) {
          const answer = answers[symbol];
          if ('error' in answer) errors[symbol] = answer.error;
          else series[symbol] = { ...answer, fetchedAt: Date.now() };
        }
      }
      if (signal.aborted) return series;
      setCache((previous) => {
        const next = { series: { ...previous.series, ...series }, errors: { ...previous.errors } };
        for (const symbol of wanted) {
          if (errors[symbol]) next.errors[symbol] = errors[symbol];
          else delete next.errors[symbol];
        }
        return next;
      });
      return series;
    },
    [relayUrl],
  );

  const fetchHistory = useCallback(
    async (force: boolean) => {
      if (!hasRelay || symbols.length === 0) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const now = Date.now();
      const stale = (symbol: string) => {
        const stored = cacheRef.current.series[symbol];
        return force || !stored || now - stored.fetchedAt > STALE_MS;
      };
      setIsLoading(true);
      setProblem(null);
      try {
        const first = symbols.filter(stale);
        const fetched = first.length > 0 ? await fetchSome(first, controller.signal) : {};
        // Exchange rates depend on the currencies Yahoo reported, so they come second.
        const rates = fxSymbols({ ...cacheRef.current.series, ...fetched }, symbols, currency).filter(stale);
        if (rates.length > 0) await fetchSome(rates, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        setProblem(error instanceof Error ? error.message : 'Failed to fetch price history.');
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setIsLoading(false);
        }
      }
    },
    [hasRelay, symbols, currency, fetchSome],
  );

  // Fetch what's missing or stale when the tab opens or the holdings change.
  const key = `${relayUrl}|${currency}|${symbols.join(',')}`;
  useEffect(() => {
    const timer = setTimeout(() => void fetchHistory(false), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when what's needed changes
  }, [key]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    series: cache.series,
    errors: cache.errors,
    hasRelay,
    isLoading,
    problem,
    refresh: () => fetchHistory(true),
  };
}
