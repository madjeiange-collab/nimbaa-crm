'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { loginEmail } from '@/lib/auth/staff';

const Credentials = z.object({
  slug: z.string().min(1).max(64),
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

export type LoginState = { error?: string };

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = Credentials.safeParse({
    slug: formData.get('slug'),
    username: formData.get('username'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: 'Identifiant ou mot de passe incorrect.' };

  const { slug, username, password } = parsed.data;
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: loginEmail(username, slug),
    password,
  });

  // One message for every failure. Distinguishing "unknown user" from "wrong
  // password" would also tell an outsider which restaurants exist here and who
  // works at them.
  if (error) return { error: 'Identifiant ou mot de passe incorrect.' };

  redirect(`/r/${slug}`);
}

export async function signOut(slug: string) {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect(`/r/${slug}/login`);
}
