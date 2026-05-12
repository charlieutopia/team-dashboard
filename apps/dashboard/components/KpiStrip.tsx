import type { DevTimelineTotals } from '@/lib/queries';

function fmtDays(n: number): string {
  return Number.isInteger(n) ? `${n}` : n.toFixed(1);
}

function statusBadge(stuckDays: number, shouldHaveWorked: number) {
  // Quiet windows (no working days) shouldn't flag as a status risk
  if (shouldHaveWorked === 0) {
    return { label: 'No working days yet', cls: 'bg-gray-100 text-gray-600 border-gray-200' };
  }
  const ratio = stuckDays / shouldHaveWorked;
  if (ratio <= 0.15) {
    return { label: 'Healthy', cls: 'bg-green-100 text-green-800 border-green-200' };
  }
  if (ratio <= 0.4) {
    return { label: 'Worth checking', cls: 'bg-amber-100 text-amber-800 border-amber-200' };
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

  const status = statusBadge(stuck_days, should_have_worked);

  return (
    <section className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
      <p className="text-xs text-gray-500 mb-2">Last {windowDays} days</p>

      <div className="flex items-baseline justify-between mb-2">
        <div>
          <span className="text-lg font-semibold">
            Worked {days_shipped} of {fmtDays(should_have_worked)} days
          </span>
          {should_have_worked > 0 && (
            <span className="text-sm text-gray-500 ml-2">({ship_pct}%)</span>
          )}
          <p className="text-[11px] text-gray-500 mt-0.5">
            weekdays after leave and holidays
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <div>
          <span className="text-gray-500">Days off:</span>{' '}
          <span className="font-medium">{fmtDays(on_leave_days)}</span>
        </div>
        <div>
          <span
            className={`inline-block text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 font-medium ${status.cls}`}
          >
            {status.label}
          </span>
          {stuck_days > 0 && (
            <span className="text-gray-400 text-[11px] ml-1.5">
              {stuck_days} quiet
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
