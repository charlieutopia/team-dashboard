export interface HeatmapDay {
  date: string;
  trajectory: 'on_track' | 'ahead' | 'behind' | 'stuck' | 'no_activity' | null;
  parse_failed: boolean;
  hasData: boolean;
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
const FAILED_CLASS = 'bg-red-100 dark:bg-red-950 ring-1 ring-red-400';

function classForDay(day: HeatmapDay): string {
  if (day.parse_failed) return FAILED_CLASS;
  if (!day.hasData || !day.trajectory) return EMPTY_CLASS;
  return COLOR_CLASS_MAP[day.trajectory] ?? EMPTY_CLASS;
}

export function TrajectoryHeatmap({ days }: { days: HeatmapDay[] }) {
  // Render newest on the right (GitHub contribution graph style).
  // Input `days` is newest-first; reverse for display.
  const ordered = [...days].reverse();

  return (
    <div className="flex items-center gap-[2px] flex-nowrap">
      {ordered.map(day => {
        const cls = classForDay(day);
        const label = day.parse_failed
          ? `${day.date} · failed`
          : `${day.date} · ${day.trajectory ?? 'no data'}`;
        return (
          <span
            key={day.date}
            title={label}
            aria-label={label}
            className={`inline-block w-[10px] h-[10px] rounded-sm ${cls}`}
          />
        );
      })}
    </div>
  );
}
