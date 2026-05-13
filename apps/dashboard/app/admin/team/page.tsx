import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AdminDevRow } from '@/components/AdminDevRow';

export const dynamic = 'force-dynamic';

interface DeveloperRow {
  id: string;
  github_handle: string;
  display_name: string;
  email: string | null;
  active: boolean;
}

export default async function AdminTeamPage() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('developers')
    .select('id, github_handle, display_name, email, active')
    .order('active', { ascending: false })
    .order('display_name', { ascending: true });

  if (error) {
    return (
      <main className="min-h-screen p-6">
        <h1 className="text-xl font-semibold mb-2">Team management</h1>
        <p className="text-sm text-red-600">Failed to load: {error.message}</p>
      </main>
    );
  }

  const devs = (data ?? []) as DeveloperRow[];
  const activeCount = devs.filter(d => d.active).length;
  const inactiveCount = devs.length - activeCount;

  return (
    <main className="min-h-screen pb-8">
      <header className="px-4 pt-6 pb-4 sticky top-0 bg-gray-50/80 dark:bg-gray-900/80 backdrop-blur z-10">
        <Link
          href="/"
          className="text-xs text-blue-600 hover:text-blue-700 inline-block mb-2"
        >
          ← back to all
        </Link>
        <h1 className="text-xl font-semibold">Team management</h1>
        <p className="text-xs text-gray-500 mt-1">
          {activeCount} active · {inactiveCount} inactive
        </p>
        <p className="text-[11px] text-gray-500 mt-1">
          Edit short name (auto-saves on blur) or toggle active.
        </p>
      </header>

      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {devs.map(dev => (
          <li key={dev.id}>
            <AdminDevRow dev={dev} />
          </li>
        ))}
      </ul>
    </main>
  );
}
