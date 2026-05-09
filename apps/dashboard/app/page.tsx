import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getTodayReports } from '@/lib/queries';
import { DevCard } from '@/components/DevCard';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = createSupabaseServerClient();
  const reports = await getTodayReports(supabase);

  const klDate = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().split('T')[0];

  return (
    <main className="min-h-screen pb-8">
      <header className="px-4 pt-6 pb-4 sticky top-0 bg-gray-50/80 dark:bg-gray-900/80 backdrop-blur z-10">
        <p className="text-xs text-gray-500">Today · {klDate}</p>
        <h1 className="text-xl font-semibold">Team Report</h1>
      </header>

      {reports.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-gray-500">
          <p className="mb-2">No reports yet for today.</p>
          <p>First batch runs at 00:00 KL — check back at 08:00 KL.</p>
        </div>
      ) : (
        <div>
          {reports.map(r => <DevCard key={r.developer_id} report={r} />)}
        </div>
      )}
    </main>
  );
}
