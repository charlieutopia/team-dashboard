import type { MonthlyDigestRow } from '@/lib/queries';

const MOMENTUM_BADGE: Record<string, { label: string; cls: string }> = {
  accelerating: { label: 'Accelerating', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  steady: { label: 'Steady', cls: 'bg-green-100 text-green-800 border-green-200' },
  slowing: { label: 'Slowing', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  stalled: { label: 'Stalled', cls: 'bg-red-100 text-red-800 border-red-200' },
  no_activity: { label: 'No activity', cls: 'bg-gray-100 text-gray-700 border-gray-200' },
};

function monthLabel(monthStart: string): string {
  // 2026-04-01 → "April 2026"
  const [y, m] = monthStart.split('-').map(Number) as [number, number];
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${names[m - 1]} ${y}`;
}

export function MonthlyDigestCard({ digest }: { digest: MonthlyDigestRow }) {
  if (digest.parse_failed) {
    return (
      <article className="px-4 py-4 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-medium text-sm">{monthLabel(digest.month_start_date)}</h3>
          <span className="text-[10px] uppercase tracking-wide bg-red-100 text-red-800 border border-red-200 rounded px-1.5 py-0.5">
            Monthly report failed
          </span>
        </div>
        <p className="text-xs text-red-700 truncate">{digest.error_msg ?? 'unknown error'}</p>
      </article>
    );
  }

  const badge =
    MOMENTUM_BADGE[digest.momentum ?? 'no_activity'] ?? MOMENTUM_BADGE.no_activity!;

  return (
    <article className="px-4 py-4 border-b border-gray-100 dark:border-gray-800">
      <div className="flex items-center justify-between mb-2 gap-2">
        <h3 className="font-medium text-sm">{monthLabel(digest.month_start_date)}</h3>
        <span
          className={`text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 ${badge.cls}`}
        >
          {badge.label}
        </span>
      </div>
      {digest.summary && (
        <p className="text-sm leading-snug text-gray-800 dark:text-gray-200">
          {digest.summary}
        </p>
      )}
      {digest.top_themes && digest.top_themes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {digest.top_themes.map((t, i) => (
            <span
              key={i}
              className="text-[11px] bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full px-2 py-0.5"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
