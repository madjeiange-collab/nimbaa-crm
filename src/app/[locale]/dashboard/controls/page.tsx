import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { haversineMeters } from '@/lib/geo';
import { DISPOSITION_BY_KEY, type KnockDisposition } from '@/lib/visits/dispositions';
import { AppHeader } from '@/components/shared/app-header';
import { Card, CardContent } from '@/components/ui/card';
import { StatTile } from '@/components/charts/stat-tile';
import { CheckInJournal } from '@/components/dashboard/checkin-journal';
import {
  loadJournalRows,
  PAIR_DISTANCE_M,
  CONTACT_DISTANCE_M,
  MIN_ENGAGED_VISIT_MIN,
  MIN_INSTALL_MIN,
  CLOCK_DRIFT_MIN,
} from '@/lib/checkin/journal';

const WINDOW_DAYS = 14;

interface PhotoRow {
  visit_id: string | null;
  kind: 'arrival' | 'completion' | 'extra';
  lat: number | null;
  lng: number | null;
  captured_at: string | null;
  phash: string | null;
}

interface VisitRow {
  id: string;
  rep_id: string;
  contact_id: string | null;
  visit_type: string;
  disposition: string | null;
  visited_at: string;
  started_at: string | null;
  created_at: string;
  lat: number | null;
  lng: number | null;
  contacts: { name: string | null; lat: number | null; lng: number | null } | null;
}

const minutesBetween = (a: string, b: string) =>
  Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 60_000;

export default async function ControlsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['manager', 'admin']);
  const t = await getTranslations('dashboard');

  const supabase = await createClient();
  const since = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString();

  const [
    { data: visitRows, error: vErr },
    { data: photoRows },
    { data: userRows },
    { data: installRows },
    journalRows,
  ] = await Promise.all([
      supabase
        .from('visits')
        .select(
          'id, rep_id, contact_id, visit_type, disposition, visited_at, started_at, created_at, lat, lng, contacts(name, lat, lng)',
        )
        .gte('visited_at', since)
        .order('visited_at', { ascending: false })
        .limit(3000),
      // Only photos carrying forensics (0024+) — legacy rows have no captured_at.
      supabase
        .from('visit_photos')
        .select('visit_id, kind, lat, lng, captured_at, phash')
        .gte('captured_at', since)
        .limit(6000),
      supabase.from('users').select('id, full_name, username'),
      supabase
        .from('installations')
        .select('id, installer_id, started_at, completed_at, title, contact_id, contacts(name)')
        .gte('completed_at', since)
        .limit(1000),
      loadJournalRows(supabase, { sinceIso: since, limit: 150 }),
    ]);

  const nameOf = new Map(
    ((userRows ?? []) as { id: string; full_name: string | null; username: string | null }[]).map(
      (u) => [u.id, u.full_name ?? u.username ?? '—'],
    ),
  );

  const visits = (visitRows ?? []) as unknown as VisitRow[];
  const photos = (photoRows ?? []) as PhotoRow[];
  const photosByVisit = new Map<string, PhotoRow[]>();
  for (const p of photos) {
    if (!p.visit_id) continue;
    const list = photosByVisit.get(p.visit_id) ?? [];
    list.push(p);
    photosByVisit.set(p.visit_id, list);
  }

  // ---- per-visit checks -----------------------------------------------------
  type Flag = 'pairFar' | 'tooShort' | 'farFromContact' | 'clockDrift';
  const flagged: {
    visit: VisitRow;
    flags: Flag[];
    durationMin: number | null;
    pairMeters: number | null;
    contactMeters: number | null;
  }[] = [];

  for (const v of visits) {
    const ph = photosByVisit.get(v.id) ?? [];
    const arrival = ph.find((p) => p.kind === 'arrival');
    const completion = ph.find((p) => p.kind === 'completion');
    const flags: Flag[] = [];

    let pairMeters: number | null = null;
    if (arrival?.lat != null && arrival.lng != null && completion?.lat != null && completion.lng != null) {
      pairMeters = Math.round(
        haversineMeters(arrival.lat, arrival.lng, completion.lat, completion.lng),
      );
      if (pairMeters > PAIR_DISTANCE_M) flags.push('pairFar');
    }

    const durationMin = v.started_at
      ? Math.round(minutesBetween(v.started_at, v.visited_at))
      : null;
    const engaged =
      v.visit_type !== 'installation' &&
      !!(v.disposition && DISPOSITION_BY_KEY[v.disposition as KnockDisposition]?.createsContact);
    if (engaged && durationMin != null && durationMin < MIN_ENGAGED_VISIT_MIN) {
      flags.push('tooShort');
    }

    let contactMeters: number | null = null;
    const photoFix = arrival ?? completion;
    if (
      v.contacts?.lat != null &&
      v.contacts.lng != null &&
      photoFix?.lat != null &&
      photoFix.lng != null
    ) {
      contactMeters = Math.round(
        haversineMeters(photoFix.lat, photoFix.lng, v.contacts.lat, v.contacts.lng),
      );
      if (contactMeters > CONTACT_DISTANCE_M) flags.push('farFromContact');
    }

    // Device clock vs server receipt. Only for visits carrying photo
    // forensics (0024+) — legacy/seeded rows have backdated visited_at and
    // would drown the list. Offline-queued saves legitimately drift, so this
    // is a review signal, not proof.
    if (ph.length > 0 && minutesBetween(v.visited_at, v.created_at) > CLOCK_DRIFT_MIN) {
      flags.push('clockDrift');
    }

    if (flags.length > 0) flagged.push({ visit: v, flags, durationMin, pairMeters, contactMeters });
  }

  // ---- duplicate photos (same perceptual hash on several visits) ------------
  const byHash = new Map<string, Set<string>>();
  for (const p of photos) {
    if (!p.phash || !p.visit_id) continue;
    const set = byHash.get(p.phash) ?? new Set<string>();
    set.add(p.visit_id);
    byHash.set(p.phash, set);
  }
  const visitById = new Map(visits.map((v) => [v.id, v]));
  const duplicates = [...byHash.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([hash, ids]) => {
      const vs = [...ids].map((id) => visitById.get(id)).filter((v): v is VisitRow => !!v);
      return { hash, visits: vs };
    })
    .filter((d) => d.visits.length > 1);

  // ---- installations: implausibly fast completions + avg time --------------
  const installs = ((installRows ?? []) as unknown as {
    id: string;
    installer_id: string | null;
    started_at: string | null;
    completed_at: string | null;
    title: string | null;
    contact_id: string | null;
    contacts: { name: string | null } | null;
  }[]).map((i) => ({
    ...i,
    durationMin:
      i.started_at && i.completed_at ? Math.round(minutesBetween(i.started_at, i.completed_at)) : null,
  }));
  const fastInstalls = installs.filter(
    (i) => i.durationMin != null && i.durationMin < MIN_INSTALL_MIN,
  );

  // ---- time-spent averages (the positive side of the same data) ------------
  const mean = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((s, n) => s + n, 0) / xs.length) : null;

  // Time ON SITE comes from the arrival→end photo pair of each trip. (The job's
  // started_at→completed_at span is lead time, not presence: a chantier can sit
  // open for days between trips.)
  const timedVisits = visits.filter((v) => v.started_at && v.visit_type !== 'installation');
  const timedInstallTrips = visits.filter((v) => v.started_at && v.visit_type === 'installation');
  const avgAllVisitMin = mean(
    timedVisits.map((v) => minutesBetween(v.started_at as string, v.visited_at)),
  );
  const avgVisitMin = mean(
    timedVisits
      .filter(
        (v) =>
          v.disposition &&
          DISPOSITION_BY_KEY[v.disposition as KnockDisposition]?.createsContact,
      )
      .map((v) => minutesBetween(v.started_at as string, v.visited_at)),
  );
  const avgInstallMin = mean(
    timedInstallTrips.map((v) => minutesBetween(v.started_at as string, v.visited_at)),
  );

  // ---- time on site per person (visits + installations) --------------------
  const perPerson = new Map<string, { visits: number; visitMin: number; installs: number; installMin: number }>();
  const bump = (id: string | null, patch: Partial<{ visits: number; visitMin: number; installs: number; installMin: number }>) => {
    if (!id) return;
    const row = perPerson.get(id) ?? { visits: 0, visitMin: 0, installs: 0, installMin: 0 };
    perPerson.set(id, {
      visits: row.visits + (patch.visits ?? 0),
      visitMin: row.visitMin + (patch.visitMin ?? 0),
      installs: row.installs + (patch.installs ?? 0),
      installMin: row.installMin + (patch.installMin ?? 0),
    });
  };
  for (const v of timedVisits) {
    bump(v.rep_id, { visits: 1, visitMin: minutesBetween(v.started_at as string, v.visited_at) });
  }
  for (const v of timedInstallTrips) {
    bump(v.rep_id, { installs: 1, installMin: minutesBetween(v.started_at as string, v.visited_at) });
  }
  const timeRows = [...perPerson.entries()]
    .map(([id, r]) => ({
      id,
      name: nameOf.get(id) ?? '—',
      ...r,
      totalMin: Math.round(r.visitMin + r.installMin),
      avgVisit: r.visits ? Math.round(r.visitMin / r.visits) : null,
      avgInstall: r.installs ? Math.round(r.installMin / r.installs) : null,
    }))
    .filter((r) => r.visits > 0 || r.installs > 0)
    .sort((a, b) => b.totalMin - a.totalMin);

  const fmtHours = (min: number) =>
    min >= 60 ? `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')}` : `${min} min`;

  // Client-time ratio: minutes on site over the field span of each person-day
  // (first check-in → last check-out). Commercials and technicians are averaged
  // SEPARATELY — a technician spends hours on one site, so a shared average
  // would make every rep look idle by comparison.
  const ratioOver = (list: VisitRow[]): number | null => {
    const personDays = new Map<string, { onSite: number; first: number; last: number }>();
    for (const v of list) {
      const inMs = new Date(v.started_at as string).getTime();
      const outMs = new Date(v.visited_at).getTime();
      const key = `${v.rep_id}|${(v.started_at as string).slice(0, 10)}`;
      const row = personDays.get(key) ?? { onSite: 0, first: inMs, last: outMs };
      row.onSite += (outMs - inMs) / 60_000;
      row.first = Math.min(row.first, inMs);
      row.last = Math.max(row.last, outMs);
      personDays.set(key, row);
    }
    let onSite = 0;
    let field = 0;
    for (const r of personDays.values()) {
      // A day with a single stop says nothing about how the day was spent.
      if (r.last === r.first) continue;
      onSite += r.onSite;
      field += (r.last - r.first) / 60_000;
    }
    return field > 0 ? Math.round((onSite / field) * 100) : null;
  };
  const teamRatios = {
    visit: ratioOver(timedVisits),
    install: ratioOver(timedInstallTrips),
  };

  const journalPeople = [...new Map(journalRows.map((r) => [r.personId, r.personName])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const counts = {
    pairFar: flagged.filter((f) => f.flags.includes('pairFar')).length,
    tooShort: flagged.filter((f) => f.flags.includes('tooShort')).length,
    farFromContact: flagged.filter((f) => f.flags.includes('farFromContact')).length,
    clockDrift: flagged.filter((f) => f.flags.includes('clockDrift')).length,
    duplicates: duplicates.length,
    fastInstalls: fastInstalls.length,
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) +
    ' ' +
    new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  const FLAG_STYLE: Record<Flag, string> = {
    pairFar: 'bg-destructive/10 text-destructive',
    tooShort: 'bg-brand-amber/20 text-brand-brown',
    farFromContact: 'bg-destructive/10 text-destructive',
    clockDrift: 'bg-secondary text-secondary-foreground',
  };

  return (
    <>
      <AppHeader title={t('controlsTitle')} />
      <main className="mx-auto max-w-4xl space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          {t('controlsHint', { days: WINDOW_DAYS })}
        </p>
        {vErr && (
          <Card>
            <CardContent className="pt-4 text-sm text-muted-foreground">
              {t('controlsNeedsMigration')}
            </CardContent>
          </Card>
        )}

        {/* Time actually spent with customers */}
        <div className="grid grid-cols-3 gap-3">
          <StatTile
            label={t('avgAllVisitDuration')}
            value={avgAllVisitMin != null ? `${avgAllVisitMin} min` : '—'}
            accent="green"
          />
          <StatTile
            label={t('avgVisitDuration')}
            value={avgVisitMin != null ? `${avgVisitMin} min` : '—'}
            accent="green"
          />
          <StatTile
            label={t('avgInstallDuration')}
            value={avgInstallMin != null ? `${avgInstallMin} min` : '—'}
            accent="green"
          />
        </div>

        {/* Time on site, person by person */}
        <Card>
          <CardContent className="space-y-2 pt-4">
            <p className="text-sm font-semibold">{t('timePerPerson')}</p>
            {timeRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('timeNoData')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">{t('timeCol_person')}</th>
                      <th className="py-1 pr-3 text-right font-medium">{t('timeCol_visits')}</th>
                      <th className="py-1 pr-3 text-right font-medium">{t('timeCol_avgVisit')}</th>
                      <th className="py-1 pr-3 text-right font-medium">{t('timeCol_installs')}</th>
                      <th className="py-1 pr-3 text-right font-medium">{t('timeCol_avgInstall')}</th>
                      <th className="py-1 text-right font-medium">{t('timeCol_total')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {timeRows.map((r) => (
                      <tr key={r.id} className="tabular-nums">
                        <td className="py-1.5 pr-3 font-medium">{r.name}</td>
                        <td className="py-1.5 pr-3 text-right">{r.visits || '—'}</td>
                        <td className="py-1.5 pr-3 text-right">
                          {r.avgVisit != null ? `${r.avgVisit} min` : '—'}
                        </td>
                        <td className="py-1.5 pr-3 text-right">{r.installs || '—'}</td>
                        <td className="py-1.5 pr-3 text-right">
                          {r.avgInstall != null ? `${r.avgInstall} min` : '—'}
                        </td>
                        <td className="py-1.5 text-right font-semibold">{fmtHours(r.totalMin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Every passage, day by day */}
        <CheckInJournal rows={journalRows} people={journalPeople} teamRatios={teamRatios} />

        {/* Flag summary */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile label={t('flagPairFar')} value={counts.pairFar} accent={counts.pairFar ? 'red' : 'muted'} />
          <StatTile label={t('flagTooShort')} value={counts.tooShort} accent={counts.tooShort ? 'amber' : 'muted'} />
          <StatTile
            label={t('flagFarFromContact')}
            value={counts.farFromContact}
            accent={counts.farFromContact ? 'red' : 'muted'}
          />
          <StatTile
            label={t('flagClockDrift')}
            value={counts.clockDrift}
            accent={counts.clockDrift ? 'amber' : 'muted'}
          />
          <StatTile
            label={t('flagDuplicates')}
            value={counts.duplicates}
            accent={counts.duplicates ? 'red' : 'muted'}
          />
          <StatTile
            label={t('flagFastInstalls')}
            value={counts.fastInstalls}
            accent={counts.fastInstalls ? 'red' : 'muted'}
          />
        </div>

        {/* Flagged visits */}
        <Card>
          <CardContent className="space-y-2 pt-4">
            <p className="text-sm font-semibold">{t('flaggedVisits')}</p>
            {flagged.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noFlags')}</p>
            ) : (
              <ul className="divide-y">
                {flagged.slice(0, 100).map(({ visit: v, flags, durationMin, pairMeters, contactMeters }) => (
                  <li key={v.id} className="space-y-1 py-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                      <span className="font-medium">{nameOf.get(v.rep_id) ?? '—'}</span>
                      <span className="text-muted-foreground">{fmtDate(v.visited_at)}</span>
                      {v.contact_id ? (
                        <Link href={`/contacts/${v.contact_id}`} className="text-primary underline">
                          {v.contacts?.name ?? t('controlContact')}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{t('controlNoContact')}</span>
                      )}
                      {durationMin != null && (
                        <span className="text-xs text-muted-foreground">⏱ {durationMin} min</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {flags.map((f) => (
                        <span
                          key={f}
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${FLAG_STYLE[f]}`}
                        >
                          {t(`flag_${f}`)}
                          {f === 'pairFar' && pairMeters != null && ` · ${pairMeters} m`}
                          {f === 'farFromContact' && contactMeters != null && ` · ${contactMeters} m`}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Implausibly fast installations */}
        <Card>
          <CardContent className="space-y-2 pt-4">
            <p className="text-sm font-semibold">{t('fastInstallsTitle')}</p>
            {fastInstalls.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noFlags')}</p>
            ) : (
              <ul className="divide-y">
                {fastInstalls.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-2 py-2 text-sm">
                    <span className="font-medium">
                      {i.installer_id ? (nameOf.get(i.installer_id) ?? '—') : '—'}
                    </span>
                    {i.contact_id ? (
                      <Link href={`/contacts/${i.contact_id}`} className="text-primary underline">
                        {i.contacts?.name ?? '—'}
                      </Link>
                    ) : (
                      <span>{i.contacts?.name ?? '—'}</span>
                    )}
                    {i.title && <span className="text-muted-foreground">{i.title}</span>}
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                      ⏱ {i.durationMin} min
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Reused photos */}
        <Card>
          <CardContent className="space-y-2 pt-4">
            <p className="text-sm font-semibold">{t('duplicatesTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('duplicatesHint')}</p>
            {duplicates.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noFlags')}</p>
            ) : (
              <ul className="divide-y">
                {duplicates.slice(0, 50).map((d) => (
                  <li key={d.hash} className="space-y-1 py-2 text-sm">
                    <p className="text-xs font-medium text-destructive">
                      {t('duplicateGroup', { n: d.visits.length })}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                      {d.visits.map((v) => (
                        <span key={v.id} className="text-xs text-muted-foreground">
                          {nameOf.get(v.rep_id) ?? '—'} · {fmtDate(v.visited_at)}
                          {v.contact_id && (
                            <>
                              {' · '}
                              <Link href={`/contacts/${v.contact_id}`} className="text-primary underline">
                                {v.contacts?.name ?? t('controlContact')}
                              </Link>
                            </>
                          )}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
