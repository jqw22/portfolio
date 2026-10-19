/**
 * Ledger price relay: a Cloudflare Worker that fetches latest prices from
 * Yahoo Finance for the Ledger app. Yahoo doesn't allow requests from web
 * pages, so the app asks this worker instead.
 *
 *   GET /?symbols=VOD.L,SAP.DE,AAPL
 *   → { "quotes": { "VOD.L": { "price": 72.46, "currency": "GBp", "time": 1790000000 } },
 *       "errors": { "NOPE.L": "Symbol not found." } }
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
const YAHOO_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

function allowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin);
}

function json(body, status, origin) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', vary: 'Origin' };
  if (origin) headers['access-control-allow-origin'] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

/** Read Yahoo's chart response into `{ price, currency, time }`, or throw a readable error. */
export function parseChart(body) {
  const error = body?.chart?.error;
  if (error) throw new Error(error.code === 'Not Found' ? 'Symbol not found.' : String(error.description || error.code));
  const meta = body?.chart?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice);
  if (!meta || !Number.isFinite(price) || price <= 0) throw new Error('Symbol not found.');
  const time = Number(meta.regularMarketTime);
  return { price, currency: typeof meta.currency === 'string' ? meta.currency : '', time: Number.isFinite(time) ? time : 0 };
}

async function fromYahoo(symbol) {
  let lastError = 'Yahoo could not be reached.';
  // query2 is a second front door to the same data; try it when query1 refuses.
  for (const host of YAHOO_HOSTS) {
    let response;
    try {
      response = await fetch(`${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; LedgerPriceRelay/1.0)', accept: 'application/json' },
      });
    } catch {
      continue;
    }
    if (response.status === 404) {
      return parseChart(await response.json().catch(() => ({ chart: { error: { code: 'Not Found' } } })));
    }
    if (!response.ok) {
      lastError = `Yahoo answered ${response.status}.`;
      continue;
    }
    return parseChart(await response.json());
  }
  throw new Error(lastError);
}

async function quote(symbol, ctx) {
  const cache = caches.default;
  const key = new Request(`https://ledger-price-relay.cache/yahoo/${encodeURIComponent(symbol)}`);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const result = await fromYahoo(symbol);
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

    const symbols = [
      ...new Set(
        (new URL(request.url).searchParams.get('symbols') ?? '')
          .split(',')
          .map((symbol) => symbol.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    if (symbols.length === 0) return json({ error: 'Pass symbols, e.g. ?symbols=VOD.L,AAPL' }, 400, allow);
    if (symbols.length > MAX_SYMBOLS) return json({ error: `At most ${MAX_SYMBOLS} symbols at a time.` }, 400, allow);

    const quotes = {};
    const errors = {};
    await Promise.all(
      symbols.map(async (symbol) => {
        if (!SYMBOL_PATTERN.test(symbol)) {
          errors[symbol] = 'Not a valid symbol.';
          return;
        }
        try {
          quotes[symbol] = await quote(symbol, ctx);
        } catch (error) {
          errors[symbol] = error instanceof Error ? error.message : 'Failed to fetch.';
        }
      }),
    );
    return json({ quotes, errors }, 200, allow);
  },
};
