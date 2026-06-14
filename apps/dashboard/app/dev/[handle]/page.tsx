import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getDevTimeline, getDevWeeklyDigest, getDevMonthlyDigest } from '@/lib/queries';
import { TrajectoryHeatmap, type HeatmapDay } from '@/components/TrajectoryHeatmap';
import { DayTimelineCard } from '@/components/DayTimelineCard';
import { WeeklyDigestCard } from '@/components/WeeklyDigestCard';
import { MonthlyDigestCard } from '@/components/MonthlyDigestCard';
import { KpiStrip } from '@/components/KpiStrip';
import { LevelChip } from '@/components/LevelChip';

export const dynamic = 'force-dynamic';

export default async function DevTimelinePage({ params }: { params: { handle: string } }) {
  const supabase = createSupabaseServerClient();
  const [result, weekly, monthly] = await Promise.all([
    getDevTimeline(supabase, params.handle, 30),
    getDevWeeklyDigest(supabase, params.handle),
    getDevMonthlyDigest(supabase, params.handle),
  ]);

  if (!result) notFound();

  const {
    developer,
    days,
    totals,
    windowDays,
    effectiveWindowDays,
    isWindowClamped,
    klToday,
    earliestDailyReport,
  } = result;

  const onTrackPct = totals.total_days_with_data > 0
    ? Math.round((totals.on_track_days / totals.total_days_with_data) * 100)
    : 0;

  const heatmapDays: HeatmapDay[] = days.map(d => ({
    date: d.report_date,
    trajectory: d.trajectory,
    parse_failed: d.parse_failed,
    hasData: d.parse_failed || d.summary !== null || d.metrics !== null || d.trajectory !== null,
    onLeave: d.on_leave,
    leaveType: d.leave_type,
    isHalfDayLeave: d.is_half_day_leave,
    isPublicHoliday: d.is_public_holiday,
    holidayName: d.holiday_name,
    isWeekend: d.is_weekend,
  }));

  const daysWithDataOnly = days.filter(
    d => d.parse_failed || d.summary !== null || d.metrics !== null || d.trajectory !== null
  );

  return (
    <main className="min-h-screen pb-8">
      <header className="px-4 pt-6 pb-4 sticky top-0 bg-app/85 backdrop-blur z-10 border-b border-line">
        <Link
          href="/"
          className="text-xs text-blue-600 hover:text-blue-700 inline-block mb-2"
        >
          ← back to all
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">@{developer.github_handle}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm text-ink-muted">{developer.display_name}</p>
          <LevelChip level={developer.level} />
        </div>
        {developer.tenure_note && (
          <p className="text-[11px] text-ink-faint mt-0.5">{developer.tenure_note}</p>
        )}
        {developer.owned_systems.length > 0 && (
          <p className="text-[11px] text-ink-faint mt-0.5">
            Owns: {developer.owned_systems.join(', ')}
          </p>
        )}
        <p className="text-[11px] text-ink-faint mt-1">
          {isWindowClamped
            ? `${effectiveWindowDays}-day window · since ${earliestDailyReport}`
            : `${windowDays}-day window · ending ${klToday}`}
        </p>
      </header>

      <section className="border-b border-line">
        <p className="px-4 pt-3 pb-1 text-xs text-ink-faint uppercase tracking-wide">This Month</p>
        {monthly ? (
          <MonthlyDigestCard digest={monthly} />
        ) : (
          <p className="px-4 pb-3 text-sm text-ink-faint">
            No monthly summary yet — the first one lands at the start of next month.
          </p>
        )}
      </section>

      <section className="border-b border-line">
        <p className="px-4 pt-3 pb-1 text-xs text-ink-faint uppercase tracking-wide">
          This Week{weekly ? ` · ${weekly.week_start_date}` : ''}
        </p>
        {weekly ? (
          <WeeklyDigestCard digest={weekly} showLink={false} />
        ) : (
          <p className="px-4 pb-3 text-sm text-ink-faint">
            No weekly digest yet — the first one lands next Monday.
          </p>
        )}
      </section>

      <KpiStrip
        totals={totals}
        windowDays={windowDays}
        effectiveWindowDays={effectiveWindowDays}
        isWindowClamped={isWindowClamped}
        earliestDailyReport={earliestDailyReport}
      />

      <section className="px-4 py-3 border-b border-line">
        <p className="text-xs text-ink-faint mb-2 uppercase tracking-wide">
          {isWindowClamped ? `${effectiveWindowDays}-day` : `${windowDays}-day`} trajectory
        </p>
        <TrajectoryHeatmap days={heatmapDays} />
      </section>

      <section className="px-4 py-3 border-b border-line">
        <p className="text-xs text-ink-faint mb-2 uppercase tracking-wide">
          {isWindowClamped ? `${effectiveWindowDays}-day` : `${windowDays}-day`} totals
        </p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <dt className="text-ink-faint">Days with data</dt>
            <dd className="font-medium text-ink">
              {totals.total_days_with_data}
              {totals.failed_days > 0 && (
                <span className="text-red-600"> · {totals.failed_days} failed</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-ink-faint">On-track</dt>
            <dd className="font-medium text-ink">
              {totals.on_track_days}{' '}
              <span className="text-ink-faint font-normal">({onTrackPct}%)</span>
            </dd>
          </div>
          <div>
            <dt className="text-ink-faint">Commits</dt>
            <dd className="font-medium text-ink">{totals.total_commits}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">Lines</dt>
            <dd className="font-medium">
              <span className="text-green-600">+{totals.total_lines_added}</span>{' '}
              <span className="text-red-600">-{totals.total_lines_removed}</span>
            </dd>
          </div>
          <div>
            <dt className="text-ink-faint">Files (unique)</dt>
            <dd className="font-medium text-ink">{totals.unique_files_touched}</dd>
          </div>
        </dl>
      </section>

      <section className="pt-3">
        <p className="px-4 pb-2 text-xs text-ink-faint uppercase tracking-wide">Daily timeline (newest first)</p>
        {daysWithDataOnly.length === 0 ? (
          <p className="px-6 py-8 text-center text-xs text-ink-faint">
            No reports in the last {windowDays} days.
          </p>
        ) : (
          daysWithDataOnly.map(day => (
            <DayTimelineCard key={day.report_date} day={day} />
          ))
        )}
      </section>
    </main>
  );
}
