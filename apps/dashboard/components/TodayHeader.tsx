import type { TodayStatusResult } from '@/lib/queries';

function formatHumanDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  });
  const month = dt.toLocaleDateString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
  return `${weekday} ${month} ${d}`;
}

export function TodayHeader({ today }: { today: TodayStatusResult }) {
  const { klToday, isWeekend, isPublicHoliday, holidayName, counts, offTodayList } = today;

  // Build the summary line based on what kind of day it is.
  let summary: string;
  if (counts.totalActive === 0) {
    summary = 'No active developers';
  } else if (isWeekend) {
    summary = `Everyone off — weekend (${counts.totalActive} on the team)`;
  } else if (isPublicHoliday) {
    summary = `Everyone off — ${holidayName} (${counts.totalActive} on the team)`;
  } else {
    const parts: string[] = [];
    parts.push(`${counts.working} working`);
    if (counts.onLeave > 0) parts.push(`${counts.onLeave} on leave`);
    if (counts.halfDay > 0) parts.push(`${counts.halfDay} half day`);
    summary = parts.join(' · ');
  }

  const showOffList =
    !isWeekend && !isPublicHoliday && offTodayList.length > 0;
  const everyoneOff = isWeekend || isPublicHoliday;

  return (
    <section
      className={`px-4 pt-4 pb-4 border-b border-line ${
        everyoneOff ? 'border-l-4 border-l-amber-400' : ''
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink tracking-tight">Today · {formatHumanDate(klToday)}</h2>
        {counts.inactive > 0 && (
          <span className="text-[10px] text-ink-faint">
            {counts.inactive} inactive
          </span>
        )}
      </div>
      <p className="text-xs text-ink-muted mt-1">{summary}</p>

      {showOffList && (
        <div className="mt-3">
          <p className="text-[11px] text-ink-faint mb-1 uppercase tracking-wide">Off today</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">
            {offTodayList.map(d => {
              const reason =
                d.status === 'half_day_leave' && d.leaveType
                  ? `${d.leaveType}${d.halfSegment ? ` (${d.halfSegment})` : ''} · half`
                  : d.status === 'on_leave' && d.leaveType
                    ? d.leaveType
                    : d.status;
              return (
                <li key={d.developer_id}>
                  <span className="font-medium text-ink">{d.display_name}</span>
                  <span className="text-ink-faint"> · {reason}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
