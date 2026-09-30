import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchAlphaVantageQuote, fetchFinnhubQuote, fetchFxRates } from '@/lib/priceSources';
import {
  DEFAULT_PRICE_SETTINGS,
  planQuote,
  PriceSourceError,
  resolvePrice,
  type FxRates,
  type PriceSettings,
  type Quote,
  type ResolvedPrice,
} from '@/lib/prices';

const SETTINGS_KEY = 'stock-ledger:price-settings';
const CACHE_KEY = 'stock-ledger:price-cache';

/** Prices and rates older than this are refreshed when the app opens. */
const STALE_MS = 12 * 60 * 60 * 1000;
/** Alpha Vantage's free tier refuses bursts, so space its calls out. */
const ALPHA_VANTAGE_GAP_MS = 1500;

interface PriceCache {
  quotes: Record<string, Quote>;
  fx: FxRates | null;
  lastRefreshAt: number;
}

const EMPTY_CACHE: PriceCache = { quotes: {}, fx: null, lastRefreshAt: 0 };

export interface RefreshResult {
  updated: number;
  failed: { symbol: string; message: string }[];
  /** Symbols skipped because no key covers them. */
  needKey: string[];
  rateLimited: boolean;
  fxFailed: boolean;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Failed to save ${key}:`, error);
  }
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Latest prices for `symbols`, converted to `currency`. Settings (API keys,
 * manual prices) and the last fetched quotes are kept in this browser only.
 */
export function usePrices(symbols: string[], currency: string) {
  const [settings, setSettingsState] = useState<PriceSettings>(() => load(SETTINGS_KEY, DEFAULT_PRICE_SETTINGS));
  const [cache, setCache] = useState<PriceCache>(() => load(CACHE_KEY, EMPTY_CACHE));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const autoRef = useRef(false);

  useEffect(() => save(CACHE_KEY, cache), [cache]);

  const setSettings = useCallback((next: PriceSettings) => {
    setSettingsState(next);
    save(SETTINGS_KEY, next);
  }, []);

  const refresh = useCallback(
    async (only?: string[]): Promise<RefreshResult> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const { signal } = controller;
      const result: RefreshResult = { updated: 0, failed: [], needKey: [], rateLimited: false, fxFailed: false };
      setIsRefreshing(true);

      try {
        try {
          const fx = await fetchFxRates(signal);
          setCache((prev) => ({ ...prev, fx }));
        } catch (error) {
          if (signal.aborted) return result;
          console.warn('Failed to fetch exchange rates:', error);
          result.fxFailed = true;
        }

        let alphaVantageCalls = 0;
        let alphaVantageBlocked = false;
        for (const symbol of only ?? symbols) {
          if (signal.aborted) return result;
          if (settings.symbols[symbol]?.manualPrice !== undefined) continue;
          const plan = planQuote(symbol, settings);
          if (!plan) {
            result.needKey.push(symbol);
            continue;
          }
          if (plan.provider === 'alphavantage') {
            if (alphaVantageBlocked) {
              result.failed.push({ symbol, message: 'Alpha Vantage daily limit reached.' });
              continue;
            }
            if (alphaVantageCalls > 0) await wait(ALPHA_VANTAGE_GAP_MS, signal);
            alphaVantageCalls += 1;
          }
          try {
            const { price, asOf } =
              plan.provider === 'finnhub'
                ? await fetchFinnhubQuote(plan.quoteSymbol, settings.finnhubKey, signal)
                : await fetchAlphaVantageQuote(plan.quoteSymbol, settings.alphaVantageKey, signal);
            const quote: Quote = {
              price,
              currency: plan.currency,
              asOf,
              fetchedAt: Date.now(),
              provider: plan.provider,
              quoteSymbol: plan.quoteSymbol,
            };
            setCache((prev) => ({ ...prev, quotes: { ...prev.quotes, [symbol]: quote } }));
            result.updated += 1;
          } catch (error) {
            if (signal.aborted) return result;
            const message = error instanceof Error ? error.message : 'Failed to fetch.';
            result.failed.push({ symbol, message });
            if (error instanceof PriceSourceError && error.rateLimited) {
              result.rateLimited = true;
              if (plan.provider === 'alphavantage') alphaVantageBlocked = true;
            }
          }
        }
        if (!only) setCache((prev) => ({ ...prev, lastRefreshAt: Date.now() }));
        return result;
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setIsRefreshing(false);
        }
      }
    },
    [settings, symbols],
  );

  // Refresh once on open when the last refresh is stale. Exchange rates need no key.
  const hasKey = Boolean(settings.alphaVantageKey.trim() || settings.finnhubKey.trim());
  useEffect(() => {
    if (autoRef.current || symbols.length === 0) return;
    const now = Date.now();
    const fxStale = !cache.fx || now - cache.fx.fetchedAt > STALE_MS;
    const quotesStale = hasKey && now - cache.lastRefreshAt > STALE_MS;
    if (!fxStale && !quotesStale) return;
    // Deferred so a remount (e.g. React strict mode) cancels it rather than fetching twice.
    const timer = setTimeout(() => {
      autoRef.current = true;
      if (quotesStale) {
        void refresh();
      } else {
        fetchFxRates()
          .then((fx) => setCache((prev) => ({ ...prev, fx })))
          .catch((error) => console.warn('Failed to fetch exchange rates:', error));
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [symbols.length, cache.fx, cache.lastRefreshAt, hasKey, refresh]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const prices = useMemo(() => {
    const map: Record<string, ResolvedPrice | null> = {};
    for (const symbol of symbols) map[symbol] = resolvePrice(symbol, settings, cache.quotes, cache.fx, currency);
    return map;
  }, [symbols, settings, cache.quotes, cache.fx, currency]);

  return {
    prices,
    settings,
    setSettings,
    quotes: cache.quotes,
    fx: cache.fx,
    lastRefreshAt: cache.lastRefreshAt,
    hasKey,
    isRefreshing,
    refresh,
  };
}
