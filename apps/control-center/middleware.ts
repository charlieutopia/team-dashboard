import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { CookieOptions } from '@supabase/ssr';
import { isAllowed } from '@/lib/auth';

// Same Supabase-SSR auth pattern as apps/dashboard/middleware.ts, but the gate
// is tighter: after confirming a logged-in user we ALSO require the user's
// email to match CONTROL_CENTER_ALLOWED_EMAIL (see lib/auth.ts). Team members
// who pass is_internal_user() but are not Charlie are sent to /denied.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies: Array<{ name: string; value: string; options: CookieOptions }>) => {
          cookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = path === '/login' || path === '/denied' || path.startsWith('/auth/');

  // Not signed in → login (unless on a public route).
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Signed in but NOT the allowed identity → denied (Charlie-only gate).
  // Allow them to reach /denied and /auth/* (e.g. to sign out), nothing else.
  if (user && !isAllowed(user.email) && path !== '/denied' && !path.startsWith('/auth/')) {
    const url = request.nextUrl.clone();
    url.pathname = '/denied';
    return NextResponse.redirect(url);
  }

  // Allowed user landing on /login or /denied → send home.
  if (user && isAllowed(user.email) && (path === '/login' || path === '/denied')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
