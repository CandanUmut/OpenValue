/**
 * A 30-point sparkline, inline in every row. No axes, no interaction — it exists
 * to answer "which way, and how bumpy", and anything more would compete with the
 * number beside it.
 */
export function Sparkline({ values, tone }: { values: number[]; tone: 'up' | 'down' | 'flat' }) {
  if (values.length < 2) return <span class="spark-empty" aria-hidden="true" />;

  const w = 72;
  const h = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      // 1.5px inset top and bottom so the stroke is never clipped at an extreme.
      const y = 1.5 + (1 - (v - min) / span) * (h - 3);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg class="spark" data-tone={tone} viewBox={`0 0 ${w} ${h}`} width={w} height={h}
         aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  );
}
