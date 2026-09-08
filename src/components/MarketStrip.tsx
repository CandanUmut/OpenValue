import { linkProps } from '../lib/router.ts';
import { DIRECTION_GLYPH, direction, formatPct, formatPrice } from '../lib/format.ts';
import type { AssetRow, Snapshot } from '../lib/types.ts';

/**
 * A fixed set of benchmarks, the way Google Finance leads with the indices.
 *
 * This replaces the "top movers" strip that used to sit here. Movers sorted by
 * absolute change are always the smallest, most volatile things in the universe
 * — the strip was reliably six micro-cap tokens, which tells you nothing about
 * the state of the world. Sorting the 24h column now covers gainers and losers
 * properly, so this space is better spent on a stable frame of reference.
 */
const BENCHMARKS: { id: string; label: string }[] = [
  { id: 'equity:spy', label: 'S&P 500' },
  { id: 'equity:qqq', label: 'Nasdaq 100' },
  { id: 'crypto:bitcoin', label: 'Bitcoin' },
  { id: 'metal:xau', label: 'Gold' },
  { id: 'fx:eur', label: 'Euro' },
  { id: 'equity:tlt', label: 'Treasuries' },
];

export function MarketStrip({ snapshot }: { snapshot: Snapshot }) {
  const byId = new Map(snapshot.assets.map((a) => [a.id, a]));
  const cards = BENCHMARKS
    .map((b) => ({ ...b, row: byId.get(b.id) }))
    .filter((b): b is typeof b & { row: AssetRow } => Boolean(b.row?.price));

  const yield10y = snapshot.macro.latest.DGS10?.last ?? null;

  if (cards.length === 0) return null;

  return (
    <section class="strip" aria-label="Market summary">
      <ul class="strip-scroll">
        {cards.map(({ id, label, row }) => {
          const tone = direction(row.changePct24h);
          return (
            <li key={id}>
              <a class="strip-card" {...linkProps({ name: 'asset', slug: id.replace(/:/g, '-') })}>
                <span class="strip-label">{label}</span>
                <span class="strip-value">{formatPrice(row.price, row.currency)}</span>
                <span class="strip-change" data-tone={tone}>
                  {row.changePct24h !== null && (
                    <span aria-hidden="true">{DIRECTION_GLYPH[tone]}</span>
                  )}
                  {formatPct(row.changePct24h)}
                </span>
              </a>
            </li>
          );
        })}

        {yield10y && (
          <li>
            {/* Not an asset, so not a link — but the single most-quoted number in
                macro, and the strip is the right place for it. */}
            <span class="strip-card strip-card-static">
              <span class="strip-label">US 10Y</span>
              <span class="strip-value">{yield10y[1].toFixed(2)}%</span>
              <span class="strip-change" data-tone="flat">{yield10y[0]}</span>
            </span>
          </li>
        )}
      </ul>
    </section>
  );
}
