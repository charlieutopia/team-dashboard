'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

// Mirrors apps/dashboard/app/(auth)/login/page.tsx — Supabase email/password.
// The Charlie-only allowlist check happens in middleware after sign-in, so a
// wrong account signs in fine but is then redirected to /denied.
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSubmitting(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    router.push('/');
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4"
        autoComplete="on"
      >
        <div className="text-center mb-6">
          <h1 className="font-display text-2xl font-semibold mb-1 tracking-tight text-ink">
            Control Center
          </h1>
          <p className="text-sm text-ink-faint">Charlie&apos;s control center</p>
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-ink-muted mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-line bg-panel text-ink rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-ink-muted mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-line bg-panel text-ink rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {error && (
          <p className="text-sm text-state-fail" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full px-5 py-3 bg-accent text-white rounded-lg font-medium active:scale-95 transition disabled:opacity-50 disabled:active:scale-100"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
