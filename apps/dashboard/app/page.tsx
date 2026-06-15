import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getActiveBranchesByDev,
  getCadenceByDev,
  getLatestReports,
  getTodayStatus,
} from '@/lib/queries';
import { DevList } from '@/components/DevList';
import { TodayHeader } from '@/components/TodayHeader';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = createSupabaseServerClient();
  const [{ reportDate, klToday, rows }, today, branches, cadenceByDev] =
    await Promise.all([
      getLatestReports(supabase),
      getTodayStatus(supabase),
      getActiveBranchesByDev(supabase),
      getCadenceByDev(supabase),
    ]);
  // Suppress the per-card branch line pre-bootstrap (table empty) so we don't
  // mislead Charlie before the scanner has ever populated.
  const branchesByDev = branches.populated ? branches.byDev : undefined;

  const isStale = reportDate !== null && reportDate < klToday;
  const failedCount = rows.filter(r => r.parse_failed).length;

  return (
    <main className="min-h-screen pb-10">
      {/* Full-width sticky brand bar. */}
      <header className="px-5 pt-5 pb-3 sticky top-0 bg-app/85 backdrop-blur z-10 border-b border-line">
        <div className="mx-auto max-w-6xl flex items-center justify-between gap-3">
          <span className="text-[15px] font-bold tracking-tight text-ink">
            Team Dashboard
          </span>
          <nav className="flex items-center gap-4 text-[13px] whitespace-nowrap">
            <Link href="/admin/team" className="text-blue-600 hover:text-blue-700">
              Manage team
            </Link>
            <Link href="/week" className="text-blue-600 hover:text-blue-700">
              This week →
            </Link>
          </nav>
        </div>
      </header>

      {/* Full-width banner; its inner content is centered to the container. */}
      <TodayHeader today={today} />

      {/* Centered container holds the status notice, search, and card grid. */}
      <div className="mx-auto max-w-6xl">
        {rows.length > 0 && (isStale || failedCount > 0) && (
          <p className="px-5 pt-3 text-[13px] text-ink-faint">
            {isStale && (
              <span className="text-amber-600">
                Showing {reportDate} — today&apos;s update hasn&apos;t run yet.
              </span>
            )}
            {isStale && failedCount > 0 && ' · '}
            {failedCount > 0 && (
              <span className="text-red-600">
                {failedCount} update{failedCount === 1 ? '' : 's'} failed to generate
              </span>
            )}
          </p>
        )}

        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-ink-faint">
            <p className="mb-2">No activity yet.</p>
            <p>Run <code className="font-mono">pnpm scanner:daily</code> locally to generate today&apos;s update.</p>
          </div>
        ) : (
          <DevList
            rows={rows}
            todayStatusByDev={today.perDev}
            branchesByDev={branchesByDev}
            cadenceByDev={cadenceByDev}
          />
        )}
      </div>
    </main>
  );
}
