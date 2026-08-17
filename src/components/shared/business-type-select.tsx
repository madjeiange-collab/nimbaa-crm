'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';

/**
 * Business-type picker for deals — the trades a Nimbaa rep meets in Abidjan.
 * Stored as plain text: standard entries below, « Autre… » frees the field
 * (committed on blur), and legacy/custom values keep displaying under Autre.
 */
export const BUSINESS_TYPES = [
  'Maquis',
  'Restaurant',
  'Glacier',
  'Chawarma',
  'Boutique',
  'Supérette',
  'Pharmacie',
  'Salon de coiffure',
  'Cybercafé',
  'Hôtel',
  'École',
  'Clinique',
  'Bureau / Entreprise',
] as const;

const OTHER = '__other__';

export function BusinessTypeSelect({
  value,
  onCommit,
  emptyLabel,
  otherPlaceholder,
}: {
  value: string | null;
  /** Called with the final value (null = none) — a standard pick commits
   *  immediately, a custom « Autre… » entry commits on blur. */
  onCommit: (type: string | null) => void;
  emptyLabel: string;
  otherPlaceholder: string;
}) {
  const stored = value ?? '';
  const storedIsCustom = stored !== '' && !(BUSINESS_TYPES as readonly string[]).includes(stored);
  const [customMode, setCustomMode] = useState(storedIsCustom);
  const [text, setText] = useState(storedIsCustom ? stored : '');

  return (
    <div className="space-y-2">
      <select
        value={customMode ? OTHER : stored}
        onChange={(e) => {
          const next = e.target.value;
          if (next === OTHER) {
            setCustomMode(true);
            setText(storedIsCustom ? stored : '');
          } else {
            setCustomMode(false);
            onCommit(next || null);
          }
        }}
        aria-label={emptyLabel}
        className="flex min-h-touch w-full rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">{emptyLabel}</option>
        {BUSINESS_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
        <option value={OTHER}>Autre…</option>
      </select>
      {customMode && (
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const v = text.trim();
            if (v !== stored) onCommit(v || null);
            if (!v) setCustomMode(false);
          }}
          placeholder={otherPlaceholder}
          autoFocus
        />
      )}
    </div>
  );
}
