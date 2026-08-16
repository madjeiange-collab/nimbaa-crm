'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth/session';
import { usernameToEmail, isValidUsername, normalizeUsername } from '@/lib/auth/username';
import type { UserRole } from '@/types/database';

export type ActionResult = { ok: true } | { ok: false; error: string };

const ROLES: UserRole[] = ['rep', 'technician', 'manager', 'admin'];

/** Guard: only an authenticated admin may run these privileged actions. */
async function requireAdmin(): Promise<{ ok: true; adminId: string } | { ok: false; error: string }> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (me.role !== 'admin') return { ok: false, error: 'forbidden' };
  return { ok: true, adminId: me.id };
}

function revalidate() {
  revalidatePath('/[locale]/admin/users', 'page');
}

export interface CreateUserInput {
  username: string;
  password: string;
  fullName: string;
  role: UserRole;
  canB2b: boolean;
  canD2d: boolean;
}

/** Create a user account (auth + profile) and set its role/capabilities. */
export async function createUser(input: CreateUserInput): Promise<ActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  const username = normalizeUsername(input.username);
  if (!isValidUsername(username)) return { ok: false, error: 'invalidUsername' };
  if (input.password.length < 8) return { ok: false, error: 'passwordTooShort' };
  if (!ROLES.includes(input.role)) return { ok: false, error: 'invalidRole' };

  const admin = createAdminClient();

  // Reject duplicate usernames early (friendlier than the auth email clash).
  const { data: existing } = await admin
    .from('users')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (existing) return { ok: false, error: 'usernameTaken' };

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password: input.password,
    email_confirm: true,
    user_metadata: { username, full_name: input.fullName.trim() || null },
  });
  if (createErr || !created.user) return { ok: false, error: 'createFailed' };

  // The on_auth_user_created trigger inserted public.users; set role + caps.
  const { error: updErr } = await admin
    .from('users')
    .update({
      full_name: input.fullName.trim() || null,
      username,
      role: input.role,
      can_do_b2b: input.canB2b,
      can_do_d2d: input.canD2d,
      is_active: true,
    })
    .eq('id', created.user.id);
  if (updErr) return { ok: false, error: 'profileFailed' };

  revalidate();
  return { ok: true };
}

/** Edit a user's name, role and capabilities. */
export async function updateUser(
  userId: string,
  fields: { fullName?: string; role?: UserRole; canB2b?: boolean; canD2d?: boolean },
): Promise<ActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;

  // Prevent an admin from demoting the last admin path — keep it simple by
  // blocking self role changes (avoids locking yourself out mid-edit).
  if (fields.role && userId === guard.adminId && fields.role !== 'admin') {
    return { ok: false, error: 'cannotChangeOwnRole' };
  }
  if (fields.role && !ROLES.includes(fields.role)) return { ok: false, error: 'invalidRole' };

  const patch: Record<string, unknown> = {};
  if (fields.fullName !== undefined) patch.full_name = fields.fullName.trim() || null;
  if (fields.role !== undefined) patch.role = fields.role;
  if (fields.canB2b !== undefined) patch.can_do_b2b = fields.canB2b;
  if (fields.canD2d !== undefined) patch.can_do_d2d = fields.canD2d;

  const admin = createAdminClient();
  const { error } = await admin.from('users').update(patch).eq('id', userId);
  if (error) return { ok: false, error: 'saveFailed' };
  revalidate();
  return { ok: true };
}

/** Set a new password for a user (admin reset). */
export async function resetUserPassword(
  userId: string,
  newPassword: string,
): Promise<ActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  if (newPassword.length < 8) return { ok: false, error: 'passwordTooShort' };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) return { ok: false, error: 'saveFailed' };
  revalidate();
  return { ok: true };
}

/** Activate or deactivate a user. Inactive users are blocked at login. */
export async function setUserActive(userId: string, isActive: boolean): Promise<ActionResult> {
  const guard = await requireAdmin();
  if (!guard.ok) return guard;
  if (userId === guard.adminId && !isActive) {
    return { ok: false, error: 'cannotDeactivateSelf' };
  }

  const admin = createAdminClient();
  const { error } = await admin.from('users').update({ is_active: isActive }).eq('id', userId);
  if (error) return { ok: false, error: 'saveFailed' };
  revalidate();
  return { ok: true };
}
