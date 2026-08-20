'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { Field, SubmitError } from '@/components/field';
import { changePassword, type PasswordState } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-service px-4 py-3 text-base font-medium text-white
                 transition-opacity disabled:opacity-60"
    >
      {pending ? 'Enregistrement…' : 'Enregistrer'}
    </button>
  );
}

export function PasswordForm({ slug }: { slug: string }) {
  const [state, formAction] = useFormState<PasswordState, FormData>(changePassword, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="slug" value={slug} />
      <Field label="Nouveau mot de passe" name="password" type="password" autoComplete="new-password" autoFocus />
      <Field label="Confirmer" name="confirm" type="password" autoComplete="new-password" />
      <SubmitError message={state.error} />
      <Submit />
    </form>
  );
}
