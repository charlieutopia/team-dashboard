/*
 * Inline 7-day commit sparkline.
 *
 * Renders nothing when all-zero (no signal worth a chart). Polyline color
 * matches the cadence direction so the chart and badge read as one unit.
 */

const STROKE_BY_DIRECTION: Record<string, string> = {
  up: 'rgb(var(--trajectory-on-track))',
  down: 'rgb(var(--trajectory-behind))',
  flat: 'rgb(var(--ink-faint))',
  no_data: 'rgb(var(--ink-faint))',
};

const FILL_BY_DIRECTION: Record<string, string> = {
  up: 'rgb(var(--trajectory-on-track) / 0.15)',
  down: 'rgb(var(--trajectory-behind) / 0.15)',
  flat: 'rgb(var(--ink-faint) / 0.15)',
  no_data: 'rgb(var(--ink-faint) / 0.15)',
};

export function CadenceSparkline({
  daily,
  direction,
  width = 56,
  height = 16,
}: {
  daily: number[];
  direction: 'up' | 'flat' | 'down' | 'no_data';
  width?: number;
  height?: number;
}) {
  if (!daily || daily.length === 0) return null;
  const max = Math.max(...daily, 1);
  const min = 0;
  const range = max - min || 1;

  // Build polyline points oldest→newest, normalized to fit inside the SVG box.
  const stepX = width / Math.max(daily.length - 1, 1);
  const points = daily.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const polyline = points.join(' ');
  // Closed area path for the soft fill underneath the line.
  const area = `M0,${height} L${polyline.replace(/ /g, ' L')} L${width},${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block flex-shrink-0"
      aria-hidden
    >
      <path d={area} fill={FILL_BY_DIRECTION[direction] ?? FILL_BY_DIRECTION.flat} />
      <polyline
        points={polyline}
        fill="none"
        stroke={STROKE_BY_DIRECTION[direction] ?? STROKE_BY_DIRECTION.flat}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
