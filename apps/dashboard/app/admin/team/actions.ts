'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type ActionResult = { ok: true } | { ok: false, error: string };

const MAX_NAME_LEN = 120;

async function authedSupabase() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase: null, userEmail: null, error: 'Not authenticated' };
  }
  return { supabase, userEmail: user.email ?? null, error: null };
}

export async function updateDisplayName(
  devId: string,
  newName: string,
): Promise<ActionResult> {
  const { supabase, error: authError } = await authedSupabase();
  if (!supabase) return { ok: false, error: authError ?? 'Auth failed' };

  const trimmed = newName.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'Name cannot be empty' };
  }
  if (trimmed.length > MAX_NAME_LEN) {
    return { ok: false, error: `Name must be ${MAX_NAME_LEN} characters or fewer` };
  }

  const { data, error } = await supabase
    .from('developers')
    .update({ display_name: trimmed })
    .eq('id', devId)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: 'Update affected 0 rows — RLS may be blocking. Check policies.',
    };
  }

  revalidatePath('/');
  revalidatePath('/admin/team');
  return { ok: true };
}

export async function setActive(
  devId: string,
  active: boolean,
): Promise<ActionResult> {
  const { supabase, userEmail, error: authError } = await authedSupabase();
  if (!supabase) return { ok: false, error: authError ?? 'Auth failed' };

  // Self-protect: is_internal_user() requires active=true on the row matching
  // auth email. If the current user toggles their OWN row inactive, they lock
  // themselves out of every page (auth still works but RLS returns 0 rows).
  if (!active && userEmail) {
    const { data: target } = await supabase
      .from('developers')
      .select('email')
      .eq('id', devId)
      .maybeSingle();
    const targetEmail = (target as { email: string | null } | null)?.email ?? null;
    if (targetEmail && targetEmail.toLowerCase() === userEmail.toLowerCase()) {
      return {
        ok: false,
        error: "You can't deactivate your own account — you'd lock yourself out.",
      };
    }
  }

  const { data, error } = await supabase
    .from('developers')
    .update({ active })
    .eq('id', devId)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: 'Update affected 0 rows — RLS may be blocking. Check policies.',
    };
  }

  revalidatePath('/');
  revalidatePath('/admin/team');
  return { ok: true };
}
