import { afterEach, describe, expect, it, vi } from 'vitest';

import relay, { parseChart } from './price-relay.js';

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

  it('reads the previous close, preferring previousClose over chartPreviousClose', () => {
    const body = chart(2150.5);
    body.chart.result[0].meta.chartPreviousClose = 2100;
    expect(parseChart(body).previousClose).toBe(2100);
    body.chart.result[0].meta.previousClose = 2110;
    expect(parseChart(body).previousClose).toBe(2110);
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
});
