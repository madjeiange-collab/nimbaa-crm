'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, LogIn, LogOut } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { PeriodFilter } from '@/components/dashboard/period-filter';
import type { Period } from '@/lib/checkin/period';
import type { JournalRow } from '@/lib/checkin/journal';

const FLAG_STYLE: Record<string, string> = {
  pairFar: 'bg-destructive/10 text-destructive',
  tooShort: 'bg-brand-amber/20 text-brand-brown',
  farFromContact: 'bg-destructive/10 text-destructive',
  clockDrift: 'bg-secondary text-secondary-foreground',
};

// Always field time (Abidjan), never the viewer's: a manager abroad must read
// the rep's actual day, not a shifted one.
const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Abidjan',
  });

const dayLabel = (day: string) =>
  new Date(day + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

const fmtDuration = (min: number) => {
  if (min >= 60) return `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}`;
  return min > 0 && min < 1 ? '< 1 min' : `${Math.round(min)} min`;
};

interface DayGroup {
  key: string;
  day: string;
  personId: string;
  personName: string;
  rows: JournalRow[]; // chronological
  firstIn: string | null;
  lastOut: string | null;
  onSiteMin: number;
  fieldMin: number | null;
  ratio: number | null;
}

/**
 * The check-in / check-out journal: every passage, grouped by person and day,
 * with the day's shape on top (first check-in, last check-out, time actually
 * spent with customers). Used both team-wide by managers and personally by
 * the field user themselves.
 */
export function CheckInJournal({
  rows,
  people = [],
  showPerson = true,
  teamRatios = null,
  title,
  period,
  cap,
}: {
  rows: JournalRow[];
  people?: { id: string; name: string }[];
  /** Row ceiling used when loading, so a truncated list can say so. */
  cap?: number;
  /** Overrides the card heading — the personal view says whose passages these are. */
  title?: string;
  /** Render the window picker inside the card (pages without one of their own). */
  period?: Period;
  /** Team view shows who did what; the personal view already knows. */
  showPerson?: boolean;
  /** Client-time averages per kind of work — a day is compared with its own. */
  teamRatios?: { visit: number | null; install: number | null } | null;
}) {
  const t = useTranslations('dashboard');
  const tDisp = useTranslations('dispositions');

  const [person, setPerson] = useState('');
  const [kind, setKind] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  // The window itself is chosen above the page (?p=), which re-queries — these
  // filters only narrow what came back.
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!person || r.personId === person) &&
          (!kind || r.kind === kind) &&
          (!onlyFlagged || r.flags.length > 0),
      ),
    [rows, person, kind, onlyFlagged],
  );

  const groups = useMemo<DayGroup[]>(() => {
    const map = new Map<string, JournalRow[]>();
    for (const r of filtered) {
      const key = `${r.personId}|${r.day}`;
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([key, list]) => {
        const chrono = [...list].sort(
          (a, b) => new Date(a.inAt ?? a.outAt).getTime() - new Date(b.inAt ?? b.outAt).getTime(),
        );
        const timed = chrono.filter((r) => r.inAt && r.durationMin != null);
        const firstIn = timed[0]?.inAt ?? null;
        const lastOut = timed.length ? timed[timed.length - 1].outAt : null;
        // Sum the real intervals, not the rounded per-row minutes — otherwise
        // short passages vanish and the ratio collapses to 0.
        const onSiteMin = timed.reduce(
          (s, r) => s + (new Date(r.outAt).getTime() - new Date(r.inAt as string).getTime()) / 60_000,
          0,
        );
        const fieldMin =
          firstIn && lastOut
            ? Math.max(0, (new Date(lastOut).getTime() - new Date(firstIn).getTime()) / 60_000)
            : null;
        return {
          key,
          day: chrono[0].day,
          personId: chrono[0].personId,
          personName: chrono[0].personName,
          rows: chrono,
          firstIn,
          lastOut,
          onSiteMin,
          fieldMin,
          // With a single stop the span *is* the visit, so the ratio would
          // always read 100 % — meaningless. It needs two passages to say
          // anything about how the day was spent.
          ratio:
            timed.length >= 2 && fieldMin && fieldMin > 0
              ? Math.round((onSiteMin / fieldMin) * 100)
              : null,
        };
      })
      .sort((a, b) => (a.day === b.day ? a.personName.localeCompare(b.personName) : b.day.localeCompare(a.day)));
  }, [filtered]);

  function exportCsv() {
    const head = [
      t('jCol_day'),
      t('jCol_person'),
      t('jCol_in'),
      t('jCol_out'),
      t('jCol_duration'),
      t('jCol_client'),
      t('jCol_type'),
      t('jCol_result'),
      t('jCol_pair'),
      t('jCol_toContact'),
      t('jCol_flags'),
    ];
    const lines = groups.flatMap((g) =>
      g.rows.map((r) =>
        [
          r.day,
          r.personName,
          r.inAt ? hhmm(r.inAt) : '',
          hhmm(r.outAt),
          r.durationMin ?? '',
          r.contactName ?? '',
          r.kind === 'install' ? t('jInstall') : t('jVisit'),
          r.disposition ?? '',
          r.pairMeters ?? '',
          r.contactMeters ?? '',
          r.flags.map((f) => t(`flag_${f}` as never)).join(' / '),
        ]
          .map((c) => `"${String(c).replace(/"/g, '""')}"`)
          .join(','),
      ),
    );
    const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'check-in-out.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectCls =
    'min-h-touch rounded-md border border-input bg-background px-2 text-sm';

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{title ?? t('journalTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('journalHint')}</p>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            aria-label={t('exportCsv')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>

        {period && <PeriodFilter active={period} />}

        <div className="flex flex-wrap gap-2">
          {showPerson && people.length > 0 && (
            <select value={person} onChange={(e) => setPerson(e.target.value)} className={selectCls}>
              <option value="">{t('jAllPeople')}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={selectCls}>
            <option value="">{t('jAllKinds')}</option>
            <option value="visit">{t('jVisit')}</option>
            <option value="install">{t('jInstall')}</option>
          </select>
          <label className="flex min-h-touch items-center gap-2 rounded-md border border-input px-2 text-sm">
            <input
              type="checkbox"
              checked={onlyFlagged}
              onChange={(e) => setOnlyFlagged(e.target.checked)}
            />
            {t('jOnlyFlagged')}
          </label>
        </div>

        {/* Never let a truncated list read as a complete one. */}
        {cap != null && rows.length >= cap && (
          <p className="text-xs text-muted-foreground">{t('jCapped', { n: cap })}</p>
        )}

        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('jEmpty')}</p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.key} className="space-y-1.5">
                {/* The day's shape — the line that answers "what did the day look like" */}
                <div className="rounded-md bg-secondary/60 px-3 py-2">
                  <p className="text-sm font-semibold">
                    {showPerson ? `${g.personName} · ` : ''}
                    {dayLabel(g.day)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {g.firstIn && g.lastOut
                      ? t('jDaySpan', { in: hhmm(g.firstIn), out: hhmm(g.lastOut) })
                      : t('jDayNoTiming')}
                    {' · '}
                    {t('jDayCount', { n: g.rows.length })}
                    {g.ratio != null && (
                      <>
                        {' · '}
                        <span className="font-medium text-foreground">
                          {t('jDayOnSite', {
                            onsite: fmtDuration(g.onSiteMin),
                            field: fmtDuration(g.fieldMin ?? 0),
                          })}
                        </span>{' '}
                        <span className="font-semibold text-primary">{g.ratio} %</span>
                        {(() => {
                          // Compare the day with its own kind of work.
                          const installs = g.rows.filter((r) => r.kind === 'install').length;
                          const ref =
                            installs > g.rows.length / 2 ? teamRatios?.install : teamRatios?.visit;
                          return ref != null ? ` (${t('jTeamAvg', { pct: ref })})` : null;
                        })()}
                      </>
                    )}
                  </p>
                </div>

                <ul className="space-y-1.5">
                  {g.rows.map((r, i) => {
                    const prev = g.rows[i - 1];
                    const gapMin =
                      prev && r.inAt
                        ? Math.round(
                            (new Date(r.inAt).getTime() - new Date(prev.outAt).getTime()) / 60_000,
                          )
                        : null;
                    return (
                      <li key={r.id}>
                        {gapMin != null && gapMin >= 0 && (
                          <p className="py-0.5 pl-1 text-[11px] text-muted-foreground">
                            ↕ {t('jGap', { d: fmtDuration(gapMin) })}
                          </p>
                        )}
                        <div className="flex items-start gap-2 rounded-lg border p-2">
                          {/* photo pair */}
                          <div className="flex shrink-0 gap-1">
                            {[r.arrivalUrl, r.completionUrl].map((u, k) =>
                              u ? (
                                <a
                                  key={k}
                                  href={u}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block h-12 w-12 overflow-hidden rounded border"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={u}
                                    alt={k === 0 ? t('jPhotoIn') : t('jPhotoOut')}
                                    className="h-full w-full object-cover"
                                  />
                                </a>
                              ) : (
                                <div
                                  key={k}
                                  className="flex h-12 w-12 items-center justify-center rounded border border-dashed text-muted-foreground"
                                  title={k === 0 ? t('jPhotoIn') : t('jPhotoOut')}
                                >
                                  {k === 0 ? <LogIn className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}
                                </div>
                              ),
                            )}
                          </div>

                          <div className="min-w-0 flex-1 space-y-0.5">
                            <p className="flex flex-wrap items-center gap-x-2 text-sm tabular-nums">
                              <span className="font-medium">
                                {r.inAt ? hhmm(r.inAt) : '—'} → {hhmm(r.outAt)}
                              </span>
                              {r.inAt && r.durationMin != null && (
                                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary">
                                  {fmtDuration(
                                    (new Date(r.outAt).getTime() - new Date(r.inAt).getTime()) / 60_000,
                                  )}
                                </span>
                              )}
                            </p>
                            <p className="truncate text-sm">
                              {r.contactId ? (
                                <Link href={`/contacts/${r.contactId}`} className="text-primary underline">
                                  {r.contactName ?? t('jContact')}
                                </Link>
                              ) : (
                                <span className="text-muted-foreground">{t('jNoContact')}</span>
                              )}
                            </p>
                            <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                              <span className="rounded bg-secondary px-1.5 py-0.5 font-medium">
                                {r.kind === 'install' ? t('jInstall') : t('jVisit')}
                              </span>
                              {r.kind === 'visit' && r.disposition && (
                                <span>{tDisp(r.disposition as never)}</span>
                              )}
                              {r.pairMeters != null && <span>· {t('jPair', { m: r.pairMeters })}</span>}
                              {r.contactMeters != null && (
                                <span>· {t('jToContact', { m: r.contactMeters })}</span>
                              )}
                            </p>
                            {r.flags.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-0.5">
                                {r.flags.map((f) => (
                                  <span
                                    key={f}
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${FLAG_STYLE[f]}`}
                                  >
                                    {t(`flag_${f}` as never)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
