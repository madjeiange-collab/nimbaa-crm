'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { ActionState } from '@/app/r/[slug]/admin/actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-service px-4 py-2.5 text-sm font-medium text-white
                 transition-opacity disabled:opacity-60"
    >
      {pending ? '…' : label}
    </button>
  );
}

/**
 * One shape for every back-office form: fields, a button, and a single line of
 * feedback in the same place each time.
 */
export function AdminForm({
  action, slug, submit, name, children,
}: {
  action: (p: ActionState, f: FormData) => Promise<ActionState>;
  slug: string;
  submit: string;
  /** Names the form so a test can address it without counting siblings. */
  name?: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useFormState<ActionState, FormData>(action, {});
  return (
    <form action={formAction} data-form={name} className="flex flex-col gap-3">
      <input type="hidden" name="slug" value={slug} />
      {children}
      <div className="flex items-center gap-3">
        <Submit label={submit} />
        {state.error && <span role="alert" className="text-sm text-red-800">{state.error}</span>}
        {state.ok && <span role="status" className="text-sm text-service">{state.ok}</span>}
      </div>
    </form>
  );
}

export function Text({
  name, label, placeholder, required = true, defaultValue, type = 'text',
}: {
  name: string; label: string; placeholder?: string;
  required?: boolean; defaultValue?: string; type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      <input
        name={name} type={type} required={required}
        placeholder={placeholder} defaultValue={defaultValue}
        className="w-full rounded-md border border-rule bg-white px-3 py-2 text-base
                   outline-none focus:border-service focus:ring-2 focus:ring-service/20"
      />
    </label>
  );
}

export function Choice({
  name, label, options, empty,
}: {
  name: string; label: string;
  options: { value: string; label: string }[];
  empty?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</span>
      <select
        name={name}
        className="w-full rounded-md border border-rule bg-white px-3 py-2 text-base
                   outline-none focus:border-service focus:ring-2 focus:ring-service/20"
      >
        {empty && <option value="">{empty}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Panel({ title, hint, children }: {
  title: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-rule bg-white p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      {hint && <p className="mb-4 mt-0.5 text-sm text-ink-faint">{hint}</p>}
      <div className={hint ? '' : 'mt-4'}>{children}</div>
    </section>
  );
}
