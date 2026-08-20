import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/lib/tenancy/roles';

/**
 * Supabase Auth requires an email address. Staff sign in with a username, so we
 * store a synthetic address they never see, scoped per restaurant so that
 * `fatou` is free at every restaurant on the platform.
 *
 *   fatou + le-bambou  ->  fatou@le-bambou.staff.nimbaa.app
 */
export function staffEmail(username: string, slug: string) {
  const domain = process.env.STAFF_EMAIL_DOMAIN ?? 'staff.nimbaa.app';
  return `${username.trim().toLowerCase()}@${slug.trim().toLowerCase()}.${domain}`;
}

export type StaffContext = {
  userId: string;
  restaurant: { id: string; slug: string; name: string; currency: string; currencyDecimals: number };
  roles: Role[];
  username: string;
  displayName: string | null;
  mustChangePassword: boolean;
};

/**
 * Who is signed in, at which restaurant, with which roles — or null.
 *
 * Null covers three cases on purpose and does not distinguish them: nobody is
 * signed in, the slug does not exist, or the signed-in user is not a member
 * here. The restaurant read is itself the membership check, because RLS on
 * `restaurants` is `is_member(id)`; a waiter at Le Bambou browsing to
 * /r/le-palmier gets no row rather than an error.
 *
 * `cache` dedupes this across a layout and the page it renders.
 */
export const getStaffContext = cache(async (slug: string): Promise<StaffContext | null> => {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('id, slug, name, currency, currency_decimals')
    .eq('slug', slug)
    .maybeSingle();
  if (!restaurant) return null;

  const [{ data: members }, { data: account }] = await Promise.all([
    supabase
      .from('restaurant_members')
      .select('role')
      .eq('restaurant_id', restaurant.id)
      .eq('user_id', user.id)
      .eq('active', true),
    supabase
      .from('staff_accounts')
      .select('username, display_name, must_change_password')
      .eq('user_id', user.id)
      .maybeSingle(),
  ]);

  const roles = (members ?? []).map((m: { role: Role }) => m.role);
  if (roles.length === 0) return null;

  return {
    userId: user.id,
    restaurant: {
      id: restaurant.id,
      slug: restaurant.slug,
      name: restaurant.name,
      currency: restaurant.currency,
      currencyDecimals: restaurant.currency_decimals,
    },
    roles,
    username: account?.username ?? '',
    displayName: account?.display_name ?? null,
    mustChangePassword: account?.must_change_password ?? false,
  };
});
