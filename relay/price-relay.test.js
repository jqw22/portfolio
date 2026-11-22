import { afterEach, describe, expect, it, vi } from 'vitest';

import relay, { parseChart, parseHistory } from './price-relay.js';

function chart(price, currency = 'GBp') {
  return { chart: { result: [{ meta: { regularMarketPrice: price, currency, regularMarketTime: 1790000000 } }], error: null } };
}

function memoryCache() {
  const store = new Map();
  return {
    match: async (request) => store.get(request.url)?.clone(),
    put: async (request, response) => void store.set(request.url, response),
  };
}

const ctx = { waitUntil: (promise) => promise };

function ask(query, origin = 'https://jqw22.github.io') {
  const headers = origin ? { origin } : {};
  return relay.fetch(new Request(`https://relay.example/?${query}`, { headers }), {}, ctx);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseChart', () => {
  it('reads the price, currency and time', () => {
    expect(parseChart(chart(2150.5))).toEqual({ price: 2150.5, currency: 'GBp', time: 1790000000 });
  });

  it('reads the previous close from the summary', () => {
    const body = chart(2150.5);
    body.chart.result[0].meta.previousClose = 2110;
    expect(parseChart(body).previousClose).toBe(2110);
  });

  it('works the previous close out from daily closes when the summary has none', () => {
    const day = 86400;
    const time = 1790000000;
    const body = chart(2150.5);
    Object.assign(body.chart.result[0], {
      // Three earlier days (one with no close) and today's unfinished day.
      timestamp: [time - 3 * day, time - 2 * day, time - day, time - 60],
      indicators: { quote: [{ close: [2000, 2050, null, 2150.5] }] },
    });
    // chartPreviousClose is the close before the whole chart, so it is not used.
    body.chart.result[0].meta.chartPreviousClose = 1900;
    expect(parseChart(body).previousClose).toBe(2050);
  });

  it('leaves the previous close out when there is nothing to work it out from', () => {
    const body = chart(2150.5);
    body.chart.result[0].meta.chartPreviousClose = 1900;
    expect(parseChart(body)).not.toHaveProperty('previousClose');
  });

  it('reports unknown symbols', () => {
    expect(() => parseChart({ chart: { result: null, error: { code: 'Not Found', description: 'No data found' } } })).toThrow(
      'Symbol not found.',
    );
    expect(() => parseChart({ chart: { result: [{ meta: {} }], error: null } })).toThrow('Symbol not found.');
  });
});

describe('relay', () => {
  it('returns quotes and errors per symbol, with CORS for the app', async () => {
    vi.stubGlobal('caches', { default: memoryCache() });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        String(url).includes('DGE.L')
          ? Response.json(chart(2150.5))
          : Response.json({ chart: { result: null, error: { code: 'Not Found' } } }, { status: 404 }),
      ),
    );
    const response = await ask('symbols=dge.l,NOPE.L');
    expect(response.headers.get('access-control-allow-origin')).toBe('https://jqw22.github.io');
    expect(await response.json()).toEqual({
      quotes: { 'DGE.L': { price: 2150.5, currency: 'GBp', time: 1790000000 } },
      errors: { 'NOPE.L': 'Symbol not found.' },
    });
  });

  it('tries the second Yahoo host when the first refuses', async () => {
    vi.stubGlobal('caches', { default: memoryCache() });
    const fetchMock = vi.fn(async (url) =>
      String(url).startsWith('https://query1') ? new Response('busy', { status: 429 }) : Response.json(chart(72.46)),
    );
    vi.stubGlobal('fetch', fetchMock);
    const body = await (await ask('symbols=VOD.L')).json();
    expect(body.quotes['VOD.L'].price).toBe(72.46);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serves repeat requests from the cache', async () => {
    vi.stubGlobal('caches', { default: memoryCache() });
    const fetchMock = vi.fn(async () => Response.json(chart(72.46)));
    vi.stubGlobal('fetch', fetchMock);
    await ask('symbols=VOD.L');
    const body = await (await ask('symbols=VOD.L')).json();
    expect(body.quotes['VOD.L'].price).toBe(72.46);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses other websites and bad input', async () => {
    vi.stubGlobal('caches', { default: memoryCache() });
    vi.stubGlobal('fetch', vi.fn());
    expect((await ask('symbols=VOD.L', 'https://evil.example')).status).toBe(403);
    expect((await ask('symbols=')).status).toBe(400);
    const body = await (await ask('symbols=BAD%20SYMBOL')).json();
    expect(body.errors['BAD SYMBOL']).toBe('Not a valid symbol.');
  });

  it('returns price history when asked with history=', async () => {
    vi.stubGlobal('caches', { default: memoryCache() });
    const fetchMock = vi.fn(async () => Response.json(historyChart()));
    vi.stubGlobal('fetch', fetchMock);
    const body = await (await ask('history=vod.l')).json();
    expect(body).toEqual({ history: { 'VOD.L': { currency: 'GBp', dates: ['2026-11-18', '2026-11-19', '2026-11-20'], closes: [70, 71, 72.5] } }, errors: {} });
    expect(String(fetchMock.mock.calls[0][0])).toContain('range=1y');
    // Cached separately from latest prices.
    await ask('history=VOD.L');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function historyChart() {
  const day = 86400;
  // 18 Nov 2026 08:00 UTC, London time.
  const start = Date.UTC(2026, 10, 18, 8) / 1000;
  return {
    chart: {
      result: [
        {
          meta: { regularMarketPrice: 72.5, currency: 'GBp', gmtoffset: 0 },
          timestamp: [start, start + day, start + 2 * day],
          indicators: { quote: [{ close: [71, 72, 73.5] }], adjclose: [{ adjclose: [70, 71, 72.5] }] },
        },
      ],
      error: null,
    },
  };
}

describe('parseHistory', () => {
  it('reads adjusted daily closes with their dates', () => {
    expect(parseHistory(historyChart())).toEqual({
      currency: 'GBp',
      dates: ['2026-11-18', '2026-11-19', '2026-11-20'],
      closes: [70, 71, 72.5],
    });
  });

  it('falls back to plain closes, skips gaps and keeps the last candle of a day', () => {
    const body = historyChart();
    const result = body.chart.result[0];
    delete result.indicators.adjclose;
    result.timestamp.push(result.timestamp[2] + 3600);
    result.indicators.quote[0].close = [71, null, 73.5, 74];
    expect(parseHistory(body)).toEqual({ currency: 'GBp', dates: ['2026-11-18', '2026-11-20'], closes: [71, 74] });
  });

  it('reports unknown symbols', () => {
    expect(() => parseHistory({ chart: { result: null, error: { code: 'Not Found' } } })).toThrow('Symbol not found.');
  });
});
