import { PROVIDERS } from '../../config/providers.ts';
import { MACRO } from '../../config/universe.ts';
import { ProviderClient } from '../lib/http.ts';
import type { IngestResult, MacroPoint, MacroSeries } from '../types.ts';

const PROVIDER = PROVIDERS.fred;
const SOURCE = 'fred' as const;

/**
 * FRED macro series, with no API key.
 *
 * The documented JSON API at api.stlouisfed.org requires a key. The CSV that
 * backs every FRED graph does not, returns the complete observation history,
 * and is a stable public URL — so that is what we read.
 *
 * Missing observations arrive as "." (FRED's own placeholder for a day with no
 * reading, such as a market holiday in a daily yield series). Those are skipped,
 * never coerced to zero: a zero in DGS10 would render as a plunge to 0%.
 */
export async function ingestFred(
  { carriedOver = 0 }: { carriedOver?: number } = {},
): Promise<IngestResult> {
  const client = new ProviderClient(SOURCE, carriedOver);

  const series: MacroSeries[] = [];
  const points: MacroPoint[] = [];
  const failures: string[] = [];

  for (const spec of MACRO) {
    try {
      const csv = await client.getText(`${PROVIDER.baseUrl}?id=${spec.seriesId}`);
      const parsed = parseFredCsv(csv, spec.seriesId);
      if (parsed.length === 0) throw new Error('no usable observations');

      series.push({ ...spec, source: SOURCE });
      points.push(...parsed);
    } catch (err) {
      // One series failing leaves the other five current.
      failures.push(`${spec.seriesId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (series.length === 0) throw new Error(`every FRED series failed — ${failures.join('; ')}`);
  if (failures.length > 0) console.warn(`  partial: ${failures.join('; ')}`);

  return {
    provider: SOURCE,
    quotes: [],
    daily: [],
    macroSeries: series,
    macroPoints: points,
    // fredgraph.csv returns every observation ever published for the series, so
    // this is authoritative and replaces whatever we had.
    macroPointsComplete: true,
    requestsUsed: client.requestsUsed,
  };
}

/**
 * FRED CSV is two columns: an ISO date and the value. The header names the
 * date column differently across series ("observation_date" today, "DATE"
 * historically), so the parser keys off position rather than the header text.
 */
export function parseFredCsv(csv: string, seriesId: string): MacroPoint[] {
  const points: MacroPoint[] = [];

  for (const line of csv.split('\n')) {
    const row = line.trim();
    if (!row) continue;

    const [date, raw] = row.split(',');
    if (!date || raw === undefined) continue;
    // Skip the header without hardcoding its name.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const cell = raw.trim();
    // Two forms of "no observation", and both must be skipped rather than
    // written as zero. "." is FRED's classic placeholder; an EMPTY cell is what
    // it emits when a release never happened at all — the October 2025 US
    // government shutdown left UNRATE and CPIAUCSL empty for that month.
    //
    // The empty case is the dangerous one: Number('') is 0, not NaN, so a naive
    // isFinite check accepts it and the chart shows unemployment falling to zero.
    if (cell === '' || cell === '.') continue;

    const value = Number(cell);
    if (!Number.isFinite(value)) continue;

    points.push({ seriesId, date, value });
  }

  return points;
}
