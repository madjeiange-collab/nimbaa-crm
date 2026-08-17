'use client';

import { Input } from '@/components/ui/input';

/**
 * Role picker for interlocuteurs: standard roles (Gérant default) plus
 * "Autre…" revealing a free-text field. The stored value is plain text, so
 * existing custom roles keep working — they simply show under "Autre…".
 */
export const STANDARD_ROLES = [
  'Gérant',
  'Propriétaire',
  'Directeur',
  'Chef de projet',
  'Responsable achats',
  'Comptable',
  'Secrétaire',
] as const;

export const DEFAULT_ROLE = 'Gérant';

const OTHER = '__other__';

export function RoleSelect({
  value,
  onChange,
  otherPlaceholder,
}: {
  value: string;
  onChange: (role: string) => void;
  otherPlaceholder: string;
}) {
  const isStandard = (STANDARD_ROLES as readonly string[]).includes(value);
  const selectValue = isStandard ? value : OTHER;

  return (
    <div className="space-y-2">
      <select
        value={selectValue}
        onChange={(e) => onChange(e.target.value === OTHER ? '' : e.target.value)}
        aria-label={otherPlaceholder}
        className="flex min-h-touch w-full rounded-md border border-input bg-background px-2 text-sm"
      >
        {STANDARD_ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
        <option value={OTHER}>Autre…</option>
      </select>
      {!isStandard && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={otherPlaceholder}
        />
      )}
    </div>
  );
}
