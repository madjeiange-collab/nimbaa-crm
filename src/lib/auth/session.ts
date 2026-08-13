import 'server-only';

import { redirect } from '@/i18n/navigation';
import { getLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/types/database';

export type AppUser = Database['public']['Tables']['users']['Row'];

/**
 * Returns the current authenticated app user (row from public.users), or null.
 * Use in Server Components / layouts to gate access and route by capability.
 */
export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single();

  return profile ?? null;
}

/**
 * Returns the current user, or redirects to /login if not authenticated.
 * Use at the top of protected Server Components.
 */
export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) {
    const locale = await getLocale();
    redirect({ href: '/login', locale });
  }
  return user!;
}

/** Like requireUser, but also enforces one of the given roles. */
export async function requireRole(
  roles: AppUser['role'][],
): Promise<AppUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    const locale = await getLocale();
    redirect({ href: '/home', locale });
  }
  return user;
}
