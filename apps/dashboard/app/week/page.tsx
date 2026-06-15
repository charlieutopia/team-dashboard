import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getAllWeeklyDigests,
  getLatestWeekStartDate,
  isoWeek,
  shiftWeekStart,
} from '@/lib/queries';
import { WeeklyDigestCard } from '@/components/WeeklyDigestCard';

export const dynamic = 'force-dynamic';

/**
 * "Jun 9 – 15" for a Monday week_start_date (YYYY-MM-DD). The week runs
 * Monday → Sunday (start + 6 days). Built in UTC from the KL-Monday string so
 * it never drifts by a day. Drops the repeated month when start + end share it.
 */
function formatWeekRange(weekStartDate: string): string {
  const [y, m, d] = weekStartDate.split('-').map(Number) as [number, number, number];
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(start.getTime() + 6 * 86400000);

  const monthOf = (dt: Date) =>
    dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const startMonth = monthOf(start);
  const endMonth = monthOf(end);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();

  return startMonth === endMonth
    ? `${startMonth} ${startDay} – ${endDay}`
    : `${startMonth} ${startDay} – ${endMonth} ${endDay}`;
}

export default async function WeekPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  const supabase = createSupabaseServerClient();

  // ?week=YYYY-MM-DD (a KL Monday). Falls back to the latest available week.
  const weekParam = typeof searchParams.week === 'string' ? searchParams.week : undefined;
  const isValidWeek = weekParam !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(weekParam);

  const [{ weekStartDate, rows }, latestWeek] = await Promise.all([
    getAllWeeklyDigests(supabase, isValidWeek ? weekParam : undefined),
    getLatestWeekStartDate(supabase),
  ]);

  const succeeded = rows.filter(r => !r.parse_failed).length;
  const failed = rows.filter(r => r.parse_failed).length;

  // Nav anchors on the week actually being viewed. When no week resolves
  // (no digests at all), there's nothing to page through.
  const viewedWeek = weekStartDate ?? (isValidWeek ? weekParam! : null);
  const prevWeek = viewedWeek ? shiftWeekStart(viewedWeek, -1) : null;
  const nextWeek = viewedWeek ? shiftWeekStart(viewedWeek, 1) : null;
  // Disable "Next" once we're at (or past) the latest week with any digests.
  const atLatest = !viewedWeek || (latestWeek !== null && viewedWeek >= latestWeek);

  const weekNumber = viewedWeek ? isoWeek(viewedWeek) : null;
  const rangeLabel = viewedWeek ? formatWeekRange(viewedWeek) : null;

  return (
    <main className="min-h-screen pb-10">
      {/* Sticky brand bar — mirrors the home page top bar. */}
      <header className="px-5 pt-5 pb-3 sticky top-0 bg-app/85 backdrop-blur z-10 border-b border-line">
        <div className="mx-auto max-w-6xl flex items-center justify-between gap-3">
          <span className="text-[15px] font-bold tracking-tight text-ink">Team Dashboard</span>
          <nav className="flex items-center gap-4 text-[13px] whitespace-nowrap">
            <Link href="/" className="text-blue-600 hover:text-blue-700">
              ← Today
            </Link>
          </nav>
        </div>
      </header>

      {/* Briefing banner — same visual language as TodayHeader. */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-6xl px-5 pt-7 pb-6">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">
            This Week
          </p>

          <div className="mt-1.5 flex items-baseline gap-3 flex-wrap">
            {/* Fraunces (serif) display, mirroring the home banner date. */}
            <h1 className="font-display text-[2rem] sm:text-[2.5rem] leading-[1.1] font-semibold tracking-tight text-ink">
              {weekNumber !== null ? `Week ${weekNumber}` : 'This Week'}
            </h1>
            {rangeLabel && (
              <span className="inline-flex items-center rounded-full border border-line bg-card px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-ink-muted">
                {rangeLabel}
              </span>
            )}
          </div>

          {rows.length > 0 ? (
            <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
              {succeeded} summarised
              {failed > 0 && <span className="text-red-600"> · {failed} failed</span>}
            </p>
          ) : (
            <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
              {viewedWeek ? 'No weekly summaries for this week.' : 'No weekly summaries yet.'}
            </p>
          )}

          {/* Prev / Next week navigation. */}
          {viewedWeek && (
            <div className="mt-4 flex items-center gap-3 text-[13px]">
              <Link
                href={`/week?week=${prevWeek}`}
                className="inline-flex items-center rounded-full border border-line bg-card px-3 py-1 text-ink-muted hover:border-line-strong hover:text-ink"
              >
                ← Prev week
              </Link>
              {atLatest ? (
                <span className="inline-flex items-center rounded-full border border-line bg-card px-3 py-1 text-ink-faint opacity-50 cursor-not-allowed">
                  Next week →
                </span>
              ) : (
                <Link
                  href={`/week?week=${nextWeek}`}
                  className="inline-flex items-center rounded-full border border-line bg-card px-3 py-1 text-ink-muted hover:border-line-strong hover:text-ink"
                >
                  Next week →
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Centered container holds the card list, matching the home grid. */}
      <div className="mx-auto max-w-4xl">
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-ink-faint">
            {viewedWeek ? (
              <p>No weekly summaries for this week.</p>
            ) : (
              <>
                <p className="mb-2">No weekly summaries available yet.</p>
                <p>The first summary fires next Monday at 07:30 KL.</p>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-3 py-4">
            {rows.map(d => (
              <WeeklyDigestCard key={d.developer_id} digest={d} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
