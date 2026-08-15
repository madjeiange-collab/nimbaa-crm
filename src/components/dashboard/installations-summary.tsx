import { getTranslations } from 'next-intl/server';
import { StatTile } from '@/components/charts/stat-tile';
import { Card } from '@/components/ui/card';

export interface TechTally {
  name: string;
  done: number;
  open: number;
}

/**
 * Team installation snapshot for the manager dashboard. Server-rendered
 * (independent of the client-side dashboard filters), reusing StatTile.
 */
export async function InstallationsSummary({
  pending,
  inProgress,
  doneWeek,
  revisits,
  perTech,
}: {
  pending: number;
  inProgress: number;
  doneWeek: number;
  revisits: number;
  perTech: TechTally[];
}) {
  const t = await getTranslations('installation');

  const maxDone = Math.max(1, ...perTech.map((p) => p.done));

  return (
    <section className="mx-auto max-w-3xl space-y-3 px-4 pb-6">
      <h2 className="text-sm font-semibold text-muted-foreground">{t('dashTitle')}</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label={t('kpiPending')} value={pending} accent="primary" />
        <StatTile label={t('status.in_progress')} value={inProgress} accent="amber" />
        <StatTile label={t('kpiDoneWeek')} value={doneWeek} accent="green" />
        <StatTile label={t('kpiRevisits')} value={revisits} accent="red" />
      </div>

      {perTech.length > 0 && (
        <Card className="space-y-2 p-4">
          <p className="text-xs font-medium text-muted-foreground">{t('perTechnician')}</p>
          {perTech.map((tech) => (
            <div key={tech.name} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="truncate font-medium">{tech.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t('techTally', { done: tech.done, open: tech.open })}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-brand-green"
                  style={{ width: `${(tech.done / maxDone) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}
