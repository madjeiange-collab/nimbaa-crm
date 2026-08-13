'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { usernameToEmail } from '@/lib/auth/username';

export type AuthResult = { ok: true } | { ok: false; error: string };

/**
 * Sign in with username + password. The username is mapped to the internal
 * synthetic email before hitting Supabase Auth. Returns a typed error key that
 * the client maps to a localized message.
 */
export async function signInWithUsername(
  username: string,
  password: string,
): Promise<AuthResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });

  if (error || !data.user) {
    return { ok: false, error: 'invalidCredentials' };
  }

  // Block disabled accounts even if the password is valid.
  const { data: profile } = await supabase
    .from('users')
    .select('is_active')
    .eq('id', data.user.id)
    .single();

  if (profile && profile.is_active === false) {
    await supabase.auth.signOut();
    return { ok: false, error: 'accountInactive' };
  }

  return { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
}

/**
 * Rep-facing password change. Re-authenticates with the current password,
 * then updates to the new one.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<AuthResult> {
  if (newPassword.length < 8) {
    return { ok: false, error: 'passwordTooShort' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return { ok: false, error: 'genericError' };
  }

  // Verify the current password by attempting a sign-in.
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyError) {
    return { ok: false, error: 'invalidCredentials' };
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: newPassword,
  });
  if (updateError) {
    return { ok: false, error: 'passwordChangeError' };
  }

  return { ok: true };
}
