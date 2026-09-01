import { Sparkline } from './Sparkline.tsx';
import { linkProps } from '../lib/router.ts';
import { DIRECTION_GLYPH, direction, formatPct, formatPrice } from '../lib/format.ts';
import type { AssetRow as Row } from '../lib/types.ts';

type Props = {
  row: Row;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
};

export function AssetRow({ row, isFavorite, onToggleFavorite }: Props) {
  const tone = direction(row.changePct24h);
  const slug = row.id.replace(/:/g, '-');

  return (
    <li class="row">
      <button
        class="star"
        type="button"
        aria-pressed={isFavorite}
        aria-label={`${isFavorite ? 'Remove' : 'Add'} ${row.name} ${isFavorite ? 'from' : 'to'} favourites`}
        onClick={() => onToggleFavorite(row.id)}
      >
        {isFavorite ? '★' : '☆'}
      </button>

      <a class="row-main" {...linkProps({ name: 'asset', slug })}>
        <span class="row-id">
          <span class="row-symbol">{row.symbol}</span>
          <span class="row-name">{row.name}</span>
        </span>

        <Sparkline values={row.spark} tone={tone} />

        <span class="row-figures">
          <span class="row-price">{formatPrice(row.price, row.currency)}</span>
          <span class="row-change" data-tone={tone}>
            <span aria-hidden="true">{DIRECTION_GLYPH[tone]}</span>
            {formatPct(row.changePct24h)}
          </span>
        </span>

        {row.stale && (
          <span class="badge-stale" title={`Last updated ${row.asOf ?? 'never'}`}>stale</span>
        )}
      </a>
    </li>
  );
}
