import type { ChecklistItem, InstallStatus } from '@/types/database';

export type { ChecklistItem, InstallStatus } from '@/types/database';
export type { EquipmentItem } from '@/types/database';

export type InstallStatusColor = 'grey' | 'blue' | 'amber' | 'green';

export interface InstallStatusMeta {
  key: InstallStatus;
  color: InstallStatusColor;
  /** i18n key under the `installation.status` namespace. */
  i18n: string;
}

// Lifecycle order of an installation job.
export const INSTALL_STATUSES: InstallStatusMeta[] = [
  { key: 'pending', color: 'grey', i18n: 'pending' },
  { key: 'scheduled', color: 'blue', i18n: 'scheduled' },
  { key: 'in_progress', color: 'amber', i18n: 'in_progress' },
  { key: 'needs_revisit', color: 'amber', i18n: 'needs_revisit' },
  { key: 'done', color: 'green', i18n: 'done' },
];

export const INSTALL_STATUS_BY_KEY: Record<InstallStatus, InstallStatusMeta> =
  Object.fromEntries(INSTALL_STATUSES.map((s) => [s.key, s])) as Record<
    InstallStatus,
    InstallStatusMeta
  >;

/** Statuses that mean "still on a technician's plate" — drives the queue. */
export const OPEN_INSTALL_STATUSES: InstallStatus[] = [
  'pending',
  'scheduled',
  'in_progress',
  'needs_revisit',
];

/** Tailwind badge classes per status colour (brand-aligned, reused in queue/detail). */
export const INSTALL_STATUS_BADGE: Record<InstallStatusColor, string> = {
  grey: 'bg-muted text-muted-foreground',
  blue: 'bg-blue-100 text-blue-800',
  amber: 'bg-amber-100 text-amber-900',
  green: 'bg-brand-green/15 text-brand-green',
};

/**
 * Default installation checklist. Copied onto each job at creation so a job
 * keeps its own steps even if this template later changes (admin-editable
 * template is deferred to Phase 6). `key` is stable; `label` is the FR default
 * shown when a job predates any translation.
 */
export const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { key: 'site_ready', label: 'Site préparé', done: false },
  { key: 'unit_mounted', label: 'Unité montée', done: false },
  { key: 'wiring', label: 'Câblage effectué', done: false },
  { key: 'power_on', label: 'Mise sous tension', done: false },
  { key: 'function_test', label: 'Test fonctionnel', done: false },
  { key: 'customer_training', label: 'Formation client', done: false },
];

export function freshChecklist(): ChecklistItem[] {
  return DEFAULT_CHECKLIST.map((s) => ({ ...s }));
}
