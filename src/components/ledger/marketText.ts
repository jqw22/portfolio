import { formatFetchedOn, type ResolvedPrice } from '@/lib/prices';

/** Text colour for a gain (green), loss (red) or no change. */
export function pnlClass(value: number): string {
  if (value === 0) return 'text-muted-foreground';
  return value > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
}

/** Why a holding has no day change, shown on hover so a gap can be tracked down. */
export function missingDayChangeReason(price: ResolvedPrice | null | undefined): string {
  if (!price) return 'No price yet. Press Refresh, or check the symbol in Prices.';
  if (price.source === 'manual') return 'Prices entered by hand have no day change. Use Fetch price in Prices to switch back to fetched prices.';
  return `The price source sent no previous close with this price (fetched ${formatFetchedOn(price.updatedAt) || 'at an unknown time'}). Press Refresh to fetch it again, and if it stays like this, redeploy the price relay with the latest price-relay.js.`;
}
