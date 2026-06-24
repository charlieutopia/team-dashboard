import { createSupabaseServerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// Mirrors apps/dashboard/app/auth/callback/route.ts. The Charlie-only check
// runs in middleware.ts on the redirect target, so a non-allowed user who
// completes an OAuth/email exchange still lands on /denied.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = createSupabaseServerClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}/`);
}
