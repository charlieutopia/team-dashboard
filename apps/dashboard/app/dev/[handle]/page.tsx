import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getDevTimeline, getDevWeeklyDigest } from '@/lib/queries';
import { TrajectoryHeatmap, type HeatmapDay } from '@/components/TrajectoryHeatmap';
import { DayTimelineCard } from '@/components/DayTimelineCard';
import { WeeklyDigestCard } from '@/components/WeeklyDigestCard';

export const dynamic = 'force-dynamic';

export default async function DevTimelinePage({ params }: { params: { handle: string } }) {
  const supabase = createSupabaseServerClient();
  const [result, weekly] = await Promise.all([
    getDevTimeline(supabase, params.handle, 30),
    getDevWeeklyDigest(supabase, params.handle),
  ]);

  if (!result) notFound();

  const { developer, days, totals, windowDays, klToday } = result;

  const onTrackPct = totals.total_days_with_data > 0
    ? Math.round((totals.on_track_days / totals.total_days_with_data) * 100)
    : 0;

  const heatmapDays: HeatmapDay[] = days.map(d => ({
    date: d.report_date,
    trajectory: d.trajectory,
    parse_failed: d.parse_failed,
    hasData: d.parse_failed || d.summary !== null || d.metrics !== null || d.trajectory !== null,
  }));

  const daysWithDataOnly = days.filter(
    d => d.parse_failed || d.summary !== null || d.metrics !== null || d.trajectory !== null
  );

  return (
    <main className="min-h-screen pb-8">
      <header className="px-4 pt-6 pb-4 sticky top-0 bg-gray-50/80 dark:bg-gray-900/80 backdrop-blur z-10">
        <Link
          href="/"
          className="text-xs text-blue-600 hover:text-blue-700 inline-block mb-2"
        >
          ← back to all
        </Link>
        <h1 className="text-xl font-semibold leading-tight">@{developer.github_handle}</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300">{developer.display_name}</p>
        <p className="text-[11px] text-gray-500 mt-1">
          {windowDays}-day window · ending {klToday}
        </p>
      </header>

      {weekly && (
        <section className="border-b border-gray-100 dark:border-gray-800">
          <p className="px-4 pt-3 pb-1 text-xs text-gray-500">
            This Week · {weekly.week_start_date}
          </p>
          <WeeklyDigestCard digest={weekly} showLink={false} />
        </section>
      )}

      {!weekly && (
        <section className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <p className="text-xs text-gray-500">
            No weekly digest yet — first one fires next Monday.
          </p>
        </section>
      )}

      <section className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <p className="text-xs text-gray-500 mb-2">{windowDays}-day trajectory</p>
        <TrajectoryHeatmap days={heatmapDays} />
      </section>

      <section className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <p className="text-xs text-gray-500 mb-2">{windowDays}-day totals</p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <dt className="text-gray-500">Days with data</dt>
            <dd className="font-medium">
              {totals.total_days_with_data}
              {totals.failed_days > 0 && (
                <span className="text-red-600"> · {totals.failed_days} failed</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">On-track</dt>
            <dd className="font-medium">
              {totals.on_track_days}{' '}
              <span className="text-gray-400">({onTrackPct}%)</span>
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Commits</dt>
            <dd className="font-medium">{totals.total_commits}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Lines</dt>
            <dd className="font-medium">
              <span className="text-green-600">+{totals.total_lines_added}</span>{' '}
              <span className="text-red-600">-{totals.total_lines_removed}</span>
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Files (unique)</dt>
            <dd className="font-medium">{totals.unique_files_touched}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Spec adv / drift</dt>
            <dd className="font-medium">
              {totals.total_advancing} ·{' '}
              <span className="text-amber-600">{totals.total_drifting}</span>
            </dd>
          </div>
        </dl>
      </section>

      <section className="pt-3">
        <p className="px-4 pb-2 text-xs text-gray-500">Daily timeline (newest first)</p>
        {daysWithDataOnly.length === 0 ? (
          <p className="px-6 py-8 text-center text-xs text-gray-500">
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
