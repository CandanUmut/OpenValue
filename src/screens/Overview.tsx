import type { ComponentChildren } from 'preact';
import { AssetRow } from '../components/AssetRow.tsx';
import { DIRECTION_GLYPH, direction, formatPct, formatPrice, timeAgo } from '../lib/format.ts';
import { linkProps } from '../lib/router.ts';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../lib/types.ts';
import type { AssetRow as Row, Snapshot } from '../lib/types.ts';

/** Which provider a category is waiting on, for the not-yet-ingested notice. */
const PROVIDER_FOR: Record<string, string> = {
  fx: 'Frankfurter', metal: 'gold-api', crypto: 'CoinGecko', equity: 'Finnhub',
};

type Props = {
  snapshot: Snapshot;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
};

export function Overview({ snapshot, favorites, onToggleFavorite }: Props) {
  const priced = snapshot.assets.filter((a) => a.price !== null && !a.retired);
  const favoriteRows = favorites
    .map((id) => priced.find((a) => a.id === id))
    .filter((a): a is Row => Boolean(a));

  const movers = [...priced]
    .filter((a) => a.changePct24h !== null)
    .sort((a, b) => Math.abs(b.changePct24h!) - Math.abs(a.changePct24h!))
    .slice(0, 6);

  const isFavorite = (id: string) => favorites.includes(id);

  return (
    <>
      {movers.length > 0 && (
        <section class="movers" aria-labelledby="movers-heading">
          <h2 id="movers-heading" class="section-heading">Top movers</h2>
          <ul class="movers-strip">
            {movers.map((row) => {
              const tone = direction(row.changePct24h);
              return (
                <li key={row.id}>
                  <a class="mover" {...linkProps({ name: 'asset', slug: row.id.replace(/:/g, '-') })}>
                    <span class="mover-symbol">{row.symbol}</span>
                    <span class="mover-price">{formatPrice(row.price, row.currency)}</span>
                    <span class="mover-change" data-tone={tone}>
                      <span aria-hidden="true">{DIRECTION_GLYPH[tone]}</span>
                      {formatPct(row.changePct24h)}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {favoriteRows.length > 0 && (
        <Section title="Favourites" count={favoriteRows.length}>
          {favoriteRows.map((row) => (
            <AssetRow key={row.id} row={row} isFavorite onToggleFavorite={onToggleFavorite} />
          ))}
        </Section>
      )}

      {CATEGORY_ORDER.map((category) => {
        const rows = priced.filter((a) => a.category === category);
        // A category with no prices means its provider is not wired up yet.
        // Silently omitting the section would read as "this app has no metals".
        if (rows.length === 0) {
          return (
            <section key={category} class="section">
              <h2 class="section-heading">{CATEGORY_LABELS[category]}</h2>
              <p class="section-empty">
                Not ingested yet — the {PROVIDER_FOR[category]} provider is not wired up.
              </p>
            </section>
          );
        }
        return (
          <Section key={category} title={CATEGORY_LABELS[category]} count={rows.length}>
            {rows.map((row) => (
              <AssetRow
                key={row.id} row={row}
                isFavorite={isFavorite(row.id)} onToggleFavorite={onToggleFavorite}
              />
            ))}
          </Section>
        );
      })}

      <MacroSection snapshot={snapshot} />
    </>
  );
}

function Section({ title, count, children }: {
  title: string; count: number; children: ComponentChildren;
}) {
  return (
    <section class="section">
      <h2 class="section-heading">
        {title} <span class="section-count">{count}</span>
      </h2>
      <ul class="rows">{children}</ul>
    </section>
  );
}

function MacroSection({ snapshot }: { snapshot: Snapshot }) {
  const series = snapshot.macro.series.filter((s) => snapshot.macro.latest[s.seriesId]?.last);
  if (series.length === 0) {
    return (
      <section class="section">
        <h2 class="section-heading">Macro</h2>
        <p class="section-empty">
          Not ingested yet — the FRED provider is not wired up.
        </p>
      </section>
    );
  }

  return (
    <section class="section">
      <h2 class="section-heading">Macro <span class="section-count">{series.length}</span></h2>
      <ul class="rows">
        {series.map((s) => {
          const last = snapshot.macro.latest[s.seriesId]!.last!;
          return (
            <li key={s.seriesId} class="row row-static">
              <span class="row-main">
                <span class="row-id">
                  <span class="row-symbol">{s.seriesId}</span>
                  <span class="row-name">{s.name}</span>
                </span>
                <span class="row-figures">
                  <span class="row-price">{last[1].toLocaleString()}</span>
                  <span class="row-unit">{s.unit}</span>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function DataAge({ snapshot }: { snapshot: Snapshot }) {
  return <>Snapshot {timeAgo(snapshot.generatedAt)}</>;
}
