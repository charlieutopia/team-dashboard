/**
 * Charlie-only access control.
 *
 * The Control Center shows sensitive internal content (wiki gaps, job names,
 * Charlie's answers), so it is gated TIGHTER than the team-wide
 * `is_internal_user()` in apps/dashboard — to Charlie alone.
 *
 * The allowed identity is driven entirely by an env var. NEVER hardcode an
 * email here. Set CONTROL_CENTER_ALLOWED_EMAIL in .env.local (dev) or the
 * Vercel project settings (prod). Comma-separated values are supported in case
 * Charlie uses more than one login email.
 *
 * If the env var is unset, NO ONE is allowed (fail closed) — a missing config
 * must never silently open the app to the whole team.
 */

const ENV_KEY = 'CONTROL_CENTER_ALLOWED_EMAIL';

/** Normalised list of allowed emails from the env var. Empty if unset. */
export function allowedEmails(): string[] {
  const raw = process.env[ENV_KEY];
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True only when `email` is non-null and matches the allowlist.
 * Fail closed: empty allowlist (unset env) → always false.
 */
export function isAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = allowedEmails();
  if (list.length === 0) return false;
  return list.includes(email.trim().toLowerCase());
}
