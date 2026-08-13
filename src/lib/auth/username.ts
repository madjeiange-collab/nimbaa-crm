/**
 * Username-based auth on top of Supabase.
 *
 * Supabase Auth identifies accounts by email. We never ask reps for an email —
 * the admin assigns a username. We map that username to a synthetic, internal
 * email (`<username>@<domain>`) that Supabase stores and the rep never sees.
 */
const DOMAIN = process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN ?? 'crm.local';

/** Normalise a username: trimmed, lowercased, no spaces. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '');
}

/** Map a username to the synthetic email used by Supabase Auth. */
export function usernameToEmail(username: string): string {
  return `${normalizeUsername(username)}@${DOMAIN}`;
}

/** Recover the username from a synthetic email (for display). */
export function emailToUsername(email: string): string {
  return email.split('@')[0] ?? email;
}

/** A username is valid if it is 3–32 chars of [a-z0-9._-]. */
export function isValidUsername(username: string): boolean {
  return /^[a-z0-9._-]{3,32}$/.test(normalizeUsername(username));
}
