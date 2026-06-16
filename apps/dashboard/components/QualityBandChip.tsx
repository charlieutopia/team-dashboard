import type { QualityBand } from '@/lib/queries';

// Each real band maps to a label + a GENTLE colour. This is a coaching signal,
// not a grade, so even the lowest band avoids alarm-red. The Record is keyed by
// QualityBand, so TypeScript fails the build if a band ever loses its style —
// the type IS the completeness check.
const BAND_STYLE: Record<QualityBand, { label: string; cls: string }> = {
  strong: { label: 'Strong', cls: 'border-green-300 bg-green-50 text-green-700' },
  solid: { label: 'Solid', cls: 'border-blue-300 bg-blue-50 text-blue-700' },
  developing: { label: 'Developing', cls: 'border-amber-300 bg-amber-50 text-amber-700' },
  weak: { label: 'Weak', cls: 'border-rose-200 bg-rose-50 text-rose-600' },
  // No evidence this week (e.g. no code branches) — render muted, never as a score.
  skipped: { label: '—', cls: 'border-line bg-app text-ink-faint' },
};

// A null band means the dimension isn't computed yet (Stability, Code Care, and
// the AI signals land in later builds). Show it honestly, never as a fake score.
const NOT_MEASURED = { label: 'Not measured yet', cls: 'border-line bg-app text-ink-faint' };

/**
 * One quality band as a small colour-coded chip. Handles the two empty states —
 * 'skipped' (computed, no evidence) and null (dimension not built yet) — so the
 * scorecard never invents a band.
 */
export function QualityBandChip({ band }: { band: QualityBand | null }) {
  const style = band ? BAND_STYLE[band] : NOT_MEASURED;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${style.cls}`}
    >
      {style.label}
    </span>
  );
}
