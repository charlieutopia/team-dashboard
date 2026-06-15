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
  level: 'intern' | 'junior' | 'senior' | 'freelancer' | null;
  tenure_note: string | null;
  is_reviewer: boolean;
  owned_systems: string[];
  end_date: string | null;
}

export default async function AdminTeamPage() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('developers')
    .select('id, github_handle, display_name, email, active, level, tenure_note, is_reviewer, owned_systems, end_date')
    .order('active', { ascending: false })
    .order('display_name', { ascending: true });

  if (error) {
    return (
      <main className="min-h-screen p-6">
        <h1 className="text-xl font-semibold mb-2 text-ink">Team management</h1>
        <p className="text-sm text-red-600">Failed to load: {error.message}</p>
      </main>
    );
  }

  const devs = (data ?? []) as DeveloperRow[];
  const activeCount = devs.filter(d => d.active).length;
  const inactiveCount = devs.length - activeCount;

  return (
    <main className="min-h-screen pb-8">
      <header className="px-4 pt-6 pb-4 sticky top-0 bg-app/85 backdrop-blur z-10 border-b border-line">
        <Link
          href="/"
          className="text-xs text-blue-600 hover:text-blue-700 inline-block mb-2"
        >
          ← back to all
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Team management</h1>
        <p className="text-xs text-ink-faint mt-1">
          {activeCount} active · {inactiveCount} inactive
        </p>
        <p className="text-[11px] text-ink-faint mt-1">
          Edit short name, level, tenure note, owned systems (auto-save on blur) or toggle active / reviewer.
        </p>
      </header>

      <ul className="divide-y divide-line">
        {devs.map(dev => (
          <li key={dev.id}>
            <AdminDevRow dev={dev} />
          </li>
        ))}
      </ul>
    </main>
  );
}
