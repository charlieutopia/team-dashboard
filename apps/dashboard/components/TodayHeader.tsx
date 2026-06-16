import { isoWeek, type TodayStatusResult } from '@/lib/queries';

/**
 * Big editorial date for the briefing banner, e.g. "Sunday, June 14".
 * Built from the KL date string in UTC so it never drifts by a day.
 */
function formatBannerDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  });
  const month = dt.toLocaleDateString('en-US', {
    month: 'long',
    timeZone: 'UTC',
  });
  return `${weekday}, ${month} ${d}, ${y}`;
}

/** Short weekday name (e.g. "Saturday") for the "Everyone off" line. */
function weekdayName(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

export function TodayHeader({ today }: { today: TodayStatusResult }) {
  const { klToday, isWeekend, isPublicHoliday, holidayName, counts, offTodayList } = today;

  // The one-line summary. Zero segments are dropped; weekend / holiday collapse
  // to a single "Everyone off" line.
  let summary: string;
  if (counts.totalActive === 0) {
    summary = 'No one on the team yet';
  } else if (isWeekend) {
    summary = `Everyone off — ${weekdayName(klToday)}`;
  } else if (isPublicHoliday) {
    summary = `Everyone off — ${holidayName ?? 'public holiday'}`;
  } else {
    const parts: string[] = [];
    if (counts.working > 0) parts.push(`${counts.working} working`);
    if (counts.onLeave > 0) parts.push(`${counts.onLeave} on leave`);
    if (counts.halfDay > 0) parts.push(`${counts.halfDay} half day`);
    summary = parts.join(' · ');
  }

  const showOffList = !isWeekend && !isPublicHoliday && offTodayList.length > 0;
  const everyoneOff = isWeekend || isPublicHoliday;
  const week = isoWeek(klToday);

  return (
    <section
      className={`border-b border-line ${
        everyoneOff ? 'border-l-4 border-l-amber-400' : ''
      }`}
    >
      <div className="mx-auto max-w-6xl px-5 pt-7 pb-6">
        {/* Tiny eyebrow so it reads unmistakably as today's view. */}
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">
          Today
        </p>

        <div className="mt-1.5 flex items-baseline gap-3 flex-wrap">
          {/* The ONE place Fraunces (serif) is used — the big banner date. */}
          <h1 className="font-display text-[2rem] sm:text-[2.5rem] leading-[1.1] font-semibold tracking-tight text-ink">
            {formatBannerDate(klToday)}
          </h1>
          <span className="inline-flex items-center rounded-full border border-line bg-card px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-ink-muted">
            Week {week}
          </span>
        </div>

        <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{summary}</p>

        {showOffList && (
          <div className="mt-4">
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-ink-faint">
              Off today
            </p>
            <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-muted">
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
      </div>
    </section>
  );
}
