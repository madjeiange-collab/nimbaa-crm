'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireManager } from '@/lib/resto/admin';
import { staffEmail } from '@/lib/auth/staff';
import { parseMoney } from '@/lib/ui/money';
import { grantableRoles, type Role } from '@/lib/tenancy/roles';

export type ActionState = { error?: string; ok?: string };

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const nullable = (v: string) => (v === '' ? null : v);

/** Every action funnels through here so one thrown error is one shown message. */
async function run(slug: string, fn: () => Promise<string>): Promise<ActionState> {
  try {
    const ok = await fn();
    revalidatePath(`/r/${slug}/admin`, 'layout');
    return { ok };
  } catch (e) {
    // redirect() and notFound() signal themselves by throwing. Swallowing
    // those here would turn a navigation into a silent no-op.
    if (typeof (e as { digest?: unknown })?.digest === 'string'
        && /^NEXT_(REDIRECT|NOT_FOUND)/.test((e as { digest: string }).digest)) throw e;
    return { error: e instanceof Error ? e.message : 'Action impossible.' };
  }
}

// ------------------------------------------------------------------ carte
export async function addCategory(_p: ActionState, f: FormData): Promise<ActionState> {
  const slug = str(f, 'slug');
  return run(slug, async () => {
    const ctx = await requireManager(slug);
    const name = z.string().min(1).max(60).parse(str(f, 'name'));
    const { error } = await createClient().schema('resto').from('menu_categories')
      .insert({ restaurant_id: ctx.restaurant.id, name, sort: Number(f.get('sort') ?? 0) });
    if (error) throw new Error(error.code === '23505' ? 'Cette catégorie existe déjà.' : error.message);
    return `Catégorie « ${name} » ajoutée.`;
  });
}

/** Rename. The dishes keep their category; only the label changes. */
export async function renameCategory(_p: ActionState, f: FormData): Promise<ActionState> {
  const slug = str(f, 'slug');
  return run(slug, async () => {
    await requireManager(slug);
    const name = z.string().min(1).max(60).parse(str(f, 'name'));
    const { error } = await createClient().schema('resto').from('menu_categories')
      .update({ name }).eq('id', str(f, 'id'));
    if (error) throw new Error(error.code === '23505' ? 'Ce nom est déjà pris.' : error.message);
    return `Catégorie renommée « ${name} ».`;
  });
}

/**
 * Move one place up or down.
 *
 * Through an RPC rather than two updates: PostgREST opens a transaction per
 * call, so the first of two writes would commit a duplicate position and be
 * rejected. The function does both together, and carries its own permission
 * check because SECURITY DEFINER puts it outside RLS.
 *
 * The refusal it raises has to arrive somewhere. An earlier version dropped
 * the RPC's error on the floor: the arrow was tapped, nothing moved, and
 * nothing said why — the exact failure the explicit check exists to prevent.
 */
async function move(kind: 'category' | 'item', f: FormData): Promise<ActionState> {
  const slug = str(f, 'slug');
  return run(slug, async () => {
    await requireManager(slug);
    const { error } = await createClient().schema('resto')
      .rpc(kind === 'category' ? 'move_category' : 'move_item',
           { p_id: str(f, 'id'), p_dir: Number(f.get('dir') ?? 1) });
    if (error) throw new Error(error.message);
    return 'Ordre modifié.';
  });
}

export async function moveCategory(_p: ActionState, f: FormData): Promise<ActionState> {
  return move('category', f);
}
export async function moveItem(_p: ActionState, f: FormData): Promise<ActionState> {
  return move('item', f);
}

/**
 * Hide, rather than delete. A seasonal category comes back; deleting it and
 * retyping it every year loses the order the team has learned.
 */
export async function toggleCategory(_p: ActionState, f: FormData): Promise<ActionState> {
  const slug = str(f, 'slug');
  return run(slug, async () => {
    await requireManager(slug);
    const active = str(f, 'active') === 'true';
    const { error } = await createClient().schema('resto').from('menu_categories')
      .update({ active: !active }).eq('id', str(f, 'id'));
    if (error) throw new Error(error.message);
    return active ? 'Catégorie masquée en salle.' : 'Catégorie de nouveau en salle.';
  });
}

/**
 * Delete. The dishes survive: menu_items.category_id is ON DELETE SET NULL, so
 * they fall into "sans catégorie" rather than disappearing with their heading.
 * Losing a category must never lose the food.
 */
export async function deleteCategory(_p: ActionState, f: FormData): Promise<ActionState> {
  const slug = str(f, 'slug');
  return run(slug, async () => {
    await requireManager(slug);
    const { error } = await createClient().schema('resto').from('menu_categories')
      .delete().eq('id', str(f, 'id'));
    if (error) throw new Error(error.message);
    return 'Catégorie supprimée. Ses plats sont maintenant sans catégorie.';
  });
}

/**
 * Set a photo, on a category or on a dish, in one tap.
 *
 * Called straight from the client once the upload has landed rather than
 * through a form: taking the photo IS the intent, and asking for a second
 * confirming tap on a screen where the photo is the whole content would be
 * asking twice for the same thing.
 *
 * There was no way to fix a dish photo after creation — the carte would tell
 * the patron "7 plats sans photo" and offer him nothing to do about it. On an
 * image-first carte that is not a missing convenience, it is a dead end.
 */
export async function setPhoto(input: {
  slug: string; target: 'category' | 'item'; id: string; path: string;
}): Promise<void> {
  await requireManager(input.slug);
  const table = input.target === 'category' ? 'menu_categories' : 'menu_items';
  const { error } = await createClient().schema('resto').from(table)
    .update({ photo_path: input.path }).eq('id', input.id);
  if (error) throw new Error(error.message);
  revalidatePath(`/r/${input.slug}/admin`, 'layout');
}

export async function addStation(_p: ActionState, f: FormData): Promise<ActionState> {
  const slug = str(f, 'slug');
  return run(slug, async () => {
    const ctx = await requireManager(slug);
    const name = z.string().min(1).max(60).parse(str(f, 'name'));
    const { error } = await createClient().schema('resto').from('prep_stations')
      .insert({ restaurant_id: ctx.restaurant.id, name });
    if (error) throw new Error(error.code === '23505' ? 'Ce poste existe déjà.' : error.message);
    return `Poste « ${name} » ajouté.`;
  });
}

export async function addItem(_p: ActionState, f: FormData): Promise<ActionState> {
  const slug = str(f, 'slug');
  return run(slug, async () => {
    const ctx = await requireManager(slug);
    const name = z.string().min(1).max(80).parse(str(f, 'name'));

    // The form shows the restaurant's own currency, so the number typed is in
    // major units and is converted here — once, at the boundary.
    const price = parseMoney(str(f, 'price'), ctx.restaurant.currencyDecimals);
    if (price === null) throw new Error('Prix invalide.');

    const { error } = await createClient().schema('resto').from('menu_items').insert({
      restaurant_id: ctx.restaurant.id,
      name,
      description: nullable(str(f, 'description')),
      price,
      category_id: nullable(str(f, 'category_id')),
      // Empty means no station — served straight from the counter. It is the
      // absence that carries the meaning, so there is no separate flag.
      prep_station_id: nullable(str(f, 'prep_station_id')),
      // Uploaded by the client before submit; empty is fine, the fallback tile
      // carries a dish with no photo rather than showing a grey square.
      photo_path: nullable(str(f, 'photo_path')),
    });
    if (error) throw new Error(error.code === '23505' ? 'Ce plat existe déjà.' : error.message);
    return `« ${name} » ajouté à la carte.`;
  });
}

/** The "86" switch: sold out tonight. */
export async function toggleItem(_p: ActionState, f: FormData): Promise<ActionState> {
  const slug = str(f, 'slug');
  return run(slug, async () => {
    await requireManager(slug);
    const id = str(f, 'id');
    const available = str(f, 'available') === 'true';
    const { error } = await createClient().schema('resto').from('menu_items')
      .update({ available: !available }).eq('id', id);
    if (error) throw new Error(error.message);
    return available ? 'Plat retiré de la carte du jour.' : 'Plat de nouveau disponible.';
  });
}

// ------------------------------------------------------------------ salle
export async function addArea(_p: ActionState, f: FormData): Promise<ActionState> {
  const slug = str(f, 'slug');
  return run(slug, async () => {
    const ctx = await requireManager(slug);
    const name = z.string().min(1).max(60).parse(str(f, 'name'));
    const { error } = await createClient().schema('resto').from('areas')
      .insert({ restaurant_id: ctx.restaurant.id, name });
    if (error) throw new Error(error.code === '23505' ? 'Cette zone existe déjà.' : error.message);
    return `Zone « ${name} » ajoutée.`;
  });
}

export async function addTable(_p: ActionState, f: FormData): Promise<ActionState> {
  const slug = str(f, 'slug');
  return run(slug, async () => {
    const ctx = await requireManager(slug);
    const label = z.string().min(1).max(20).parse(str(f, 'label'));
    const seats = z.coerce.number().int().min(1).max(40).parse(f.get('seats') ?? 4);
    const { error } = await createClient().schema('resto').from('tables').insert({
      restaurant_id: ctx.restaurant.id,
      label, seats,
      area_id: nullable(str(f, 'area_id')),
    });
    if (error) throw new Error(error.code === '23505' ? 'Cette table existe déjà.' : error.message);
    return `Table ${label} ajoutée.`;
  });
}

// -------------------------------------------------------------- personnel
export async function addStaff(_p: ActionState, f: FormData): Promise<ActionState> {
  const slug = str(f, 'slug');
  return run(slug, async () => {
    const ctx = await requireManager(slug);

    const username = z.string().min(2).max(40).regex(/^[a-z0-9._-]+$/,
      'Identifiant : minuscules, chiffres, point, tiret.').parse(str(f, 'username').toLowerCase());
    const password = z.string().min(8, '8 caractères au minimum.').parse(str(f, 'password'));
    const role = str(f, 'role') as Role;
    const display = nullable(str(f, 'display_name'));

    // Mirrors the rm_grant rule in SQL: only a patron mints a patron or a
    // gérant. Checked here as well so the refusal is a sentence, not a 403.
    if (!grantableRoles(ctx.role).includes(role)) {
      throw new Error("Vous ne pouvez pas créer un compte de ce rôle.");
    }

    const admin = createAdminClient();
    const email = staffEmail(username, slug);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      app_metadata: { kind: 'staff' },
      user_metadata: { username },
    });
    if (createErr) {
      throw new Error(/already/i.test(createErr.message)
        ? 'Cet identifiant est déjà pris.' : createErr.message);
    }
    const userId = created.user.id;

    // Three rows, and none of them may be left behind if a later one fails:
    // an auth account with no membership can sign in and see nothing, which is
    // the most confusing possible outcome.
    const rollback = async () => {
      await admin.schema('resto').from('staff_accounts').delete().eq('user_id', userId);
      await admin.schema('core').from('product_access').delete().eq('user_id', userId);
      await admin.schema('core').from('org_members').delete().eq('user_id', userId);
      await admin.auth.admin.deleteUser(userId);
    };
    for (const [label, op] of [
      ['org_members', () => admin.schema('core').from('org_members')
        .insert({ org_id: ctx.restaurant.orgId, user_id: userId, org_role: 'member' })],
      ['product_access', () => admin.schema('core').from('product_access')
        .insert({ org_id: ctx.restaurant.orgId, user_id: userId, product: 'resto', role })],
      ['staff_accounts', () => admin.schema('resto').from('staff_accounts')
        .insert({ user_id: userId, restaurant_id: ctx.restaurant.id, username, display_name: display })],
    ] as const) {
      const { error } = await op();
      if (error) { await rollback(); throw new Error(`Création interrompue (${label}).`); }
    }
    return `Compte « ${username} » créé. Il choisira son mot de passe à la première connexion.`;
  });
}
