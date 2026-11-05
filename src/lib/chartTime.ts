/** Shared formatting and axis helpers for the snapshot charts on the Analysis tab. */

import { formatCurrency } from "./portfolio";

export function dayLabel(time: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
  }).format(new Date(time));
}

export function dayTime(date: string): number {
  return new Date(`${date}T00:00:00`).getTime();
}

/** Axis ticks on the 1st and 15th of each month between `start` and `end`. */
export function monthTicks(start: string, end: string): number[] {
  const ticks: number[] = [];
  const from = dayTime(start);
  const to = dayTime(end);
  const cursor = new Date(from);
  cursor.setDate(1);
  while (cursor.getTime() <= to) {
    for (const day of [1, 15]) {
      const time = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        day,
      ).getTime();
      if (time >= from && time <= to) ticks.push(time);
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return ticks;
}

export function fullDayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

export function compactMoney(value: number, currency: string): string {
  return formatCurrency(value, currency, {
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

export interface ValueScale {
  domain: [number, number];
  ticks: number[];
  step: number;
}

/** A "nice" step (1, 2, 2.5 or 5 times a power of ten) at or above `rough`. */
function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const nice =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/**
 * A y-axis fitted to the values (not starting at zero), with about `count`
 * evenly spaced round ticks, so day-to-day moves are visible. A flat or
 * single-point series gets a small band around its value.
 */
export function valueScale(values: number[], count = 5): ValueScale {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { domain: [0, 1], ticks: [0, 1], step: 1 };
  const dataMin = Math.min(...finite);
  const dataMax = Math.max(...finite);
  let min = dataMin;
  let max = dataMax;
  if (max - min < Math.max(Math.abs(max) * 0.002, 1)) {
    // Flat: show about ±1% (at least 5) around the value.
    const pad = Math.max(Math.abs(max) * 0.01, 5);
    min -= pad;
    max += pad;
  } else {
    // A little headroom so the line doesn't touch the top or bottom.
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;
  }
  const step = niceStep((max - min) / Math.max(count - 1, 1));
  let low = Math.floor(min / step) * step;
  const high = Math.ceil(max / step) * step;
  // Don't dip below zero for a series that never does.
  if (low < 0 && dataMin >= 0) low = 0;
  const ticks: number[] = [];
  for (let index = 0; low + index * step <= high + step / 2; index += 1) {
    ticks.push(Math.round((low + index * step) * 100) / 100);
  }
  return { domain: [ticks[0], ticks[ticks.length - 1]], ticks, step };
}

/** Axis label for a tick on a scale with spacing `step`, precise enough that neighbours differ. */
export function axisMoney(value: number, step: number, currency: string): string {
  if (step < 1000) {
    return formatCurrency(value, currency, {
      minimumFractionDigits: 0,
      maximumFractionDigits: step < 1 ? 2 : 0,
    });
  }
  // Compact labels (£52.5K, £1.25M) with just enough decimals for the step.
  const unit = Math.abs(value) >= 1_000_000 ? 1_000_000 : 1000;
  let digits = 0;
  while (digits < 3 && Math.abs(Math.round((step / unit) * 10 ** digits) - (step / unit) * 10 ** digits) > 1e-9) {
    digits += 1;
  }
  return formatCurrency(value, currency, {
    notation: "compact",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

const DAY = 86_400_000;

export interface TimeAxis {
  domain: [number, number];
  ticks: number[];
}

/**
 * An x-axis that spans only the saved days (`first` to `last`, as `YYYY-MM-DD`),
 * at least `minDays` wide (a short history is centred), with ticks spaced to
 * suit the span: daily up to two weeks, weekly up to two months, then the 1st
 * and 15th of each month.
 */
export function fittedTimeAxis(first: string, last: string, minDays = 6): TimeAxis {
  let from = dayTime(first);
  let to = dayTime(last);
  const days = Math.round((to - from) / DAY);
  if (days < minDays) {
    const pad = Math.ceil((minDays - days) / 2);
    from -= pad * DAY;
    to += pad * DAY;
  }
  // Half a day of room each side so the end points aren't clipped by the edge.
  const domain: [number, number] = [from - DAY / 2, to + DAY / 2];
  const span = Math.round((to - from) / DAY);
  if (span > 62) {
    return { domain, ticks: monthTicks(toDate(from), toDate(to)) };
  }
  const every = span <= 14 ? 1 : 7;
  const ticks: number[] = [];
  for (let day = 0; day <= span; day += every) {
    const date = new Date(from);
    date.setDate(date.getDate() + day);
    ticks.push(date.getTime());
  }
  return { domain, ticks };
}

function toDate(time: number): string {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
