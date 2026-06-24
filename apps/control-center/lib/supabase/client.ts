'use client';

import { createBrowserClient } from '@supabase/ssr';

// Mirrors apps/dashboard/lib/supabase/client.ts — same Supabase project.
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
