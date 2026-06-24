'use client';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

// Shown to a signed-in user whose email is NOT on the Charlie-only allowlist.
// They can sign out and try a different account.
export default function DeniedPage() {
  const router = useRouter();

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center space-y-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          No access
        </h1>
        <p className="text-sm text-ink-muted">
          This page is private. Your account is not on the access list for the
          Control Center.
        </p>
        <button
          onClick={signOut}
          className="px-5 py-2.5 bg-panel border border-line text-ink rounded-lg font-medium active:scale-95 transition"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
