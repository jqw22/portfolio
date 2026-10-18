/**
 * Browser-side calls to the price and exchange rate sources. All four allow
 * cross-origin requests, so the app needs no server:
 *
 * - Alpha Vantage: free key, US and European exchanges, 25 calls a day.
 * - Finnhub: free key, US tickers only on the free tier, 60 calls a minute.
 * - EODHD: free key, US and European exchanges, 20 calls a day.
 * - Frankfurter: ECB reference rates, no key.
 */

import {
  parseAlphaVantageQuote,
  parseEodhdQuote,
  parseFinnhubQuote,
  parseFxRates,
  PriceSourceError,
  type FxRates,
} from './prices';

async function getJson(source: string, url: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new PriceSourceError(`Could not reach ${source}.`);
  }
  // EODHD answers 402 once the day's calls are used up.
  if (response.status === 429 || response.status === 402) throw new PriceSourceError(`${source} limit reached.`, true);
  if (response.status === 401 || response.status === 403) throw new PriceSourceError(`${source} refused the API key.`);
  if (response.status === 404) throw new PriceSourceError(`${source} doesn't know this symbol.`);
  if (!response.ok) throw new PriceSourceError(`${source} answered ${response.status}.`);
  return response.json();
}

export async function fetchAlphaVantageQuote(symbol: string, key: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ function: 'GLOBAL_QUOTE', symbol, apikey: key.trim() });
  return parseAlphaVantageQuote(await getJson('Alpha Vantage', `https://www.alphavantage.co/query?${params}`, signal));
}

export async function fetchFinnhubQuote(symbol: string, key: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ symbol, token: key.trim() });
  return parseFinnhubQuote(await getJson('Finnhub', `https://finnhub.io/api/v1/quote?${params}`, signal));
}

export async function fetchEodhdQuote(symbol: string, key: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ api_token: key.trim(), fmt: 'json' });
  return parseEodhdQuote(await getJson('EODHD', `https://eodhd.com/api/real-time/${encodeURIComponent(symbol)}?${params}`, signal));
}

/** Latest ECB reference rates against the euro. */
export async function fetchFxRates(signal?: AbortSignal): Promise<FxRates> {
  return parseFxRates(await getJson('Frankfurter', 'https://api.frankfurter.dev/v1/latest', signal), Date.now());
}
