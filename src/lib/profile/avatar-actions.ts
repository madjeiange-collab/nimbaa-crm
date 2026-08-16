'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';

export type AvatarResult = { ok: true } | { ok: false; error: string };

/**
 * Sets the current user's profile photo. The file arrives already compressed
 * by the client (~512px JPEG). Uses the admin client so no self-update RLS
 * policy is needed on `users` (which would let users edit their own role).
 */
export async function updateMyAvatar(formData: FormData): Promise<AvatarResult> {
  const user = await requireUser();
  const file = formData.get('avatar');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'bad_file' };
  if (file.size > 2 * 1024 * 1024) return { ok: false, error: 'too_large' };
  if (!file.type.startsWith('image/')) return { ok: false, error: 'bad_file' };

  const admin = createAdminClient();
  const path = `${user.id}/avatar-${Date.now()}.jpg`;

  const { error: upErr } = await admin.storage
    .from('avatars')
    .upload(path, file, { contentType: 'image/jpeg', upsert: true });
  if (upErr) return { ok: false, error: 'upload' };

  const { error: dbErr } = await admin
    .from('users')
    .update({ avatar_path: path })
    .eq('id', user.id);
  if (dbErr) return { ok: false, error: 'save' };

  // Best-effort cleanup of the previous photo.
  if (user.avatar_path && user.avatar_path !== path) {
    await admin.storage.from('avatars').remove([user.avatar_path]);
  }

  revalidatePath('/[locale]', 'layout');
  return { ok: true };
}

/** Removes the current user's profile photo (back to initials). */
export async function removeMyAvatar(): Promise<AvatarResult> {
  const user = await requireUser();
  if (!user.avatar_path) return { ok: true };

  const admin = createAdminClient();
  const { error } = await admin
    .from('users')
    .update({ avatar_path: null })
    .eq('id', user.id);
  if (error) return { ok: false, error: 'save' };
  await admin.storage.from('avatars').remove([user.avatar_path]);

  revalidatePath('/[locale]', 'layout');
  return { ok: true };
}
