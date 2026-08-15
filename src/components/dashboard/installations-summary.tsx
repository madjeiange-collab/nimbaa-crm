import { getTranslations } from 'next-intl/server';
import { StatTile } from '@/components/charts/stat-tile';
import { Card } from '@/components/ui/card';

export interface TechTally {
  name: string;
  done7d: number;
  open: number;
  revisits: number;
}

/**
 * Technician statistics for the manager dashboard — the team-wide counterpart
 * of the commercial stats, rendered right after them. Server-rendered
 * (independent of the client-side commercial filters), reusing StatTile.
 */
export async function InstallationsSummary({
  pending,
  inProgress,
  doneWeek,
  revisits,
  perTech,
  showHeading = true,
}: {
  pending: number;
  inProgress: number;
  doneWeek: number;
  revisits: number;
  perTech: TechTally[];
  /** Hide the section title when the page already provides one (standalone page). */
  showHeading?: boolean;
}) {
  const t = await getTranslations('installation');

  const maxDone = Math.max(1, ...perTech.map((p) => p.done7d));

  return (
    <section className="mx-auto max-w-3xl space-y-3 px-4 pb-6">
      {showHeading && (
        <h2 className="text-sm font-semibold text-muted-foreground">{t('techStatsTitle')}</h2>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label={t('kpiPending')} value={pending} accent="primary" />
        <StatTile label={t('status.in_progress')} value={inProgress} accent="amber" />
        <StatTile label={t('kpiDoneWeek')} value={doneWeek} accent="green" />
        <StatTile label={t('kpiRevisits')} value={revisits} accent="red" />
      </div>

      {perTech.length > 0 && (
        <Card className="space-y-2.5 p-4">
          <p className="text-xs font-medium text-muted-foreground">{t('perTechnician')}</p>
          {perTech.map((tech) => (
            <div key={tech.name} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-medium">{tech.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t('techTallyFull', {
                    done: tech.done7d,
                    open: tech.open,
                    revisits: tech.revisits,
                  })}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-brand-green"
                  style={{ width: `${(tech.done7d / maxDone) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}
