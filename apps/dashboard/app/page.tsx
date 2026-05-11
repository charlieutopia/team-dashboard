import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getLatestReports } from '@/lib/queries';
import { DevCard } from '@/components/DevCard';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = createSupabaseServerClient();
  const { reportDate, klToday, rows } = await getLatestReports(supabase);

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
        <h1 className="text-xl font-semibold">Team Report</h1>
        {rows.length > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            {succeededCount} succeeded {failedCount > 0 && <span className="text-red-600">· {failedCount} failed</span>}
          </p>
        )}
      </header>

      {rows.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-gray-500">
          <p className="mb-2">No reports available.</p>
          <p>Run <code className="font-mono">pnpm scanner:daily</code> locally to generate today&apos;s reports.</p>
        </div>
      ) : (
        <div>
          {rows.map(r => <DevCard key={r.developer_id} report={r} />)}
        </div>
      )}
    </main>
  );
}
