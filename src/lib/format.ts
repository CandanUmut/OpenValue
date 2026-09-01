/**
 * Number formatting.
 *
 * Finance UIs live or die on digit alignment, so every formatter here returns a
 * string that lines up under tabular-nums with its neighbours: a fixed number of
 * decimals within a category, and a sign that is always present on a change.
 */

/**
 * Prices span nine orders of magnitude in this app — JPY at 0.0062 and BTC in the
 * tens of thousands sit in the same table. Significant digits, not fixed decimals,
 * is the only rule that keeps both readable.
 */
export function formatPrice(value: number | null, currency = 'USD'): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const decimals =
    abs >= 1000 ? 2 :
    abs >= 1 ? 4 :
    abs >= 0.01 ? 5 :
    6;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Always signed. A change of exactly zero shows as 0.00%, not +0.00%. */
export function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

/**
 * An absolute change is only meaningful at the scale of the price it moved.
 * Four fixed decimals renders JPY's daily move as "−0.0000", which is worse than
 * showing nothing, so the precision is derived from the reference price.
 */
export function formatSignedChange(value: number | null, reference: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const magnitude = Math.abs(reference ?? value);
  const decimals =
    magnitude >= 1000 ? 2 :
    magnitude >= 1 ? 4 :
    magnitude >= 0.01 ? 5 :
    8;
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(decimals)}`;
}

export type Direction = 'up' | 'down' | 'flat';

export function direction(value: number | null): Direction {
  if (value === null || !Number.isFinite(value) || value === 0) return 'flat';
  return value > 0 ? 'up' : 'down';
}

/**
 * Colour is never the only signal — every change carries an arrow and a sign as
 * well, so the table reads correctly in greyscale and for colour-blind users.
 */
export const DIRECTION_GLYPH: Record<Direction, string> = {
  up: '▲',
  down: '▼',
  flat: '·',
};

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "3 minutes ago". Used for as_of, where precision past the minute is noise. */
export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return 'just now';
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60], ['hour', 3600], ['day', 86400], ['month', 2_592_000], ['year', 31_536_000],
  ];
  let chosen: [Intl.RelativeTimeFormatUnit, number] = units[0]!;
  for (const unit of units) if (abs >= unit[1]) chosen = unit;
  return RELATIVE.format(Math.round(seconds / chosen[1]), chosen[0]);
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(new Date(iso));
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}
