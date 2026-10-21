# Price relay

Ledger runs entirely in your browser, and Yahoo Finance refuses requests from
web pages. This relay is a tiny Cloudflare Worker that asks Yahoo for Ledger
and passes the prices back. It covers London, European and US exchanges with
no daily limit (Cloudflare's free plan allows 100,000 requests a day).

Only stock symbols pass through the relay, never your trades or holdings.

## Set it up (about 5 minutes, free)

1. Sign up at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
   (the free plan is enough; no card needed).
2. In the dashboard, open **Workers & Pages**, choose **Create**, then
   **Create Worker** (the "Hello World" starter).
3. Name it, for example `ledger-prices`, and press **Deploy**.
4. Press **Edit code**, delete everything in `worker.js`, paste in the whole of
   [`price-relay.js`](./price-relay.js), and press **Deploy** again.
5. Copy the worker's address, e.g. `https://ledger-prices.your-name.workers.dev`.
6. In Ledger, open **Prices**, paste the address into **Price relay address**,
   press **Save**, then press **Refresh**.

To check it works, open
`https://ledger-prices.your-name.workers.dev/?symbols=VOD.L,AAPL` in a browser
tab. You should see a price for each symbol.

## Notes

- Only pages on `https://jqw22.github.io` (and local development servers) may
  read the relay's answers. If Ledger moves to another address, add it to
  `ALLOWED_ORIGINS` at the top of `price-relay.js` and deploy again.
- Prices are cached for 5 minutes, so pressing Refresh repeatedly doesn't
  call Yahoo again.
- If Yahoo refuses a request, the relay retries on Yahoo's second server. If
  that also fails, Ledger falls back to your Alpha Vantage or Finnhub key when
  you have one.
- London prices come back in pence (`GBp`); Ledger converts them to pounds.
- The relay also passes on the previous close, which Ledger uses for the Day
  change column. A relay deployed before this was added shows "—" there until
  you paste in the latest `price-relay.js` and deploy again.
