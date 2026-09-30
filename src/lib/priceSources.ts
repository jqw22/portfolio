/**
 * Browser-side calls to the price and exchange rate sources. All three allow
 * cross-origin requests, so the app needs no server:
 *
 * - Alpha Vantage: free key, US and European exchanges, 25 calls a day.
 * - Finnhub: free key, US tickers only on the free tier, 60 calls a minute.
 * - Frankfurter: ECB reference rates, no key.
 */

import { parseAlphaVantageQuote, parseFinnhubQuote, parseFxRates, PriceSourceError, type FxRates } from './prices';

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new PriceSourceError('Could not reach the price source.');
  }
  if (response.status === 429) throw new PriceSourceError('Too many requests.', true);
  if (response.status === 401 || response.status === 403) throw new PriceSourceError('The API key was refused.');
  if (!response.ok) throw new PriceSourceError(`The price source answered ${response.status}.`);
  return response.json();
}

export async function fetchAlphaVantageQuote(symbol: string, key: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ function: 'GLOBAL_QUOTE', symbol, apikey: key.trim() });
  return parseAlphaVantageQuote(await getJson(`https://www.alphavantage.co/query?${params}`, signal));
}

export async function fetchFinnhubQuote(symbol: string, key: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ symbol, token: key.trim() });
  return parseFinnhubQuote(await getJson(`https://finnhub.io/api/v1/quote?${params}`, signal));
}

/** Latest ECB reference rates against the euro. */
export async function fetchFxRates(signal?: AbortSignal): Promise<FxRates> {
  return parseFxRates(await getJson('https://api.frankfurter.dev/v1/latest', signal), Date.now());
}
