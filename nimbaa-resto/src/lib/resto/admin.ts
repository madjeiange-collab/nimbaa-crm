import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth/guard';
import type { StaffContext } from '@/lib/auth/staff';

/**
 * Guard for a back-office PAGE. A waiter who follows a bookmark to
 * /admin/carte is not attacking anything — send them back to their own home
 * rather than to a stack trace.
 *
 * Throwing here would surface Next's "Application error: a server-side
 * exception has occurred", which is what happens when an unauthorised page
 * read is treated as a crash instead of an answer.
 */
export async function requireManagerPage(slug: string): Promise<StaffContext> {
  const ctx = await requireStaff(slug);
  if (ctx.role !== 'owner' && ctx.role !== 'manager') redirect(`/r/${slug}`);
  return ctx;
}

/**
 * Guard for a back-office ACTION, where throwing is right: the caller wraps it
 * and shows the message beside the form.
 *
 * The database refuses a waiter's write on its own — but RLS refuses in two
 * different ways: an UPDATE quietly affects nothing, an INSERT raises. Checking
 * the role here means one predictable message either way, instead of an action
 * that appears to succeed and changes nothing.
 */
export async function requireManager(slug: string): Promise<StaffContext> {
  const ctx = await requireStaff(slug);
  if (ctx.role !== 'owner' && ctx.role !== 'manager') {
    throw new Error('Réservé au patron et au gérant.');
  }
  return ctx;
}

export type Item = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  available: boolean;
  category_id: string | null;
  prep_station_id: string | null;
  photo_path: string | null;
};

export async function loadMenu(restaurantId: string) {
  const supabase = createClient();
  const [{ data: categories }, { data: items }, { data: stations }] = await Promise.all([
    supabase.schema('resto').from('menu_categories')
      .select('id, name, sort, active').eq('restaurant_id', restaurantId).order('sort'),
    supabase.schema('resto').from('menu_items')
      .select('id, name, description, price, available, category_id, prep_station_id, photo_path')
      .eq('restaurant_id', restaurantId).order('sort'),
    supabase.schema('resto').from('prep_stations')
      .select('id, name').eq('restaurant_id', restaurantId).order('sort'),
  ]);
  return {
    categories: categories ?? [],
    items: (items ?? []) as Item[],
    stations: stations ?? [],
  };
}

export async function loadFloor(restaurantId: string) {
  const supabase = createClient();
  const [{ data: areas }, { data: tables }] = await Promise.all([
    supabase.schema('resto').from('areas')
      .select('id, name, sort').eq('restaurant_id', restaurantId).order('sort'),
    supabase.schema('resto').from('tables')
      .select('id, label, seats, area_id, status').eq('restaurant_id', restaurantId).order('sort'),
  ]);
  return { areas: areas ?? [], tables: tables ?? [] };
}
