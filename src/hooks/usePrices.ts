import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchAlphaVantageQuote, fetchFinnhubQuote, fetchFxRates, fetchRelayQuotes, RELAY_BATCH } from '@/lib/priceSources';
import {
  DEFAULT_PRICE_SETTINGS,
  planQuotes,
  PriceSourceError,
  resolvePrice,
  type FxRates,
  type PriceSettings,
  type Quote,
  type QuotePlan,
  type RelayQuote,
  type ResolvedPrice,
} from '@/lib/prices';

const SETTINGS_KEY = 'stock-ledger:price-settings';
const CACHE_KEY = 'stock-ledger:price-cache';

/** Prices and rates older than this are refreshed when the app opens. */
const STALE_MS = 12 * 60 * 60 * 1000;
/** Refresh skips prices fetched more recently than this, to save the daily allowances. */
const FRESH_MS = 4 * 60 * 60 * 1000;
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
  /** Symbols skipped because their price was fetched in the last few hours. */
  skipped: number;
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

const PROVIDER_NAMES: Record<QuotePlan['provider'], string> = {
  relay: 'Price relay',
  alphavantage: 'Alpha Vantage',
  finnhub: 'Finnhub',
};

type RelayAnswer = RelayQuote | { error: string };

/** What a source answered for one symbol. */
type Found = { price: number; previousClose?: number; asOf: string; currency?: string };

function fromRelayAnswer(answer: RelayAnswer): Found {
  if ('error' in answer) throw new PriceSourceError(answer.error);
  return { price: answer.price, previousClose: answer.previousClose, asOf: answer.asOf, currency: answer.currency || undefined };
}

async function callProvider(
  plan: QuotePlan,
  settings: PriceSettings,
  signal?: AbortSignal,
): Promise<Found> {
  switch (plan.provider) {
    case 'relay': {
      const answers = await fetchRelayQuotes(settings.relayUrl, [plan.quoteSymbol], signal);
      return fromRelayAnswer(answers[plan.quoteSymbol]);
    }
    case 'finnhub':
      return fetchFinnhubQuote(plan.quoteSymbol, settings.finnhubKey, signal);
    case 'alphavantage':
      return fetchAlphaVantageQuote(plan.quoteSymbol, settings.alphaVantageKey, signal);
  }
}

function toQuote(plan: QuotePlan, found: Found): Quote {
  return {
    price: found.price,
    ...(found.previousClose !== undefined ? { previousClose: found.previousClose } : {}),
    currency: found.currency ?? plan.currency,
    asOf: found.asOf,
    fetchedAt: Date.now(),
    provider: plan.provider,
    quoteSymbol: plan.quoteSymbol,
  };
}

async function fetchQuote(plan: QuotePlan, settings: PriceSettings, signal?: AbortSignal): Promise<Quote> {
  return toQuote(plan, await callProvider(plan, settings, signal));
}

/** Ask the relay for many symbols in as few requests as it allows. A failed request becomes an error for each of its symbols. */
async function fetchRelayBatch(relayUrl: string, symbols: string[], signal: AbortSignal) {
  const answers: Record<string, RelayAnswer> = {};
  for (let start = 0; start < symbols.length; start += RELAY_BATCH) {
    const chunk = symbols.slice(start, start + RELAY_BATCH);
    try {
      Object.assign(answers, await fetchRelayQuotes(relayUrl, chunk, signal));
    } catch (error) {
      if (signal.aborted) throw error;
      const message = error instanceof Error ? error.message : 'Failed to fetch.';
      for (const symbol of chunk) answers[symbol] = { error: message };
    }
  }
  return answers;
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
  const quotesRef = useRef(cache.quotes);
  const autoRef = useRef(false);

  useEffect(() => {
    quotesRef.current = cache.quotes;
    save(CACHE_KEY, cache);
  }, [cache]);

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
      const result: RefreshResult = { updated: 0, skipped: 0, failed: [], needKey: [], rateLimited: false, fxFailed: false };
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

        // The relay takes many symbols a request, so ask it for all of them up front.
        const toFetch = (only ?? symbols).filter((symbol) => settings.symbols[symbol]?.manualPrice === undefined);
        const relaySymbols = new Map<string, string>();
        for (const symbol of toFetch) {
          const first = planQuotes(symbol, settings)[0];
          if (first?.provider === 'relay') relaySymbols.set(symbol, first.quoteSymbol);
        }
        const relayAnswers =
          relaySymbols.size > 0
            ? await fetchRelayBatch(settings.relayUrl, [...new Set(relaySymbols.values())], signal).catch((error) => {
                if (signal.aborted) return null;
                throw error;
              })
            : {};
        if (!relayAnswers) return result;

        let alphaVantageCalls = 0;
        /** Sources whose allowance ran out during this refresh. */
        const blocked = new Set<QuotePlan['provider']>();
        const now = Date.now();
        for (const symbol of only ?? symbols) {
          if (signal.aborted) return result;
          if (settings.symbols[symbol]?.manualPrice !== undefined) continue;
          const plans = planQuotes(symbol, settings);
          if (plans.length === 0) {
            result.needKey.push(symbol);
            continue;
          }
          // Sources with a daily allowance skip prices fetched in the last few hours; the relay has none.
          const last = quotesRef.current[symbol];
          if (!only && plans[0].provider !== 'relay' && last && now - last.fetchedAt < FRESH_MS) {
            result.skipped += 1;
            continue;
          }
          let failure: { message: string; rateLimited: boolean } | null = null;
          for (const plan of plans) {
            if (blocked.has(plan.provider)) {
              failure = { message: `${PROVIDER_NAMES[plan.provider]} daily limit reached.`, rateLimited: true };
              continue;
            }
            if (plan.provider === 'alphavantage') {
              if (alphaVantageCalls > 0) await wait(ALPHA_VANTAGE_GAP_MS, signal);
              alphaVantageCalls += 1;
            }
            try {
              const relayAnswer = plan.provider === 'relay' ? relayAnswers[plan.quoteSymbol] : undefined;
              const quote = relayAnswer
                ? toQuote(plan, fromRelayAnswer(relayAnswer))
                : await fetchQuote(plan, settings, signal);
              setCache((prev) => ({ ...prev, quotes: { ...prev.quotes, [symbol]: quote } }));
              result.updated += 1;
              failure = null;
              break;
            } catch (error) {
              if (signal.aborted) return result;
              const rateLimited = error instanceof PriceSourceError && error.rateLimited;
              if (rateLimited) blocked.add(plan.provider);
              failure = { message: error instanceof Error ? error.message : 'Failed to fetch.', rateLimited };
            }
          }
          if (failure) {
            result.failed.push({ symbol, message: failure.message });
            if (failure.rateLimited) result.rateLimited = true;
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

  /**
   * Fetch one symbol's price even when it has a manual price, using `using`
   * (e.g. unsaved settings from the Prices dialog). The quote is cached; the
   * manual price is left for the caller to clear.
   */
  const fetchOne = useCallback(async (symbol: string, using: PriceSettings): Promise<Quote> => {
    const plans = planQuotes(symbol, using);
    if (plans.length === 0) throw new Error('Add an API key that covers this symbol.');
    // Report every source's failure, so it's clear which step went wrong.
    const failures: string[] = [];
    for (const plan of plans) {
      try {
        const quote = await fetchQuote(plan, using);
        setCache((prev) => ({ ...prev, quotes: { ...prev.quotes, [symbol]: quote } }));
        return quote;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch.';
        const name = PROVIDER_NAMES[plan.provider];
        failures.push(message.toLowerCase().includes(name.toLowerCase()) ? message : `${name}: ${message}`);
      }
    }
    throw new Error(failures.map((failure) => failure.charAt(0).toUpperCase() + failure.slice(1)).join(' '));
  }, []);

  // Refresh once on open when the last refresh is stale. Exchange rates need no key.
  const hasKey = Boolean(settings.relayUrl.trim() || settings.alphaVantageKey.trim() || settings.finnhubKey.trim());
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
    fetchOne,
  };
}
