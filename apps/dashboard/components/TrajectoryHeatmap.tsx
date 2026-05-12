export interface HeatmapDay {
  date: string;
  trajectory: 'on_track' | 'ahead' | 'behind' | 'stuck' | 'no_activity' | null;
  parse_failed: boolean;
  hasData: boolean;
  // Phase 2 Step 2 — context flags that explain "no data" days:
  onLeave?: boolean;
  leaveType?: string | null;
  isHalfDayLeave?: boolean;
  isPublicHoliday?: boolean;
  holidayName?: string | null;
  isWeekend?: boolean;
}

// Static class map — Tailwind JIT must see literal class strings.
const COLOR_CLASS_MAP: Record<string, string> = {
  on_track: 'bg-trajectory-on_track',
  ahead: 'bg-trajectory-ahead',
  behind: 'bg-trajectory-behind',
  stuck: 'bg-trajectory-stuck',
  no_activity: 'bg-trajectory-no_activity',
};

const EMPTY_CLASS = 'bg-gray-200 dark:bg-gray-700';
const WEEKEND_CLASS = 'bg-gray-100 dark:bg-gray-800';
const HOLIDAY_CLASS = 'bg-yellow-200 dark:bg-yellow-900/60';
const LEAVE_FULL_CLASS = 'bg-sky-300 dark:bg-sky-700';
const LEAVE_HALF_CLASS = 'bg-sky-200 dark:bg-sky-800 ring-1 ring-sky-300';
const FAILED_CLASS = 'bg-red-100 dark:bg-red-950 ring-1 ring-red-400';

function classForDay(day: HeatmapDay): string {
  // Priority order: failed > leave > holiday > trajectory > weekend > empty
  if (day.parse_failed) return FAILED_CLASS;
  if (day.onLeave) return day.isHalfDayLeave ? LEAVE_HALF_CLASS : LEAVE_FULL_CLASS;
  if (day.isPublicHoliday) return HOLIDAY_CLASS;
  if (day.hasData && day.trajectory) return COLOR_CLASS_MAP[day.trajectory] ?? EMPTY_CLASS;
  if (day.isWeekend) return WEEKEND_CLASS;
  return EMPTY_CLASS;
}

function labelForDay(day: HeatmapDay): string {
  if (day.parse_failed) return `${day.date} · daily analysis failed`;
  if (day.onLeave) {
    const half = day.isHalfDayLeave ? ' (half-day)' : '';
    return `${day.date} · on leave${half}${day.leaveType ? ` — ${day.leaveType}` : ''}`;
  }
  if (day.isPublicHoliday) {
    return `${day.date} · public holiday${day.holidayName ? ` — ${day.holidayName}` : ''}`;
  }
  if (day.hasData && day.trajectory) return `${day.date} · ${day.trajectory}`;
  if (day.isWeekend) return `${day.date} · weekend`;
  return `${day.date} · no data`;
}

export function TrajectoryHeatmap({ days }: { days: HeatmapDay[] }) {
  // Render newest on the right (GitHub contribution graph style).
  const ordered = [...days].reverse();

  return (
    <div>
      <div className="flex items-center gap-[2px] flex-nowrap">
        {ordered.map(day => (
          <span
            key={day.date}
            title={labelForDay(day)}
            aria-label={labelForDay(day)}
            className={`inline-block w-[10px] h-[10px] rounded-sm ${classForDay(day)}`}
          />
        ))}
      </div>
      <Legend />
    </div>
  );
}

function Legend() {
  const items: { cls: string; label: string }[] = [
    { cls: 'bg-trajectory-on_track', label: 'shipped' },
    { cls: 'bg-trajectory-stuck', label: 'stuck' },
    { cls: LEAVE_FULL_CLASS, label: 'on leave' },
    { cls: HOLIDAY_CLASS, label: 'public holiday' },
    { cls: WEEKEND_CLASS, label: 'weekend' },
    { cls: EMPTY_CLASS, label: 'no data' },
  ];
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-500">
      {items.map(it => (
        <span key={it.label} className="inline-flex items-center gap-1">
          <span className={`inline-block w-[8px] h-[8px] rounded-sm ${it.cls}`} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
