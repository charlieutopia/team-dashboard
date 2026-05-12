import type { DevTimelineTotals } from '@/lib/queries';

function formatLeaveDays(n: number): string {
  // 0.5 / 1 / 1.5 → "0.5" / "1" / "1.5"
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

function healthBadge(stuckDays: number, shouldHaveWorked: number) {
  // Quiet windows (zero working days) shouldn't flag as health risk
  if (shouldHaveWorked === 0) {
    return { label: '—', cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  }
  const ratio = stuckDays / shouldHaveWorked;
  if (ratio <= 0.15) {
    return { label: 'Healthy', cls: 'bg-green-100 text-green-800 border-green-200' };
  }
  if (ratio <= 0.4) {
    return { label: 'Watch', cls: 'bg-amber-100 text-amber-800 border-amber-200' };
  }
  return { label: 'Needs a chat', cls: 'bg-red-100 text-red-800 border-red-200' };
}

export function KpiStrip({
  totals,
  windowDays,
}: {
  totals: DevTimelineTotals;
  windowDays: number;
}) {
  const {
    days_shipped,
    should_have_worked,
    on_leave_days,
    ship_pct,
    stuck_days,
  } = totals;

  const health = healthBadge(stuck_days, should_have_worked);

  return (
    <section className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
      <p className="text-xs text-gray-500 mb-2">Last {windowDays} days</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-xs">
        <div>
          <dt className="text-gray-500">Days shipped</dt>
          <dd className="font-semibold text-sm">
            {days_shipped}
            <span className="text-gray-400 font-normal">
              {' '}
              of {formatLeaveDays(should_have_worked)} working days
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">On leave</dt>
          <dd className="font-semibold text-sm">
            {formatLeaveDays(on_leave_days)}{' '}
            <span className="text-gray-400 font-normal">days</span>
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Pace</dt>
          <dd className="font-semibold text-sm">
            {ship_pct}%{' '}
            <span className="text-gray-400 font-normal text-[11px]">of working days</span>
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Health</dt>
          <dd>
            <span
              className={`inline-block text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 font-medium ${health.cls}`}
            >
              {health.label}
            </span>
            {stuck_days > 0 && (
              <span className="text-gray-400 text-[11px] ml-1.5">
                {stuck_days} quiet
              </span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}
