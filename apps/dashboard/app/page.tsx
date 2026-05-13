import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getActiveBranchesByDev,
  getCadenceByDev,
  getLatestReports,
  getOpenPrsByDev,
  getTodayStatus,
} from '@/lib/queries';
import { DevList } from '@/components/DevList';
import { TodayHeader } from '@/components/TodayHeader';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = createSupabaseServerClient();
  const [{ reportDate, klToday, rows }, today, branches, prs, cadenceByDev] =
    await Promise.all([
      getLatestReports(supabase),
      getTodayStatus(supabase),
      getActiveBranchesByDev(supabase),
      getOpenPrsByDev(supabase),
      getCadenceByDev(supabase),
    ]);
  // Suppress per-card sections pre-bootstrap (table empty) so we don't
  // mislead Boss with empty pills before the scanner has ever populated.
  const branchesByDev = branches.populated ? branches.byDev : undefined;
  const prsByDev = prs.populated ? prs.byDev : undefined;

  const isStale = reportDate !== null && reportDate < klToday;
  const succeededCount = rows.filter(r => !r.parse_failed).length;
  const failedCount = rows.filter(r => r.parse_failed).length;

  return (
    <main className="min-h-screen pb-8">
      <header className="px-4 pt-6 pb-4 sticky top-0 bg-gray-50/80 dark:bg-gray-900/80 backdrop-blur z-10">
        <p className="text-xs text-gray-500">
          {reportDate ? (
            <>Report for · <span className="font-medium">{reportDate}</span> {isStale && <span className="text-amber-600">(today {klToday}&apos;s run not yet generated)</span>}</>
          ) : (
            <>No reports generated yet</>
          )}
        </p>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Team Report</h1>
          <div className="flex items-center gap-3 text-xs whitespace-nowrap">
            <Link
              href="/admin/team"
              className="text-blue-600 hover:text-blue-700"
            >
              Manage team
            </Link>
            <Link
              href="/week"
              className="text-blue-600 hover:text-blue-700"
            >
              This week →
            </Link>
          </div>
        </div>
        {rows.length > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            {succeededCount} succeeded {failedCount > 0 && <span className="text-red-600">· {failedCount} failed</span>}
          </p>
        )}
      </header>

      <TodayHeader today={today} />

      {rows.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-gray-500">
          <p className="mb-2">No reports available.</p>
          <p>Run <code className="font-mono">pnpm scanner:daily</code> locally to generate today&apos;s reports.</p>
        </div>
      ) : (
        <DevList
          rows={rows}
          todayStatusByDev={today.perDev}
          branchesByDev={branchesByDev}
          prsByDev={prsByDev}
          cadenceByDev={cadenceByDev}
        />
      )}
    </main>
  );
}
