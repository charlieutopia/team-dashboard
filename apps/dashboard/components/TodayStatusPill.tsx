import type { TodayDevStatus } from '@/lib/queries';

const STATUS_STYLE: Record<
  TodayDevStatus['status'],
  { label: string; cls: string }
> = {
  working: {
    label: 'Working',
    cls: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-200 dark:border-green-800',
  },
  on_leave: {
    label: 'On leave',
    cls: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-800',
  },
  half_day_leave: {
    label: 'Half day',
    cls: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-800',
  },
  public_holiday: {
    label: 'Holiday',
    cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-800',
  },
  weekend: {
    label: 'Weekend',
    cls: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
  },
  inactive: {
    label: 'Inactive',
    cls: 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:border-gray-700 opacity-70',
  },
};

export function TodayStatusPill({ status }: { status: TodayDevStatus }) {
  const s = STATUS_STYLE[status.status];
  let detail: string | null = null;
  if (status.status === 'on_leave' && status.leaveType) {
    detail = status.leaveType;
  } else if (status.status === 'half_day_leave' && status.leaveType) {
    detail = status.halfSegment
      ? `${status.leaveType} · ${status.halfSegment}`
      : status.leaveType;
  } else if (status.status === 'public_holiday' && status.holidayName) {
    detail = status.holidayName;
  }

  return (
    <span
      className={`inline-flex items-center text-[10px] uppercase tracking-wide border rounded px-1.5 py-0.5 font-medium ${s.cls}`}
      title={detail ?? s.label}
    >
      {s.label}
      {detail && (
        <span className="ml-1 normal-case tracking-normal text-[10px] opacity-80">
          · {detail}
        </span>
      )}
    </span>
  );
}
