'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Field, SubmitError } from '@/components/field';
import { signIn, type LoginState } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-service px-4 py-3 text-base font-medium text-white
                 transition-opacity disabled:opacity-60"
    >
      {pending ? 'Connexion…' : 'Se connecter'}
    </button>
  );
}

export function LoginForm({ slug }: { slug: string }) {
  const [state, formAction] = useFormState<LoginState, FormData>(signIn, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="slug" value={slug} />
      <Field label="Identifiant" name="username" autoComplete="username" autoFocus />
      <Field label="Mot de passe" name="password" type="password" autoComplete="current-password" />
      <SubmitError message={state.error} />
      <Submit />
    </form>
  );
}
