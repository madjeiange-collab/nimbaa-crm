'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';

/**
 * Chip-style tag editor: type a tag, Enter (or comma) adds it, × removes.
 * Commits the full list on every change; deduplicates case-insensitively.
 */
export function TagsInput({
  tags,
  onCommit,
  placeholder,
  max = 12,
}: {
  tags: string[];
  onCommit: (tags: string[]) => void;
  placeholder: string;
  max?: number;
}) {
  const [draft, setDraft] = useState('');

  function addDraft() {
    const v = draft.trim().replace(/,+$/, '');
    setDraft('');
    if (!v) return;
    if (tags.some((t) => t.toLowerCase() === v.toLowerCase())) return;
    if (tags.length >= max) return;
    onCommit([...tags, v]);
  }

  return (
    <div className="space-y-1.5">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
            >
              {t}
              <button
                type="button"
                aria-label={`× ${t}`}
                onClick={() => onCommit(tags.filter((x) => x !== t))}
                className="hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(',')) {
            setDraft(v);
            addDraft();
          } else {
            setDraft(v);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addDraft();
          }
        }}
        onBlur={addDraft}
        placeholder={placeholder}
        className="text-sm"
      />
    </div>
  );
}
