'use client';

import { useTranslations } from 'next-intl';
import { MultiSelectFilter } from './multi-select-filter';

/** Searchable multi-select rep filter. */
export function RepMultiFilter({
  reps,
  selected,
  onChange,
}: {
  reps: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations('dashboard');
  return (
    <MultiSelectFilter
      items={reps}
      selected={selected}
      onChange={onChange}
      allLabel={t('allReps')}
      searchPlaceholder={t('searchRep')}
      emptyLabel={t('noRep')}
      countLabel={(n) => t('repsSelected', { n })}
    />
  );
}

/** Searchable multi-select technician filter. */
export function TechMultiFilter({
  technicians,
  selected,
  onChange,
}: {
  technicians: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations('dashboard');
  return (
    <MultiSelectFilter
      items={technicians}
      selected={selected}
      onChange={onChange}
      allLabel={t('allTechnicians')}
      searchPlaceholder={t('searchTechnician')}
      emptyLabel={t('noTechnician')}
      countLabel={(n) => t('techniciansSelected', { n })}
    />
  );
}

/** Searchable multi-select territory (secteur) filter. */
export function TerritoryFilter({
  territories,
  selected,
  onChange,
}: {
  territories: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations('dashboard');
  return (
    <MultiSelectFilter
      items={territories}
      selected={selected}
      onChange={onChange}
      allLabel={t('allTerritories')}
      searchPlaceholder={t('searchTerritory')}
      emptyLabel={t('noTerritory')}
      countLabel={(n) => t('territoriesSelected', { n })}
    />
  );
}
