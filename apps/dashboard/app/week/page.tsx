import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getAllWeeklyDigests } from '@/lib/queries';
import { WeeklyDigestCard } from '@/components/WeeklyDigestCard';

export const dynamic = 'force-dynamic';

export default async function WeekPage() {
  const supabase = createSupabaseServerClient();
  const { weekStartDate, rows } = await getAllWeeklyDigests(supabase);

  const succeeded = rows.filter(r => !r.parse_failed).length;
  const failed = rows.filter(r => r.parse_failed).length;

  return (
    <main className="min-h-screen pb-8">
      <header className="px-4 pt-6 pb-4 sticky top-0 bg-gray-50/80 dark:bg-gray-900/80 backdrop-blur z-10">
        <Link href="/" className="text-xs text-blue-600 hover:text-blue-700 inline-block mb-2">
          ← back to today
        </Link>
        <h1 className="text-xl font-semibold leading-tight">This Week</h1>
        <p className="text-xs text-gray-500 mt-1">
          {weekStartDate ? (
            <>Week of <span className="font-medium">{weekStartDate}</span></>
          ) : (
            <>No weekly digests yet</>
          )}
        </p>
        {rows.length > 0 && (
          <p className="text-xs text-gray-500 mt-0.5">
            {succeeded} succeeded {failed > 0 && <span className="text-red-600">· {failed} failed</span>}
          </p>
        )}
      </header>

      {rows.length === 0 ? (
        <div className="px-6 py-12 text-center text-sm text-gray-500">
          <p className="mb-2">No weekly digests available yet.</p>
          <p>The first digest fires next Monday at 07:30 KL.</p>
        </div>
      ) : (
        <div>
          {rows.map(d => (
            <WeeklyDigestCard key={d.developer_id} digest={d} />
          ))}
        </div>
      )}
    </main>
  );
}
