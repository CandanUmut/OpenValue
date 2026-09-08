import { useMemo, useState } from 'preact/hooks';
import { AssetRow } from '../components/AssetRow.tsx';
import { MarketStrip } from '../components/MarketStrip.tsx';
import { Sparkline } from '../components/Sparkline.tsx';
import { DIRECTION_GLYPH, direction, formatDate, formatPct, timeAgo } from '../lib/format.ts';
import { DEFAULT_SORT, nextSort, sortRows, type Sort, type SortKey } from '../lib/sort.ts';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../lib/types.ts';
import type { Category, Snapshot } from '../lib/types.ts';

type Props = {
  snapshot: Snapshot;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
};

type Tab = 'favorites' | 'all' | Category | 'macro';

/** Which provider a category waits on, for the not-yet-ingested notice. */
const PROVIDER_FOR: Record<string, string> = {
  fx: 'Frankfurter', metal: 'gold-api', crypto: 'CoinGecko', equity: 'Nasdaq',
};

export function Overview({ snapshot, favorites, onToggleFavorite }: Props) {
  const priced = useMemo(
    () => snapshot.assets.filter((a) => a.price !== null && !a.retired),
    [snapshot],
  );

  // Landing on the watchlist when there is one is the whole point of having one.
  const [tab, setTab] = useState<Tab>(favorites.length > 0 ? 'favorites' : 'all');
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const base =
      tab === 'favorites' ? priced.filter((a) => favorites.includes(a.id))
      : tab === 'all' || tab === 'macro' ? priced
      : priced.filter((a) => a.category === tab);

    const needle = filter.trim().toLowerCase();
    const matched = needle
      ? base.filter((a) =>
        a.symbol.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle))
      : base;

    return sortRows(matched, sort, favorites);
  }, [priced, tab, sort, filter, favorites]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: priced.length, favorites: favorites.length };
    for (const c of CATEGORY_ORDER) map[c] = priced.filter((a) => a.category === c).length;
    map.macro = snapshot.macro.series.length;
    return map;
  }, [priced, favorites, snapshot]);

  const tabs: { key: Tab; label: string }[] = [
    ...(favorites.length > 0 ? [{ key: 'favorites' as Tab, label: '★ Watchlist' }] : []),
    { key: 'all', label: 'All' },
    ...CATEGORY_ORDER.map((c) => ({ key: c as Tab, label: CATEGORY_LABELS[c] })),
    { key: 'macro', label: 'Macro' },
  ];

  return (
    <>
      <MarketStrip snapshot={snapshot} />

      <div class="toolbar">
        <div class="tabs" role="tablist" aria-label="Category">
          {tabs.map(({ key, label }) => (
            <button
              key={key} type="button" role="tab" aria-selected={tab === key}
              class="chip" onClick={() => setTab(key)}
            >
              {label}
              <span class="chip-count">{counts[key] ?? 0}</span>
            </button>
          ))}
        </div>

        <input
          class="toolbar-filter" type="search" value={filter}
          placeholder="Filter…" aria-label="Filter this list"
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
        />
      </div>

      {tab === 'macro'
        ? <MacroTable snapshot={snapshot} />
        : rows.length === 0
          ? <EmptyState tab={tab} filter={filter} />
          : (
            <div class="table" role="table">
              <SortHeader sort={sort} onSort={(key) => setSort(nextSort(sort, key))} />
              <ul class="rows">
                {rows.map((row) => (
                  <AssetRow
                    key={row.id} row={row}
                    isFavorite={favorites.includes(row.id)} onToggleFavorite={onToggleFavorite}
                  />
                ))}
              </ul>
            </div>
          )}
    </>
  );
}

function SortHeader({ sort, onSort }: { sort: Sort; onSort: (key: SortKey) => void }) {
  // NOT named `key`: that is reserved by the reconciler and is consumed rather
  // than passed to the component, so every header read its sort key as
  // undefined — all six lit up as active and clicking one sorted by nothing.
  const Th = ({ label, sortKey, className }: {
    label: string; sortKey: SortKey; className: string;
  }) => {
    const active = sort.key === sortKey;
    return (
      <button
        type="button" class={`cell ${className} th`}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        onClick={() => onSort(sortKey)}
      >
        {label}
        {/* The caret marks the sorted column; aria-sort carries it for screen readers. */}
        <span class="th-caret" aria-hidden="true">{active ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    );
  };

  return (
    <div class="row row-head" role="row">
      <span class="cell cell-star" />
      <Th label="Asset" sortKey="name" className="cell-name" />
      <Th label="Price" sortKey="price" className="cell-price" />
      <Th label="24h" sortKey="change24h" className="cell-24h" />
      <Th label="7d" sortKey="change7d" className="cell-7d" />
      <Th label="Mkt cap" sortKey="marketCap" className="cell-cap" />
      <span class="cell cell-spark th-static">30d</span>
    </div>
  );
}

function EmptyState({ tab, filter }: { tab: Tab; filter: string }) {
  if (filter.trim()) {
    return <p class="section-empty">Nothing here matches “{filter.trim()}”.</p>;
  }
  if (tab === 'favorites') {
    return <p class="section-empty">Star an asset to build a watchlist. It stays on this device.</p>;
  }
  return (
    <p class="section-empty">
      Not ingested yet — the {PROVIDER_FOR[tab] ?? 'relevant'} provider is not reporting.
    </p>
  );
}

function MacroTable({ snapshot }: { snapshot: Snapshot }) {
  const series = snapshot.macro.series.filter((s) => snapshot.macro.latest[s.seriesId]?.last);
  if (series.length === 0) {
    return <p class="section-empty">Not ingested yet — the FRED provider is not reporting.</p>;
  }

  return (
    <>
      <div class="table">
        <ul class="rows">
          {series.map((s) => {
            const entry = snapshot.macro.latest[s.seriesId]!;
            const last = entry.last!;
            const points = entry.points;
            // Monthly for most of these, so the comparison is the previous
            // release, not "yesterday".
            const previous = points.length > 1 ? points[points.length - 2]![1] : null;
            const changePct = previous !== null && previous !== 0
              ? ((last[1] - previous) / Math.abs(previous)) * 100
              : null;
            const tone = direction(changePct);

            return (
              <li key={s.seriesId} class="row row-static">
                <span class="cell cell-star" />
                <span class="cell cell-name">
                  <span class="row-symbol">{s.seriesId}</span>
                  <span class="row-name">{s.name}</span>
                </span>
                <span class="cell cell-price">{formatMacro(last[1], s.unit)}</span>
                <span class="cell cell-24h" data-tone={changePct === null ? 'flat' : tone}>
                  {changePct !== null && <span class="glyph" aria-hidden="true">{DIRECTION_GLYPH[tone]}</span>}
                  {formatPct(changePct)}
                </span>
                <span class="cell cell-7d row-unit">{formatDate(last[0])}</span>
                <span class="cell cell-cap row-unit">{s.unit}</span>
                <span class="cell cell-spark">
                  <Sparkline values={points.map((p) => p[1])} tone={tone} />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <p class="section-note">
        Latest observation per series, against the previous release. Source: FRED.
      </p>
    </>
  );
}

/**
 * Macro series do not share a unit — a percent, an index and a money stock in
 * billions cannot render the same way without one reading as nonsense.
 */
function formatMacro(value: number, unit: string): string {
  if (unit === 'percent') return `${value.toFixed(2)}%`;
  if (unit.startsWith('billions')) {
    return value >= 1000 ? `$${(value / 1000).toFixed(2)}T` : `$${value.toFixed(0)}B`;
  }
  return value.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

export function DataAge({ snapshot }: { snapshot: Snapshot }) {
  return <>Snapshot {timeAgo(snapshot.generatedAt)}</>;
}
