import { useMemo, useState } from 'preact/hooks';
import { formatDateTime } from '../lib/format.ts';
import { GRAMS_PER_TROY_OUNCE } from '../lib/units.ts';
import type { AssetRow, Snapshot } from '../lib/types.ts';

/**
 * Any-to-any conversion.
 *
 * Every asset is priced in USD per unit, so a conversion is one cross-rate:
 *   amount × (priceOf(from) / priceOf(to))
 * No graph search, no pair table, and no chance of two paths disagreeing.
 */

type Unit = { key: string; label: string; asset: AssetRow; perAssetUnit: number };

export function Convert({ snapshot }: { snapshot: Snapshot }) {
  const units = useMemo(() => buildUnits(snapshot), [snapshot]);
  const [amount, setAmount] = useState('1');
  // Preferred defaults, but only if this snapshot actually has them: with metals
  // not yet ingested, defaulting to XAU left the <select> showing an empty
  // option while the arithmetic silently used a different unit.
  const [fromKey, setFromKey] = useState(() => pick(units, ['fx:usd'], 0));
  const [toKey, setToKey] = useState(() => pick(units, ['metal:xau|oz', 'fx:eur'], 1));

  const from = units.find((u) => u.key === fromKey);
  const to = units.find((u) => u.key === toKey);
  if (!from || !to) return <p class="section-empty">No priced assets in this snapshot yet.</p>;

  const parsed = Number(amount.replace(/,/g, ''));
  const valid = Number.isFinite(parsed);

  // Price of one of THIS unit in USD: an ounce price divided by 31.1 gives grams.
  const usdPer = (u: Unit) => u.asset.price! / u.perAssetUnit;
  const rate = usdPer(from) / usdPer(to);
  const result = valid ? parsed * rate : null;

  return (
    <div class="convert">
      <h1 class="screen-title">Convert</h1>

      <div class="convert-field">
        <label class="convert-label" for="amount">Amount</label>
        <input
          id="amount" class="convert-amount" type="text" inputMode="decimal"
          value={amount} onInput={(e) => setAmount((e.target as HTMLInputElement).value)}
          aria-invalid={!valid}
        />
        <select
          class="convert-select" aria-label="Convert from"
          value={fromKey} onChange={(e) => setFromKey((e.target as HTMLSelectElement).value)}
        >
          {units.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
        </select>
      </div>

      <button
        class="convert-swap" type="button" aria-label="Swap currencies"
        onClick={() => { setFromKey(toKey); setToKey(fromKey); }}
      >
        ⇅
      </button>

      <div class="convert-field">
        <label class="convert-label" for="result">Equals</label>
        <output id="result" class="convert-amount convert-result">
          {result === null ? '—' : formatFlexible(result)}
        </output>
        <select
          class="convert-select" aria-label="Convert to"
          value={toKey} onChange={(e) => setToKey((e.target as HTMLSelectElement).value)}
        >
          {units.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
        </select>
      </div>

      <dl class="convert-rates">
        <div>
          <dt>1 {from.label}</dt>
          <dd>{formatRate(rate)} {to.label}</dd>
        </div>
        <div>
          <dt>1 {to.label}</dt>
          <dd>{formatRate(1 / rate)} {from.label}</dd>
        </div>
        <div>
          <dt>Rate date</dt>
          <dd>{formatDateTime(olderOf(from.asset.asOf, to.asset.asOf))}</dd>
        </div>
      </dl>

      <p class="detail-note">
        Metals are quoted per troy ounce ({GRAMS_PER_TROY_OUNCE} g), not the
        avoirdupois ounce. Delayed data, informational only.
      </p>
    </div>
  );
}

/** First preference present in the snapshot, else the unit at `fallbackIndex`. */
function pick(units: Unit[], preferred: string[], fallbackIndex: number): string {
  for (const key of preferred) if (units.some((u) => u.key === key)) return key;
  return units[fallbackIndex]?.key ?? units[0]?.key ?? '';
}

function buildUnits(snapshot: Snapshot): Unit[] {
  const units: Unit[] = [];
  for (const asset of snapshot.assets) {
    if (asset.price === null || asset.retired) continue;
    if (asset.category === 'metal') {
      // Per-gram is derived here rather than stored as a second asset row, so
      // the two can never drift apart.
      units.push({ key: `${asset.id}|oz`, label: `${asset.symbol} (troy oz)`, asset, perAssetUnit: 1 });
      units.push({
        key: `${asset.id}|g`, label: `${asset.symbol} (gram)`, asset,
        perAssetUnit: GRAMS_PER_TROY_OUNCE,
      });
    } else {
      units.push({ key: asset.id, label: asset.symbol, asset, perAssetUnit: 1 });
    }
  }
  return units;
}

/** Conversions span from 0.000001 BTC to millions of JPY; fixed decimals cannot serve both. */
function formatFlexible(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.0001 ? 6 : 8;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: digits,
  }).format(v);
}

/**
 * A rate and its inverse are read as a pair, so both get the same precision.
 * Significant digits, not decimal places: 1.15900 beside 0.862810 reads as one
 * measurement, where 1.159 beside 0.86281 reads as two sloppy ones.
 */
function formatRate(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumSignificantDigits: 6, maximumSignificantDigits: 6,
  }).format(v);
}

/** A conversion is only as fresh as its staler leg. */
function olderOf(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) < Date.parse(b) ? a : b;
}
