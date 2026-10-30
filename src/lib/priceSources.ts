/**
 * Browser-side calls to the price and exchange rate sources. All of them allow
 * cross-origin requests, so the app needs no server of its own:
 *
 * - Price relay: the user's own Cloudflare Worker (`relay/`) passing on Yahoo
 *   prices, which covers London and European exchanges with no daily limit.
 * - Alpha Vantage: free key, US and European exchanges, 25 calls a day.
 * - Finnhub: free key, US tickers only on the free tier, 60 calls a minute.
 * - Frankfurter: ECB reference rates, no key.
 */

import {
  parseAlphaVantageQuote,
  parseFinnhubQuote,
  parseFxRates,
  parseRelayResponse,
  parseRelayUrl,
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
  if (response.status === 429) throw new PriceSourceError(`${source} limit reached.`, true);
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

/**
 * Symbols per relay request. The relay accepts up to 50, but a free Cloudflare Worker may make
 * only 50 outside calls per request and each symbol can take four (cache read, two Yahoo hosts,
 * cache write), so ask for fewer at a time.
 */
export const RELAY_BATCH = 10;

/** Latest prices for Yahoo-style `symbols` from the user's price relay. */
export async function fetchRelayQuotes(relayUrl: string, symbols: string[], signal?: AbortSignal) {
  const url = parseRelayUrl(relayUrl);
  if (!url) throw new PriceSourceError('The price relay address must start with https://.');
  url.searchParams.set('symbols', symbols.join(','));
  return parseRelayResponse(await getJson('the price relay', url.toString(), signal), symbols);
}

/** Latest ECB reference rates against the euro. */
export async function fetchFxRates(signal?: AbortSignal): Promise<FxRates> {
  return parseFxRates(await getJson('Frankfurter', 'https://api.frankfurter.dev/v1/latest', signal), Date.now());
}
