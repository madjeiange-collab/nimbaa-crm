'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';

/**
 * Secteur / type d'activité / tag for Check-In and -Out — the same three the
 * manager area uses. They live in the URL beside ?p= so the server re-queries
 * and the durations, totals and checks stay in step with the journal.
 */
export function ControlsFilters({
  territories,
  types,
  tags,
  current,
}: {
  territories: { id: string; name: string }[];
  types: string[];
  tags: string[];
  current: { terr: string; type: string; tag: string };
}) {
  const tD = useTranslations('dashboard');
  const tDeals = useTranslations('deals');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  if (territories.length === 0 && types.length === 0 && tags.length === 0) return null;

  function apply(key: 'terr' | 'type' | 'tag', value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  const cls = 'flex min-h-touch w-full rounded-md border border-input bg-background px-2 text-sm';

  return (
    <div className={`flex flex-col gap-2 sm:flex-row ${isPending ? 'opacity-60' : ''}`}>
      {territories.length > 0 && (
        <select
          value={current.terr}
          onChange={(e) => apply('terr', e.target.value)}
          aria-label={tD('allTerritories')}
          className={cls}
        >
          <option value="">{tD('allTerritories')}</option>
          {territories.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {types.length > 0 && (
        <select
          value={current.type}
          onChange={(e) => apply('type', e.target.value)}
          aria-label={tDeals('businessType')}
          className={cls}
        >
          <option value="">{tDeals('allTypes')}</option>
          {types.map((ty) => (
            <option key={ty} value={ty}>
              {ty}
            </option>
          ))}
        </select>
      )}
      {tags.length > 0 && (
        <select
          value={current.tag}
          onChange={(e) => apply('tag', e.target.value)}
          aria-label={tDeals('tags')}
          className={cls}
        >
          <option value="">{tDeals('allTags')}</option>
          {tags.map((tg) => (
            <option key={tg} value={tg}>
              {tg}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
