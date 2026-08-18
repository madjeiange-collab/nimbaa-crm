import { getTranslations } from 'next-intl/server';
import { LogIn, LogOut } from 'lucide-react';
import type { JobHistory } from '@/lib/installations/history';
import { Card, CardContent } from '@/components/ui/card';

const fmt = (iso: string, withTime = true) =>
  new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Africa/Abidjan',
  });

const fmtDuration = (min: number) =>
  min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;

/**
 * A job as its trips, oldest first — how many times someone went, how long
 * they stayed, what they concluded and the two photos of each passage.
 */
export async function JobHistoryPanel({ history }: { history: JobHistory }) {
  const t = await getTranslations('installation');
  const tStatus = await getTranslations('installation.status');
  const { trips, returns, totalMinutes } = history;

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div>
          <p className="text-sm font-semibold">{t('historyTitle')}</p>
          <p className="text-xs text-muted-foreground">
            {t('historySummary', {
              trips: trips.length,
              returns,
              total: fmtDuration(totalMinutes),
            })}
          </p>
        </div>

        <ol className="space-y-2">
          {trips.map((trip, i) => (
            <li key={trip.id} className="rounded-lg border p-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="font-medium tabular-nums">{fmt(trip.at)}</span>
                    {trip.durationMin != null && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                        {fmtDuration(trip.durationMin)}
                      </span>
                    )}
                    {trip.outcome && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          trip.outcome === 'done'
                            ? 'bg-knock-green/15 text-knock-green'
                            : trip.outcome === 'needs_revisit'
                              ? 'bg-brand-amber/20 text-brand-brown'
                              : 'bg-secondary text-secondary-foreground'
                        }`}
                      >
                        {tStatus(trip.outcome as never)}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {trip.by}
                    {trip.stepsTotal != null &&
                      ` · ${t('stepsDone', { done: trip.stepsDone ?? 0, total: trip.stepsTotal })}`}
                  </p>
                  {trip.note && <p className="text-xs">{trip.note}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  {(['arrival', 'completion'] as const).map((kind) => {
                    const p = trip.photos.find((x) => x.kind === kind);
                    return p ? (
                      <a
                        key={kind}
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block h-11 w-11 overflow-hidden rounded border"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" className="h-full w-full object-cover" />
                      </a>
                    ) : (
                      <div
                        key={kind}
                        className="flex h-11 w-11 items-center justify-center rounded border border-dashed text-muted-foreground"
                      >
                        {kind === 'arrival' ? (
                          <LogIn className="h-4 w-4" />
                        ) : (
                          <LogOut className="h-4 w-4" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
