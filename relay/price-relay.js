/**
 * Virtual Stock Portfolio price relay: a Cloudflare Worker that fetches latest prices from
 * Yahoo Finance for the Virtual Stock Portfolio app. Yahoo doesn't allow requests from web
 * pages, so the app asks this worker instead.
 *
 *   GET /?symbols=VOD.L,SAP.DE,AAPL
 *   → { "quotes": { "VOD.L": { "price": 72.46, "previousClose": 71.9, "currency": "GBp", "time": 1790000000 } },
 *       "errors": { "NOPE.L": "Symbol not found." } }
 *
 *   GET /?history=VOD.L,AAPL
 *   → { "history": { "VOD.L": { "currency": "GBp", "dates": ["2025-11-24", …], "closes": [70.1, …] } },
 *       "errors": {} }
 *
 * History is about a year of daily closes (adjusted for dividends and splits when Yahoo has
 * them), used by the app's Analysis tab for volatility and correlation.
 *
 * Symbols use Yahoo's spelling (London .L, Xetra .DE, Paris .PA, Amsterdam
 * .AS, US tickers bare). Only the symbols pass through here, never trades.
 * Answers are cached at the edge for a few minutes so repeated refreshes
 * don't hit Yahoo again.
 */

/** Web pages allowed to read the relay's answers. */
const ALLOWED_ORIGINS = ['https://jqw22.github.io'];
/** Local development servers on any port. */
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const MAX_SYMBOLS = 50;
const SYMBOL_PATTERN = /^[A-Z0-9^=.-]{1,20}$/;
const CACHE_SECONDS = 300;
/** Daily closes only change once a day. */
const HISTORY_CACHE_SECONDS = 6 * 60 * 60;
const YAHOO_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

function allowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin);
}

function json(body, status, origin) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', vary: 'Origin' };
  if (origin) headers['access-control-allow-origin'] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

/** The day (in the exchange's own time zone) that a unix time falls on. */
function marketDay(time, offset) {
  return Math.floor((time + offset) / 86400);
}

/**
 * The last daily close before the day of `time`, from the chart's daily candles. Used when Yahoo
 * leaves `previousClose` out of the summary, which it does for some symbols.
 */
function lastCloseBefore(result, time, offset) {
  const stamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(stamps) || !Array.isArray(closes) || !time) return undefined;
  const today = marketDay(time, offset);
  for (let index = Math.min(stamps.length, closes.length) - 1; index >= 0; index -= 1) {
    const close = Number(closes[index]);
    if (marketDay(Number(stamps[index]), offset) < today && Number.isFinite(close) && close > 0) return close;
  }
  return undefined;
}

/**
 * Read Yahoo's chart response into `{ price, previousClose, currency, time }`, or throw a
 * readable error. `previousClose` is the last session's close, left out when Yahoo has none.
 * The chart covers several days, so its `chartPreviousClose` (the close before the first day) is
 * not used.
 */
export function parseChart(body) {
  const error = body?.chart?.error;
  if (error) throw new Error(error.code === 'Not Found' ? 'Symbol not found.' : String(error.description || error.code));
  const chartResult = body?.chart?.result?.[0];
  const meta = chartResult?.meta;
  const price = Number(meta?.regularMarketPrice);
  if (!meta || !Number.isFinite(price) || price <= 0) throw new Error('Symbol not found.');
  const time = Number(meta.regularMarketTime);
  const result = { price, currency: typeof meta.currency === 'string' ? meta.currency : '', time: Number.isFinite(time) ? time : 0 };
  const offset = Number.isFinite(Number(meta.gmtoffset)) ? Number(meta.gmtoffset) : 0;
  const summary = Number(meta.previousClose);
  const previousClose = Number.isFinite(summary) && summary > 0 ? summary : lastCloseBefore(chartResult, result.time, offset);
  if (previousClose !== undefined) result.previousClose = previousClose;
  return result;
}

async function fromYahoo(symbol, range, parse) {
  let lastError = 'Yahoo could not be reached.';
  // query2 is a second front door to the same data; try it when query1 refuses.
  for (const host of YAHOO_HOSTS) {
    let response;
    try {
      response = await fetch(`${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; LedgerPriceRelay/1.0)', accept: 'application/json' },
      });
    } catch (error) {
      // Includes Cloudflare refusing more outside calls in one request.
      lastError = `Yahoo could not be reached (${error instanceof Error ? error.message : 'network error'}).`;
      continue;
    }
    if (response.status === 404) {
      return parse(await response.json().catch(() => ({ chart: { error: { code: 'Not Found' } } })));
    }
    if (!response.ok) {
      lastError = `Yahoo answered ${response.status}.`;
      continue;
    }
    return parse(await response.json());
  }
  throw new Error(lastError);
}

/** `YYYY-MM-DD` for a unix time, in the exchange's own time zone. */
function isoDay(time, offset) {
  return new Date(marketDay(time, offset) * 86400 * 1000).toISOString().slice(0, 10);
}

/**
 * Read Yahoo's chart response into `{ currency, dates, closes }`: one close per trading day,
 * oldest first, adjusted for dividends and splits when Yahoo gives adjusted closes. Days with no
 * close are left out. Throws a readable error for unknown symbols.
 */
export function parseHistory(body) {
  const error = body?.chart?.error;
  if (error) throw new Error(error.code === 'Not Found' ? 'Symbol not found.' : String(error.description || error.code));
  const chartResult = body?.chart?.result?.[0];
  const meta = chartResult?.meta;
  const stamps = chartResult?.timestamp;
  const adjusted = chartResult?.indicators?.adjclose?.[0]?.adjclose;
  const raw = chartResult?.indicators?.quote?.[0]?.close;
  const closes = Array.isArray(adjusted) && adjusted.some((value) => Number(value) > 0) ? adjusted : raw;
  if (!meta || !Array.isArray(stamps) || !Array.isArray(closes)) throw new Error('Symbol not found.');
  const offset = Number.isFinite(Number(meta.gmtoffset)) ? Number(meta.gmtoffset) : 0;
  const days = new Map();
  for (let index = 0; index < Math.min(stamps.length, closes.length); index += 1) {
    const close = Number(closes[index]);
    const time = Number(stamps[index]);
    if (closes[index] === null || !Number.isFinite(close) || close <= 0 || !Number.isFinite(time)) continue;
    // A later candle on the same day (e.g. today's live one) replaces the earlier one.
    days.set(isoDay(time, offset), Math.round(close * 10000) / 10000);
  }
  if (days.size === 0) throw new Error('No price history for this symbol.');
  const dates = [...days.keys()].sort();
  return { currency: typeof meta.currency === 'string' ? meta.currency : '', dates, closes: dates.map((date) => days.get(date)) };
}

async function history(symbol, ctx) {
  const cache = caches.default;
  const key = new Request(`https://ledger-price-relay.cache/yahoo-history-v1/${encodeURIComponent(symbol)}`);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const result = await fromYahoo(symbol, '1y', parseHistory);
  const stored = new Response(JSON.stringify(result), {
    headers: { 'content-type': 'application/json', 'cache-control': `max-age=${HISTORY_CACHE_SECONDS}` },
  });
  ctx.waitUntil(cache.put(key, stored));
  return result;
}

async function quote(symbol, ctx) {
  const cache = caches.default;
  const key = new Request(`https://ledger-price-relay.cache/yahoo-v2/${encodeURIComponent(symbol)}`);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const result = await fromYahoo(symbol, '5d', parseChart);
  const stored = new Response(JSON.stringify(result), {
    headers: { 'content-type': 'application/json', 'cache-control': `max-age=${CACHE_SECONDS}` },
  });
  ctx.waitUntil(cache.put(key, stored));
  return result;
}

export default {
  async fetch(request, _env, ctx) {
    const origin = request.headers.get('origin');
    // Requests without an Origin (e.g. opening the URL in a tab) are allowed so the relay is easy to test.
    if (origin && !allowedOrigin(origin)) return json({ error: 'This origin is not allowed.' }, 403);
    const allow = origin || undefined;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { 'access-control-allow-origin': allow ?? '*', 'access-control-allow-methods': 'GET', vary: 'Origin' },
      });
    }
    if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405, allow);

    const params = new URL(request.url).searchParams;
    const wantsHistory = params.has('history');
    const symbols = [
      ...new Set(
        (params.get(wantsHistory ? 'history' : 'symbols') ?? '')
          .split(',')
          .map((symbol) => symbol.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    if (symbols.length === 0) return json({ error: 'Pass symbols, e.g. ?symbols=VOD.L,AAPL or ?history=VOD.L,AAPL' }, 400, allow);
    if (symbols.length > MAX_SYMBOLS) return json({ error: `At most ${MAX_SYMBOLS} symbols at a time.` }, 400, allow);

    const found = {};
    const errors = {};
    await Promise.all(
      symbols.map(async (symbol) => {
        if (!SYMBOL_PATTERN.test(symbol)) {
          errors[symbol] = 'Not a valid symbol.';
          return;
        }
        try {
          found[symbol] = await (wantsHistory ? history(symbol, ctx) : quote(symbol, ctx));
        } catch (error) {
          errors[symbol] = error instanceof Error ? error.message : 'Failed to fetch.';
        }
      }),
    );
    if (wantsHistory) return json({ history: found, errors }, 200, allow);
    return json({ quotes: found, errors }, 200, allow);
  },
};
