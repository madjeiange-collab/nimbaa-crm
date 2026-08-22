'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { ActionState } from '@/app/r/[slug]/admin/actions';

/**
 * A form that lives inside a row rather than in a panel: no heading, no wide
 * submit button, and its one line of feedback wraps underneath instead of
 * pushing the row apart.
 *
 * Same contract as AdminForm — one action, one message — at the size a list
 * item can carry.
 */
export function RowForm({
  action, className = '', children,
}: {
  action: (p: ActionState, f: FormData) => Promise<ActionState>;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, formAction] = useFormState<ActionState, FormData>(action, {});
  const message = state.error ?? state.ok;
  return (
    <form action={formAction} className={className}>
      {children}
      {message && (
        <span
          role={state.error ? 'alert' : 'status'}
          className={`w-full text-xs ${state.error ? 'text-red-800' : 'text-service'}`}
        >
          {message}
        </span>
      )}
    </form>
  );
}

/**
 * Submit button sized for a row.
 *
 * `name`/`value` let two of them share one form — ↑ and ↓ differ only by the
 * direction they submit, and one form means one message slot instead of two.
 */
export function RowSubmit({
  label, title, name, value, disabled, className = '',
}: {
  label: React.ReactNode;
  title?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled}
      title={title} aria-label={title}
      className={`flex h-9 min-w-9 flex-none items-center justify-center gap-1 rounded-md
                  border border-rule bg-white px-2 text-sm transition-opacity
                  disabled:opacity-35 ${className}`}>
      {pending ? '…' : label}
    </button>
  );
}
