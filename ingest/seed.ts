/**
 * Seed the asset universe into the store. Idempotent — safe to re-run after
 * editing config/universe.ts, which is the intended way to change the universe.
 *
 *   node ingest/seed.ts
 */

import { STATIC_ASSETS, MACRO, universeSize } from '../config/universe.ts';
import { JsonStore } from './store/index.ts';
import type { Asset, MacroSeries } from './types.ts';

async function main(): Promise<void> {
  const store = new JsonStore(process.env.DATA_DIR ?? 'data');

  const existing = new Map((await store.getAssets()).map((a) => [a.id, a]));
  const seeded = new Set(STATIC_ASSETS.map((a) => a.id));

  const assets: Asset[] = STATIC_ASSETS.map((a) => ({
    ...a,
    // Re-seeding un-retires an asset that has come back into the universe.
    retiredAt: null,
  }));

  // Anything previously seeded from a static category but no longer in the
  // universe is retired, not deleted — its history stays addressable.
  for (const [id, asset] of existing) {
    if (asset.category === 'crypto' || seeded.has(id) || asset.retiredAt) continue;
    assets.push({ ...asset, retiredAt: new Date().toISOString() });
    console.log(`  retiring ${id} (no longer in config/universe.ts)`);
  }

  await store.upsertAssets(assets);

  const macro: MacroSeries[] = MACRO.map((m) => ({ ...m, source: 'fred' as const }));
  await store.upsertMacroSeries(macro);

  await store.commit();

  console.log(
    `seeded ${assets.length} static assets + ${macro.length} macro series ` +
    `(universe target: ${universeSize()} incl. dynamic crypto)`,
  );
}

void main();
