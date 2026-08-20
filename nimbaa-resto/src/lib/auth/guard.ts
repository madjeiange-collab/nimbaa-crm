import { redirect } from 'next/navigation';
import { getStaffContext, type StaffContext } from '@/lib/auth/staff';

/**
 * Every authenticated page starts with this.
 *
 * Three redirects, in order:
 *  - no context  -> the login page (not signed in, unknown slug, or not a member
 *                   here; all three are the same answer to the visitor)
 *  - must change -> the password page, before anything else is reachable. A
 *                   password the patron read out loud must not survive the shift
 *  - otherwise   -> the caller gets the context
 */
export async function requireStaff(
  slug: string,
  opts: { allowPasswordChange?: boolean } = {},
): Promise<StaffContext> {
  const ctx = await getStaffContext(slug);
  if (!ctx) redirect(`/r/${slug}/login`);
  if (ctx.mustChangePassword && !opts.allowPasswordChange) {
    redirect(`/r/${slug}/mot-de-passe`);
  }
  return ctx;
}
