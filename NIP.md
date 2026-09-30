# NIP.md — Ledger

Ledger stores a user's stock transactions on Nostr so the data is portable across
devices and clients. It does **not** define any new event kinds. Instead it reuses
the existing **NIP-78** "Application-specific data" kind and layers a documented
schema on top of it.

## Storage event

| Field | Value |
| --- | --- |
| `kind` | `30078` (NIP-78 application-specific data) |
| `content` | NIP-44 ciphertext, encrypted to the author's own pubkey (**encrypt-to-self**) |
| `tags` | `["d", "stock-ledger"]`, `["alt", "Encrypted stock transaction ledger"]` |

Because kind `30078` is **addressable** (replaceable, scoped by `pubkey` + `kind` +
`d` tag), publishing a new event replaces the previous revision. The whole ledger
is therefore kept as a single document rather than one event per trade.

### Why encrypted?

Nothing about a person's portfolio should be public. The content is encrypted with
NIP-44 to the author's own key, so relays (and anyone scraping them) only ever see
ciphertext. Only the author's signer can decrypt it.

### Reading

Query with an author filter — the `d` tag alone is not a trust boundary:

```ts
nostr.query([{
  kinds: [30078],
  authors: [user.pubkey],
  '#d': ['stock-ledger'],
  limit: 1,
}]);
```

Then decrypt with the user's signer:

```ts
const plaintext = await user.signer.nip44.decrypt(user.pubkey, event.content);
```

### Write / update

```ts
const payload = { version: 4, transactions, cash, labels, accounts };
const ciphertext = await user.signer.nip44.encrypt(user.pubkey, JSON.stringify(payload));
await createEvent({
  kind: 30078,
  content: ciphertext,
  tags: [['d', 'stock-ledger'], ['alt', 'Encrypted stock transaction ledger']],
});
```

`created_at` is used for conflict resolution: the newest revision wins. Clients
should keep `created_at` strictly monotonic across their own publishes so two
revisions never tie.

## Decrypted payload schema

`content` decrypts to a JSON object holding the trades, the cash movements and
the user's lists of labels and accounts:

```jsonc
{
  "version": 4,
  "labels": ["Long term", "Dividend"], // user-defined labels, in creation order
  "accounts": ["ISA", "General"],      // accounts trades are made in, in creation order
  "transactions": [
    {
      "id": "0f1e2d3c-…",   // opaque client-generated identifier
      "symbol": "AAPL",      // upper-cased ticker
      "name": "Apple Inc.",  // optional display name
      "date": "2023-01-17",  // YYYY-MM-DD, no time component
      "type": "buy",          // "buy" | "sell"
      "quantity": 20,         // shares, always positive
      "price": 135.94,        // price per share
      "fees": 1,              // commission / fees for the trade
      "notes": "Opening position", // optional
      "label": "Long term",   // optional, one of `labels`
      "account": "ISA"        // one of `accounts` (optional in older data)
    }
  ],
  "cash": [
    {
      "id": "7a6b5c4d-…",   // opaque client-generated identifier
      "date": "2023-01-03",  // YYYY-MM-DD
      "type": "deposit",      // "deposit" | "withdrawal"
      "amount": 5000,         // always positive; the type gives the direction
      "account": "ISA",       // one of `accounts` (optional in the schema)
      "notes": "Initial funding" // optional
    }
  ]
}
```

All amounts are in the user's display currency. Trades in another currency are
converted before they are entered; the ledger stores no exchange rates.

Consumers should be defensive: drop transactions with a missing/invalid
`symbol`, `date`, `type`, non-positive `quantity`, or negative `price`, and cash
movements with a missing/invalid `date`, `type` or non-positive `amount`.

Labels are trimmed, whitespace-collapsed, at most 64 characters, and unique
case-insensitively. A transaction `label` that is missing from `labels` is added
to the list on read. Deleting a label removes it from `labels` and clears it from
every transaction that used it.

Accounts follow the same normalization rules. Unlike labels, an account is only
deleted when no transaction or cash movement uses it; renaming an account renames
it everywhere. An `account` on a transaction or cash movement that is missing
from `accounts` is added on read.
Positions are computed per account: the same symbol held in two accounts is two
separate holdings, each with its own cost basis and realized P&L.

### Older versions

Version 3 is the same object without `cash`; readers treat a missing `cash` as
`[]`. Version 2 also lacks `accounts`, read as `[]`.

Version 1 (legacy)

revisions, written before labels existed, decrypt to a bare JSON array of
transaction objects (the `transactions` array above, without `label` or
`account`). Readers must still accept this form and treat it as
`{ "labels": [], "accounts": [], "cash": [], "transactions": <array> }`.

The next write upgrades any older revision to version 4.

## Derived values (not stored)

Cost basis, average cost, realized P&L, open/closed positions and totals are all
computed client-side from the transaction list using the **average-cost method**.
They are never published — only the raw transactions are. Two different clients
will therefore always agree on the numbers as long as they use the same method.

### Cash

Each account's cash balance is derived the same way, never stored:

```
cash = deposits − withdrawals − Σ buys (quantity × price + fees) + Σ sells (quantity × price − fees)
```

Balances are evaluated at the end of each day, so the order of same-day entries
does not matter. Ledger refuses a new or edited buy or withdrawal (and the
deletion of a deposit or sell) that would take any account's end-of-day balance
below zero on any date, unless that account was already lower than that before
the change. Every trade and cash movement entered in the app belongs to an
account.

## Local cache

While signed out (or offline), the ledger is kept in `localStorage` under
`stock-ledger:cache:<pubkey|anon>`. The cache is a convenience layer only; the
encrypted kind `30078` event is the source of truth. On load, the newer of the two
(evaluated via `event.created_at` vs. the cache's `updatedAt`) wins, and local
edits made offline are re-published.
