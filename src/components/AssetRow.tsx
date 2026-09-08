import { Sparkline } from './Sparkline.tsx';
import { linkProps } from '../lib/router.ts';
import { DIRECTION_GLYPH, direction, formatCompact, formatPct, formatPrice } from '../lib/format.ts';
import type { AssetRow as Row } from '../lib/types.ts';

type Props = {
  row: Row;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
};

export function AssetRow({ row, isFavorite, onToggleFavorite }: Props) {
  const slug = row.id.replace(/:/g, '-');

  return (
    <li class="row">
      <button
        class="cell cell-star star"
        type="button"
        aria-pressed={isFavorite}
        aria-label={`${isFavorite ? 'Remove' : 'Add'} ${row.name} ${isFavorite ? 'from' : 'to'} favourites`}
        onClick={() => onToggleFavorite(row.id)}
      >
        {isFavorite ? '★' : '☆'}
      </button>

      <a class="row-link" {...linkProps({ name: 'asset', slug })}>
        <span class="cell cell-name">
          <span class="row-symbol">
            {row.symbol}
            {row.stale && <span class="badge-stale" title={`Last updated ${row.asOf ?? 'never'}`}>stale</span>}
          </span>
          <span class="row-name">{row.name}</span>
        </span>

        <span class="cell cell-price">{formatPrice(row.price, row.currency)}</span>
        <Change value={row.changePct24h} className="cell cell-24h" />
        <Change value={row.changePct7d} className="cell cell-7d" />
        <span class="cell cell-cap">{formatCompact(row.marketCap)}</span>
        <span class="cell cell-spark">
          <Sparkline values={row.spark} tone={direction(row.changePct30d ?? row.changePct24h)} />
        </span>
      </a>
    </li>
  );
}

function Change({ value, className }: { value: number | null; className: string }) {
  const tone = direction(value);
  return (
    // A null change is unknown, not flat: no arrow, and no direction colour.
    <span class={className} data-tone={value === null ? 'flat' : tone}>
      {value !== null && <span class="glyph" aria-hidden="true">{DIRECTION_GLYPH[tone]}</span>}
      {formatPct(value)}
    </span>
  );
}
