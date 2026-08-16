'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Users, Wrench } from 'lucide-react';

/**
 * Splits the manager space into two clearly-distinct groups — commerciaux and
 * techniciens — each with its own full statistics panel. Panels are rendered on
 * the server and passed in; this only toggles which one is shown.
 */
export function DashboardTabs({
  commercial,
  technician,
}: {
  commercial: ReactNode;
  technician: ReactNode;
}) {
  const t = useTranslations('dashboard');
  const [tab, setTab] = useState<'commercial' | 'technician'>('commercial');

  const tabClass = (active: boolean) =>
    `flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
      active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
    }`;

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        <button type="button" onClick={() => setTab('commercial')} className={tabClass(tab === 'commercial')}>
          <Users className="h-4 w-4" />
          {t('tabCommercial')}
        </button>
        <button type="button" onClick={() => setTab('technician')} className={tabClass(tab === 'technician')}>
          <Wrench className="h-4 w-4" />
          {t('tabTechnician')}
        </button>
      </div>

      {/* Commercial stays mounted (default tab) so its filters keep state and its
          map — initialised while visible — renders correctly. The technician
          panel mounts only when its tab is opened, so its Leaflet map sizes
          correctly instead of initialising inside a hidden (0×0) container. */}
      <div className={tab === 'commercial' ? '' : 'hidden'}>{commercial}</div>
      {tab === 'technician' && technician}
    </main>
  );
}
