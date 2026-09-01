import { useMemo, useState } from 'preact/hooks';
import { formatDate, formatPrice } from '../lib/format.ts';

/**
 * One line, a subtle area fill, honest axes, no chart junk.
 *
 * Hand-drawn SVG rather than a charting library: the whole component is smaller
 * than the import statement for uPlot would be, and the overview route has a
 * 100KB JS budget to stay inside.
 */

type Props = {
  points: [string, number][];
  currency: string;
  height?: number;
  /** Direction colouring is semantic — over the visible window, not the 24h change. */
  ariaLabel: string;
};

const PAD = { top: 16, right: 8, bottom: 26, left: 66 };

export function Chart({ points, currency, height = 260, ariaLabel }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720; // viewBox units; the SVG scales to its container

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((p) => p[1]);
    let min = Math.min(...values);
    let max = Math.max(...values);
    // A flat series would divide by zero and, worse, render as a line through
    // the middle of an axis claiming a range it does not have.
    if (min === max) { min -= min * 0.01 || 1; max += max * 0.01 || 1; }
    const pad = (max - min) * 0.08;
    min -= pad; max += pad;

    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (i / (points.length - 1)) * plotW;
    const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * plotH;

    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(p[1]).toFixed(2)}`).join(' ');
    const area = `${line} L${x(points.length - 1).toFixed(2)} ${PAD.top + plotH} L${x(0).toFixed(2)} ${PAD.top + plotH} Z`;

    // Four gridlines is enough to read a level off without the grid competing
    // with the data.
    const ticks = [0, 1, 2, 3].map((i) => {
      const v = min + ((max - min) * i) / 3;
      return { v, y: y(v) };
    });

    return { x, y, line, area, ticks, plotH, rising: values.at(-1)! >= values[0]! };
  }, [points, height]);

  if (!geometry) {
    return <p class="chart-empty">Not enough history yet to draw a chart.</p>;
  }

  const active = hover === null ? null : points[hover];
  const tone = geometry.rising ? 'up' : 'down';

  return (
    <figure class="chart" data-tone={tone}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={(e) => {
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const ratio = (e.clientX - box.left) / box.width;
          const i = Math.round(ratio * width - PAD.left) / (width - PAD.left - PAD.right);
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(i * (points.length - 1)))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {geometry.ticks.map((t) => (
          <g key={t.v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={t.y} y2={t.y} class="grid" />
            <text x={PAD.left - 10} y={t.y + 4} class="axis" text-anchor="end">
              {compact(t.v, currency)}
            </text>
          </g>
        ))}

        <path d={geometry.area} class="area" />
        <path d={geometry.line} class="line" />

        {active && (
          <g>
            <line
              x1={geometry.x(hover!)} x2={geometry.x(hover!)}
              y1={PAD.top} y2={PAD.top + geometry.plotH} class="crosshair"
            />
            <circle cx={geometry.x(hover!)} cy={geometry.y(active[1])} r="4" class="dot" />
          </g>
        )}

        <text x={PAD.left} y={height - 8} class="axis">{formatDate(points[0]![0])}</text>
        <text x={width - PAD.right} y={height - 8} class="axis" text-anchor="end">
          {formatDate(points.at(-1)![0])}
        </text>
      </svg>

      <figcaption class="chart-readout" aria-live="polite">
        {active
          ? <><span class="chart-readout-value">{formatPrice(active[1], currency)}</span>
              <span class="chart-readout-date">{formatDate(active[0])}</span></>
          : <span class="chart-readout-hint">
              {points.length.toLocaleString()} closes in view · hover to read a value
            </span>}
      </figcaption>
    </figure>
  );
}

/** Axis labels need to align, not to be exact — the readout carries precision. */
function compact(v: number, currency: string): string {
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 5;
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
    notation: abs >= 100_000 ? 'compact' : 'standard',
  }).format(v);
}
