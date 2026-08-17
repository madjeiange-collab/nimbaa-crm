'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';

/**
 * Manager-style filters for the personal statistics page: secteur, type
 * d'activité, tag. The page is server-aggregated, so the filters live in the
 * URL — changing one re-renders the stats with the selection applied.
 */
export function StatsFilters({
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
  const router = useRouter();
  const tD = useTranslations('dashboard');
  const tDeals = useTranslations('deals');

  function apply(patch: Partial<typeof current>) {
    const next = { ...current, ...patch };
    const p = new URLSearchParams();
    if (next.terr) p.set('terr', next.terr);
    if (next.type) p.set('type', next.type);
    if (next.tag) p.set('tag', next.tag);
    const qs = p.toString();
    router.replace(qs ? `/stats?${qs}` : '/stats');
  }

  if (territories.length === 0 && types.length === 0 && tags.length === 0) return null;

  const cls =
    'flex min-h-touch w-full rounded-md border border-input bg-background px-2 text-sm';

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {territories.length > 0 && (
        <select
          value={current.terr}
          onChange={(e) => apply({ terr: e.target.value })}
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
          onChange={(e) => apply({ type: e.target.value })}
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
          onChange={(e) => apply({ tag: e.target.value })}
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
