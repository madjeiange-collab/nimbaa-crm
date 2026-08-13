'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';

/**
 * Generic searchable multi-select dropdown (checkbox list).
 * Empty selection = "all". Labels are passed in so it works for reps,
 * territories, or anything else.
 */
export function MultiSelectFilter({
  items,
  selected,
  onChange,
  allLabel,
  searchPlaceholder,
  emptyLabel,
  countLabel,
}: {
  items: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  allLabel: string;
  searchPlaceholder: string;
  emptyLabel: string;
  countLabel: (n: number) => string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const id = window.setTimeout(() => inputRef.current?.focus(), 30);
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.clearTimeout(id);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? items.filter((r) => r.name.toLowerCase().includes(q)) : items),
    [items, q],
  );

  if (items.length === 0) return null;

  const allActive = selected.length === 0;
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const summary = allActive
    ? allLabel
    : selected.length === 1
      ? (items.find((r) => r.id === selected[0])?.name ?? '—')
      : countLabel(selected.length);

  const box = (on: boolean) =>
    `flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
      on ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
    }`;

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-touch w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-sm font-medium"
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute z-[600] mt-1 w-full min-w-[220px] rounded-lg border bg-card shadow-lg">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-md border border-input bg-background py-2 pl-8 pr-2 text-sm"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {!q && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent"
              >
                <span className={box(allActive)}>{allActive && <Check className="h-3 w-3" />}</span>
                {allLabel}
              </button>
            )}
            {shown.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">{emptyLabel}</p>
            ) : (
              shown.map((r) => {
                const on = selected.includes(r.id);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggle(r.id)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent"
                  >
                    <span className={box(on)}>{on && <Check className="h-3 w-3" />}</span>
                    <span className="truncate">{r.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
