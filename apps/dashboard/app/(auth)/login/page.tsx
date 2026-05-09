'use client';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function LoginPage() {
  async function handleLogin() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-2">Team Dashboard</h1>
        <p className="text-sm text-gray-500 mb-6">Boss-only daily team activity report</p>
        <button
          onClick={handleLogin}
          className="px-5 py-3 bg-gray-900 text-white rounded-lg font-medium active:scale-95 transition"
        >
          Sign in with GitHub
        </button>
      </div>
    </main>
  );
}
