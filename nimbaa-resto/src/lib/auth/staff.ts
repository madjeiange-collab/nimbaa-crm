import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/lib/tenancy/roles';

/**
 * Supabase Auth requires an email address. Floor staff sign in with a username,
 * so we store a synthetic address they never see, scoped per restaurant so that
 * `fatou` is free at every restaurant on the platform.
 *
 *   fatou + le-bambou  ->  fatou@le-bambou.staff.nimbaa.app
 *
 * Anyone who spans products — an owner who also uses the CRM — signs in with a
 * real address instead, and has no synthetic one. Hence `looksLikeEmail`.
 */
export function staffEmail(username: string, slug: string) {
  const domain = process.env.STAFF_EMAIL_DOMAIN ?? 'staff.nimbaa.app';
  return `${username.trim().toLowerCase()}@${slug.trim().toLowerCase()}.${domain}`;
}

export const looksLikeEmail = (v: string) => v.includes('@');

/** What the person typed, resolved to the address Supabase Auth knows. */
export function loginEmail(identifier: string, slug: string) {
  const id = identifier.trim();
  return looksLikeEmail(id) ? id.toLowerCase() : staffEmail(id, slug);
}

export type StaffContext = {
  userId: string;
  restaurant: {
    id: string;
    orgId: string;
    slug: string;
    name: string;
    /** Resolved: the restaurant's own currency, else the organisation's. */
    currency: string;
    currencyDecimals: number;
  };
  role: Role;
  username: string;
  displayName: string | null;
  mustChangePassword: boolean;
};

/**
 * Who is signed in, at which restaurant, in which role — or null.
 *
 * Null covers four cases on purpose and does not distinguish them: nobody is
 * signed in, the slug does not exist, the organisation has no live Resto
 * subscription, or this person has no access to it. All four are the same
 * answer to a visitor.
 *
 * The restaurant read is itself the entitlement check: the RLS policy on
 * resto.restaurants runs `core.has_product(org_id, 'resto')`, so a lapsed
 * subscription returns no row rather than an error.
 */
export const getStaffContext = cache(async (slug: string): Promise<StaffContext | null> => {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: restaurant } = await supabase
    .schema('resto')
    .from('restaurants')
    .select('id, org_id, slug, name, currency')
    .eq('slug', slug)
    .maybeSingle();
  if (!restaurant) return null;

  const [{ data: access }, { data: org }, { data: account }] = await Promise.all([
    supabase.schema('core').from('product_access')
      .select('role')
      .eq('org_id', restaurant.org_id).eq('user_id', user.id).eq('product', 'resto')
      .maybeSingle(),
    supabase.schema('core').from('organizations')
      .select('currency').eq('id', restaurant.org_id).maybeSingle(),
    supabase.schema('resto').from('staff_accounts')
      .select('username, display_name, must_change_password')
      .eq('user_id', user.id).maybeSingle(),
  ]);

  if (!access?.role) return null;

  // NULL on the restaurant means "use the organisation's" — a group can hold a
  // restaurant in Abidjan and another in Paris without repeating itself.
  const currency: string = restaurant.currency ?? org?.currency ?? 'XOF';
  const { data: cur } = await supabase
    .schema('core').from('currencies').select('decimals').eq('code', currency).maybeSingle();

  return {
    userId: user.id,
    restaurant: {
      id: restaurant.id,
      orgId: restaurant.org_id,
      slug: restaurant.slug,
      name: restaurant.name,
      currency,
      currencyDecimals: cur?.decimals ?? 0,
    },
    role: access.role as Role,
    username: account?.username ?? '',
    displayName: account?.display_name ?? null,
    mustChangePassword: account?.must_change_password ?? false,
  };
});
