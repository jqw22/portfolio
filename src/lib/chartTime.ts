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
