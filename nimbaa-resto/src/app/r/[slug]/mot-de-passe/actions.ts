'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getStaffContext } from '@/lib/auth/staff';

const NewPassword = z
  .object({
    slug: z.string().min(1).max(64),
    password: z.string().min(8, '8 caractères au minimum.').max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Les deux mots de passe ne correspondent pas.',
  });

export type PasswordState = { error?: string };

export async function changePassword(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const parsed = NewPassword.safeParse({
    slug: formData.get('slug'),
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Mot de passe invalide.' };
  }

  const { slug, password } = parsed.data;

  // Re-derive who is asking from the session rather than trusting the form.
  const ctx = await getStaffContext(slug);
  if (!ctx) redirect(`/r/${slug}/login`);

  const supabase = createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Le mot de passe n'a pas pu être changé." };

  // Clear the flag only after the password actually changed.
  //
  // Via the RPC, not a direct update: the staff_accounts update policy is
  // owner/manager only, so a waiter's own UPDATE matches zero rows — silently,
  // because RLS filters rather than errors — and they would be redirected back
  // here on every request, for ever. clear_must_change_password() is SECURITY
  // DEFINER and touches one column of auth.uid()'s own row, which is exactly
  // the permission needed and nothing more.
  const { error: flagError } = await supabase
    .schema('resto')
    .rpc('clear_must_change_password');
  if (flagError) return { error: 'Mot de passe changé, mais le compte reste à mettre à jour.' };

  redirect(`/r/${slug}`);
}
