import { describe, expect, it } from "vitest";

import { axisMoney, dayTime, fittedTimeAxis, valueScale } from "./chartTime";

describe("valueScale", () => {
  it("fits the axis to the values instead of starting at zero", () => {
    const scale = valueScale([52_310, 52_480, 52_900, 52_650]);
    expect(scale.domain[0]).toBeGreaterThan(52_000);
    expect(scale.domain[1]).toBeLessThan(53_100);
    expect(scale.domain[0]).toBeLessThanOrEqual(52_310);
    expect(scale.domain[1]).toBeGreaterThanOrEqual(52_900);
    expect(scale.ticks.length).toBeGreaterThanOrEqual(4);
    expect(scale.ticks.length).toBeLessThanOrEqual(8);
    // Evenly spaced round ticks.
    for (const tick of scale.ticks) expect(tick % scale.step).toBe(0);
  });

  it("gives a flat series a small band around its value", () => {
    const scale = valueScale([10_000]);
    expect(scale.domain[0]).toBeLessThan(10_000);
    expect(scale.domain[1]).toBeGreaterThan(10_000);
    expect(scale.domain[1] - scale.domain[0]).toBeLessThanOrEqual(400);
  });

  it("does not go below zero for positive values", () => {
    expect(valueScale([0, 500, 1_000]).domain[0]).toBe(0);
  });
});

describe("axisMoney", () => {
  it("labels neighbouring ticks differently", () => {
    const { ticks, step } = valueScale([52_310, 52_900]);
    const labels = ticks.map((tick) => axisMoney(tick, step, "GBP"));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("uses compact labels for big steps", () => {
    const { ticks, step } = valueScale([40_000, 90_000]);
    const labels = ticks.map((tick) => axisMoney(tick, step, "GBP"));
    expect(labels.every((label) => /K$/.test(label))).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("fittedTimeAxis", () => {
  it("spans only the saved days for a short history", () => {
    const axis = fittedTimeAxis("2026-11-01", "2026-11-05");
    // 4 days widened to 6, centred: 31 Oct to 6 Nov, plus half a day each side.
    expect(axis.domain[0]).toBe(dayTime("2026-10-31") - 43_200_000);
    expect(axis.domain[1]).toBe(dayTime("2026-11-06") + 43_200_000);
    expect(axis.ticks).toHaveLength(7);
  });

  it("centres a single day", () => {
    const axis = fittedTimeAxis("2026-11-05", "2026-11-05");
    expect(axis.ticks[0]).toBe(dayTime("2026-11-02"));
    expect(axis.ticks.at(-1)).toBe(dayTime("2026-11-08"));
  });

  it("uses weekly ticks for a month", () => {
    const axis = fittedTimeAxis("2026-10-01", "2026-11-01");
    expect(axis.ticks[1] - axis.ticks[0]).toBe(7 * 86_400_000);
    expect(axis.domain[1]).toBe(dayTime("2026-11-01") + 43_200_000);
  });

  it("uses month ticks for three months", () => {
    const axis = fittedTimeAxis("2026-08-05", "2026-11-05");
    expect(axis.ticks).toContain(dayTime("2026-09-01"));
    expect(axis.ticks).toContain(dayTime("2026-10-15"));
  });
});
