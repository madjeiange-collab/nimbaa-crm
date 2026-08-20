/** Text input with its label. Sized for a phone held in one hand. */
export function Field({
  label, name, type = 'text', autoComplete, defaultValue, autoFocus, required = true,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  autoFocus?: boolean;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-soft">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        className="w-full rounded-md border border-rule bg-white px-3 py-2.5 text-base
                   outline-none focus:border-service focus:ring-2 focus:ring-service/20"
      />
    </label>
  );
}

export function SubmitError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  );
}
