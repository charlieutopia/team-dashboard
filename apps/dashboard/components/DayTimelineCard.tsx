import type { DevTimelineDay } from '@/lib/queries';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function weekdayFor(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return WEEKDAY[dt.getUTCDay()] ?? '';
}

export function DayTimelineCard({ day }: { day: DevTimelineDay }) {
  if (day.parse_failed) {
    return (
      <article className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/30 p-3 mb-2 mx-3 shadow-sm">
        <div className="flex gap-3">
          <div className="w-20 shrink-0">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{day.report_date}</p>
            <p className="text-[10px] text-gray-500">{weekdayFor(day.report_date)}</p>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-red-700 dark:text-red-300">Report failed</p>
            {day.error_msg && (
              <p className="mt-1 text-[11px] font-mono text-red-600 dark:text-red-400 break-all line-clamp-3">
                {day.error_msg}
              </p>
            )}
          </div>
        </div>
      </article>
    );
  }

  const m = day.metrics ?? {};
  const sp = day.spec_progress ?? { advancing: [], drifting: [] };
  const filesCount = Array.isArray(m.files_touched_today) ? m.files_touched_today.length : 0;
  const advCount = Array.isArray(sp.advancing) ? sp.advancing.length : 0;
  const drfCount = Array.isArray(sp.drifting) ? sp.drifting.length : 0;

  return (
    <article className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 mb-2 mx-3 shadow-sm">
      <div className="flex gap-3">
        <div className="w-20 shrink-0">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-200">{day.report_date}</p>
          <p className="text-[10px] text-gray-500">{weekdayFor(day.report_date)}</p>
        </div>
        <div className="flex-1 min-w-0">
          {day.summary ? (
            <p className="text-xs leading-relaxed text-gray-700 dark:text-gray-200 line-clamp-3">
              {day.summary}
            </p>
          ) : (
            <p className="text-xs text-gray-400 italic">No summary</p>
          )}
          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 text-[11px] text-gray-600 dark:text-gray-300 flex flex-wrap gap-x-3 gap-y-1">
            <span>commits {m.commits_today ?? 0}</span>
            <span>
              <span className="text-green-600">+{m.lines_added_today ?? 0}</span>{' '}
              <span className="text-red-600">-{m.lines_removed_today ?? 0}</span>
            </span>
            <span>files {filesCount}</span>
            <span>
              spec {advCount}/<span className="text-amber-600">{drfCount}</span>
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
