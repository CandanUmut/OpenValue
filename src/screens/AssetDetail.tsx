import { useEffect, useState } from 'preact/hooks';
import { Chart } from '../components/Chart.tsx';
import { RANGES, loadSeries, type Range, type Series } from '../lib/data.ts';
import {
  DIRECTION_GLYPH, direction, formatCompact, formatDate, formatDateTime, formatPct,
  formatPrice, formatSignedChange,
} from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import type { Snapshot } from '../lib/types.ts';

export function AssetDetail({ slug, snapshot, isFavorite, onToggleFavorite }: {
  slug: string;
  snapshot: Snapshot;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
}) {
  const [range, setRange] = useState<Range>('1Y');
  const [series, setSeries] = useState<Series | null>(null);
  const [loading, setLoading] = useState(true);

  const asset = snapshot.assets.find((a) => a.id.replace(/:/g, '-') === slug);

  useEffect(() => {
    if (!asset) return;
    let cancelled = false;
    setLoading(true);
    loadSeries(asset.id, range).then((s) => {
      if (!cancelled) { setSeries(s); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [asset?.id, range]);

  if (!asset) {
    return (
      <div class="detail">
        <p class="section-empty">No asset called “{slug}”.</p>
        <button class="button" type="button" onClick={() => navigate({ name: 'overview' })}>
          Back to overview
        </button>
      </div>
    );
  }

  const tone = direction(asset.changePct24h);

  return (
    <div class="detail">
      <header class="detail-head">
        <div>
          <h1 class="detail-symbol">{asset.symbol}</h1>
          <p class="detail-name">{asset.name}</p>
        </div>
        <button
          class="star star-lg" type="button" aria-pressed={isFavorite}
          aria-label={`${isFavorite ? 'Remove from' : 'Add to'} favourites`}
          onClick={() => onToggleFavorite(asset.id)}
        >
          {isFavorite ? '★' : '☆'}
        </button>
      </header>

      {asset.price === null ? (
        <p class="detail-unpriced">
          No price yet — {asset.source} has not been ingested.
        </p>
      ) : (
        <p class="detail-price">
          {formatPrice(asset.price, asset.currency)}
          <span class="detail-change" data-tone={asset.changePct24h === null ? 'flat' : tone}>
            {asset.changePct24h !== null && <span aria-hidden="true">{DIRECTION_GLYPH[tone]}</span>}
            {formatPct(asset.changePct24h)}
            <span class="detail-change-abs">{formatSignedChange(asset.changeAbs, asset.price)}</span>
          </span>
        </p>
      )}

      <div class="range-tabs" role="tablist" aria-label="Chart range">
        {RANGES.map((r) => (
          <button
            key={r} type="button" role="tab" aria-selected={r === range}
            class="range-tab" onClick={() => setRange(r)}
          >
            {r}
          </button>
        ))}
      </div>

      {loading && !series ? (
        <p class="chart-empty">Loading {range} history…</p>
      ) : (series?.total ?? 0) < 3 ? (
        // "Not enough history" is true but unhelpful on its own. These series
        // have no backfillable source, so they genuinely start the day we first
        // ingested them, and saying so beats leaving the reader wondering
        // whether something is broken.
        <p class="chart-empty">
          No chart yet. {asset.source} publishes a current price but no history,
          so this series builds one close per day from{' '}
          {formatDate(series?.firstDate ?? asset.asOf)} onward.
        </p>
      ) : (
        <Chart
          points={series?.points ?? []}
          currency={asset.currency}
          ariaLabel={`${asset.name} price over ${range}`}
        />
      )}

      <dl class="stats">
        <Stat label="24h"><Tone value={asset.changePct24h} /></Stat>
        <Stat label="7d"><Tone value={asset.changePct7d} /></Stat>
        <Stat label="30d"><Tone value={asset.changePct30d} /></Stat>
        {/* Only crypto reports these, and an em dash beats a missing row that
            makes the grid ragged from one asset to the next. */}
        <Stat label="Market cap">{formatCompact(asset.marketCap)}</Stat>
        <Stat label="24h volume">{formatCompact(asset.volume24h)}</Stat>
        <Stat label="Rank">{asset.rank !== null ? `#${asset.rank}` : '—'}</Stat>
        <Stat label={`Range (${range})`}>{formatRange(series, asset.currency)}</Stat>
        <Stat label="Unit">{asset.unit}</Stat>
        <Stat label="Rate date">{formatDateTime(asset.asOf)}</Stat>
        <Stat label="Source">{asset.source}</Stat>
        <Stat label="Series begins">{formatDate(series?.firstDate ?? null)}</Stat>
        <Stat label="Closes on record">{(series?.total ?? 0).toLocaleString()}</Stat>
      </dl>

      <p class="detail-note">
        {asset.price !== null && asset.stale
          ? 'This value is older than its expected refresh interval. '
          : ''}
        Delayed data from {asset.source}, published on a schedule rather than
        streamed. Informational only — not investment advice.
      </p>
    </div>
  );
}

function Tone({ value }: { value: number | null }) {
  const tone = direction(value);
  return (
    <span data-tone={value === null ? 'flat' : tone}>
      {value !== null && <span class="glyph" aria-hidden="true">{DIRECTION_GLYPH[tone]}</span>}
      {formatPct(value)}
    </span>
  );
}

/** Low–high across the visible window, which is what the range label promises. */
function formatRange(series: Series | null, currency: string): string {
  const values = series?.points.map((p) => p[1]) ?? [];
  if (values.length < 2) return '—';
  return `${formatPrice(Math.min(...values), currency)} – ${formatPrice(Math.max(...values), currency)}`;
}

function Stat({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div class="stat">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
