import { describe, expect, it } from "vitest";

import { summariseByAccount, summariseByLabel } from "./analysis";
import { positionKey, type Holding, type Transaction } from "./portfolio";

function holding(
  account: string | undefined,
  symbol: string,
  costBasis: number,
): Holding {
  return {
    key: positionKey(account, symbol),
    account,
    symbol,
    quantity: 1,
    costBasis,
    avgCost: costBasis,
    realizedPnl: 0,
  } as unknown as Holding;
}

describe("analysis table order", () => {
  it("sorts accounts A to Z with No account last", () => {
    const holdings = [
      holding("Zeta", "A", 10),
      holding(undefined, "B", 10),
      holding("alpha", "C", 10),
      holding("ISA 2", "D", 10),
      holding("ISA 10", "E", 10),
    ];
    const rows = summariseByAccount(holdings, [], {}).rows.map(
      (row) => row.name ?? "(none)",
    );
    expect(rows).toEqual(["alpha", "ISA 2", "ISA 10", "Zeta", "(none)"]);
  });

  it("sorts labels A to Z with Unlabelled then Cash last", () => {
    const holdings = [
      holding("X", "A", 10),
      holding("X", "B", 10),
      holding("X", "C", 10),
    ];
    const tx = (symbol: string, label?: string) =>
      ({
        id: symbol,
        date: "2026-01-01",
        type: "buy",
        symbol,
        account: "X",
        quantity: 1,
        price: 10,
        label,
      }) as unknown as Transaction;
    const rows = summariseByLabel(
      holdings,
      [tx("A", "Tech"), tx("B", "bonds"), tx("C")],
      [{ account: "X", balance: 5 }] as never,
      {},
    ).rows.map((row) => row.name ?? "(none)");
    expect(rows).toEqual(["bonds", "Tech", "(none)", "Cash"]);
  });
});
