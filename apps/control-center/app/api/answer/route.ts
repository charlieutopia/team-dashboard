import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Persists a grill answer to public.cc_answers using the LOGGED-IN user's
// Supabase session (RLS restricts insert/select to the allowed emails). No
// service-role key, no GitHub token — nothing sensitive in this function.
// Turning answers into structured wiki pages stays a separate, human-approved
// step (Charlie reviews captured answers, then they are distilled).
export async function POST(req: Request) {
  let body: { id?: string; question?: string; answer?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.answer || !body.answer.trim()) {
    return NextResponse.json({ error: 'empty answer' }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  }

  const { error } = await supabase.from('cc_answers').insert({
    question_id: body.id ?? null,
    question: body.question ?? null,
    answer: body.answer.trim(),
    user_email: user.email ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, persisted: true });
}
