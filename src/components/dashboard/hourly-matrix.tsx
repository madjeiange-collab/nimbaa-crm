'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Phone, MessageCircle, ChevronDown, AlertTriangle } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { whatsappUrl } from '@/lib/phone';
import type { JournalRow } from '@/lib/checkin/journal';
import {
  FIRST_HOUR,
  LAST_HOUR,
  hm,
  totalsOf,
  type HourCell,
  type HourlyRow,
} from '@/lib/checkin/hourly';

const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);

const clock = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Abidjan',
  }).format(new Date(iso));

/** Outcome → the colour it contributes to a cell's fill. */
const OUTCOME_FILL: Record<string, string> = {
  sold: 'bg-knock-green/25',
  done: 'bg-knock-green/25',
  interested: 'bg-brand-amber/30',
  appointment_set: 'bg-brand-amber/30',
  needs_revisit: 'bg-brand-amber/30',
  refused: 'bg-destructive/20',
  in_progress: 'bg-primary/15',
};

/**
 * One hour for one person. The number is the count, the fill is divided in
 * proportion to what the hour produced, and the bar underneath is minutes on
 * site. Tinting the whole cell to the best outcome — which is what a naive
 * version does — makes one sale in four look identical to four in four.
 */
function Cell({ cell, kind }: { cell: HourCell; kind: 'visit' | 'install' }) {
  if (cell.count === 0) return <span className="text-muted-foreground">·</span>;

  const other = cell.count - cell.won - cell.warm - cell.refused;
  const slices: { n: number; cls: string }[] = [
    { n: cell.won, cls: kind === 'install' ? OUTCOME_FILL.done : OUTCOME_FILL.sold },
    { n: cell.warm, cls: OUTCOME_FILL.interested },
    { n: cell.refused, cls: OUTCOME_FILL.refused },
    { n: other, cls: kind === 'install' ? OUTCOME_FILL.in_progress : 'bg-muted' },
  ].filter((s) => s.n > 0);

  // 60 min of presence fills the bar; beyond that it simply stays full.
  const barPct = Math.min(100, Math.round(((cell.minutes || 0) / 60) * 100));

  return (
    <span className="relative inline-flex min-w-[38px] flex-col items-center gap-0.5 overflow-hidden rounded p-1">
      <span className="absolute inset-0 flex" aria-hidden>
        {slices.map((s, i) => (
          <span key={i} className={s.cls} style={{ flex: s.n }} />
        ))}
      </span>
      <span className="relative text-sm leading-none">{cell.count}</span>
      <span className="relative text-[9px] leading-none">
        {cell.won > 0 && <span className="text-knock-green">{cell.won}✓ </span>}
        {cell.warm > 0 && (
          <span className="text-brand-brown">
            {cell.warm}
            {kind === 'install' ? '↻' : '●'}{' '}
          </span>
        )}
        {cell.refused > 0 && <span className="text-destructive">{cell.refused}✕</span>}
        {cell.won + cell.warm + cell.refused === 0 && ' '}
      </span>
      <span
        className="relative h-[3px] rounded bg-foreground/25"
        style={{ width: `${Math.max(8, barPct)}%` }}
      />
    </span>
  );
}

/** The day of one person, passage by passage, with the travel time between. */
function Drilldown({
  row,
  passages,
  phone,
  goal,
}: {
  row: HourlyRow;
  passages: JournalRow[];
  phone: string | null;
  goal: number | null;
}) {
  const t = useTranslations('hourly');
  const tDisp = useTranslations('dispositions');
  const tStatus = useTranslations('installation.status');
  const tFlag = useTranslations('dashboard');
  const wa = phone ? whatsappUrl(phone) : null;

  const label = (d: string | null) => {
    if (!d) return '—';
    return row.kind === 'install'
      ? tStatus(d as never)
      : tDisp(d as never);
  };
  const tone = (d: string | null) =>
    d === 'sold' || d === 'done'
      ? 'bg-knock-green/15 text-knock-green'
      : d === 'refused'
        ? 'bg-destructive/10 text-destructive'
        : d === 'interested' || d === 'appointment_set' || d === 'needs_revisit'
          ? 'bg-brand-amber/20 text-brand-brown'
          : 'bg-muted text-muted-foreground';

  return (
    <div className="space-y-3 bg-muted/30 p-4 text-left">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{row.personName}</p>
          <p className="text-xs text-muted-foreground">
            {row.lastAt
              ? t('lastReceived', { time: clock(row.lastAt), client: row.lastContact ?? '—' })
              : t('nothingYet')}
            {goal ? ` · ${t('goal', { n: goal })}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          {phone && (
            <a
              href={`tel:${phone}`}
              className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium"
            >
              <Phone className="h-3.5 w-3.5" /> {t('call')}
            </a>
          )}
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-knock-green"
            >
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </a>
          )}
        </div>
      </div>

      {passages.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noPassages')}</p>
      ) : (
        <ol className="ml-1 space-y-0 border-l-2 border-border pl-3">
          {passages.map((p, i) => {
            const prev = passages[i - 1];
            // The gap the matrix cannot show: an empty hour is often the road.
            const travel =
              prev && p.inAt
                ? Math.round(
                    (new Date(p.inAt).getTime() - new Date(prev.outAt).getTime()) / 60_000,
                  )
                : null;
            return (
              <li key={p.id}>
                {travel != null && travel > 0 && (
                  <p className="py-0.5 text-[11px] text-muted-foreground">
                    ↓ {t('travel', { n: travel })}
                  </p>
                )}
                <div className="grid grid-cols-[86px_1fr_auto] items-baseline gap-2 py-1">
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {p.inAt ? `${clock(p.inAt)} → ` : ''}
                    {clock(p.outAt)}
                  </span>
                  <span className="min-w-0 text-sm">
                    {p.contactId ? (
                      <Link href={`/contacts/${p.contactId}`} className="underline">
                        {p.contactName ?? '—'}
                      </Link>
                    ) : (
                      (p.contactName ?? t('noContact'))
                    )}
                    {p.flags.length > 0 && (
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-destructive">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        {p.flags.map((f) => tFlag(`flag_${f}` as never)).join(' · ')}
                      </span>
                    )}
                    {(p.arrivalUrl || p.completionUrl) && (
                      <span className="mt-1 flex gap-1">
                        {[p.arrivalUrl, p.completionUrl].filter(Boolean).map((u, k) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={k}
                            src={u as string}
                            alt=""
                            className="h-6 w-6 rounded border object-cover"
                          />
                        ))}
                      </span>
                    )}
                  </span>
                  <span
                    className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] ${tone(p.disposition)}`}
                  >
                    {label(p.disposition)}
                    {p.durationMin != null ? ` · ${p.durationMin} min` : ''}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Section({
  title,
  rows,
  passages,
  phones,
  goals,
  pipeline,
  showMoney,
  open,
  onToggle,
}: {
  title: string;
  rows: HourlyRow[];
  passages: Record<string, JournalRow[]>;
  phones: Record<string, string | null>;
  goals: Record<string, number>;
  pipeline: Record<string, number>;
  showMoney: boolean;
  open: string | null;
  onToggle: (id: string) => void;
}) {
  const t = useTranslations('hourly');
  if (rows.length === 0) return null;
  const tot = totalsOf(rows);
  const isTech = rows[0].kind === 'install';

  return (
    <>
      <tr>
        <td colSpan={HOURS.length + (showMoney ? 10 : 9)} className="bg-muted/50 px-3 py-1.5 text-left text-xs text-muted-foreground">
          {title}
        </td>
      </tr>
      {rows.map((r) => (
        <>
          <tr key={r.personId} className="border-b">
            <td className="sticky left-0 z-10 bg-card px-3 py-1 text-left font-medium">
              <button
                type="button"
                onClick={() => onToggle(r.personId)}
                className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-4"
              >
                {r.personName}
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${open === r.personId ? 'rotate-180' : ''}`}
                />
              </button>
            </td>
            {r.cells.map((c) => (
              <td key={c.hour} className="px-0.5 py-1 text-center">
                <Cell cell={c} kind={r.kind} />
              </td>
            ))}
            <td className="border-l px-1.5 text-center text-sm font-medium">{r.total}</td>
            <td className="px-1.5 text-center text-sm text-muted-foreground">{hm(r.minutes)}</td>
            <td className="px-1.5 text-center text-sm">{r.avgMin != null ? `${r.avgMin} min` : '—'}</td>
            <td className="border-l px-1.5 text-center text-sm">{r.won || '—'}</td>
            <td className="px-1.5 text-center text-sm">{r.warm || '—'}</td>
            <td className="px-1.5 text-center text-sm">{isTech ? '—' : r.refused || '—'}</td>
            <td className="border-l px-1.5 text-center text-sm">
              {r.engagementPct != null ? `${r.engagementPct} %` : '—'}
            </td>
            <td className="px-1.5 text-center text-sm">
              {r.conversionPct != null ? `${r.conversionPct} %` : '—'}
            </td>
            {showMoney && (
              <td className="px-1.5 text-center text-sm text-muted-foreground">
                {pipeline[r.personId] ? `${pipeline[r.personId].toLocaleString('fr-FR')} F` : '—'}
              </td>
            )}
          </tr>
          {open === r.personId && (
            <tr key={`${r.personId}-open`}>
              <td colSpan={HOURS.length + (showMoney ? 10 : 9)} className="p-0">
                <Drilldown
                  row={r}
                  passages={passages[r.personId] ?? []}
                  phone={phones[r.personId] ?? null}
                  goal={goals[r.personId] ?? null}
                />
              </td>
            </tr>
          )}
        </>
      ))}
      <tr className="border-b-0 font-medium text-muted-foreground">
        <td className="sticky left-0 z-10 bg-card px-3 py-1.5 text-left">{t('teamRow')}</td>
        {tot.cells.map((n, i) => (
          <td key={i} className="px-0.5 text-center text-sm">
            {n || '·'}
          </td>
        ))}
        <td className="border-l px-1.5 text-center text-sm">{tot.total}</td>
        <td className="px-1.5 text-center text-sm">{hm(tot.minutes)}</td>
        <td className="px-1.5 text-center text-sm">{tot.avgMin != null ? `${tot.avgMin} min` : '—'}</td>
        <td className="border-l px-1.5 text-center text-sm">{tot.won || '—'}</td>
        <td className="px-1.5 text-center text-sm">{tot.warm || '—'}</td>
        <td className="px-1.5 text-center text-sm">{isTech ? '—' : tot.refused || '—'}</td>
        <td className="border-l px-1.5 text-center text-sm">
          {tot.engagementPct != null ? `${tot.engagementPct} %` : '—'}
        </td>
        <td className="px-1.5 text-center text-sm">
          {tot.conversionPct != null ? `${tot.conversionPct} %` : '—'}
        </td>
        {showMoney && <td />}
      </tr>
    </>
  );
}

export function HourlyMatrix({
  commercial,
  technical,
  passages,
  phones,
  goals,
  pipeline,
  showMoney,
}: {
  commercial: HourlyRow[];
  technical: HourlyRow[];
  passages: Record<string, JournalRow[]>;
  phones: Record<string, string | null>;
  goals: Record<string, number>;
  pipeline: Record<string, number>;
  showMoney: boolean;
}) {
  const t = useTranslations('hourly');
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));

  if (commercial.length === 0 && technical.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('nothingToday')}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[980px] border-collapse text-sm [font-variant-numeric:tabular-nums]">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-normal">
              {t('person')}
            </th>
            {HOURS.map((h) => (
              <th key={h} className="px-0.5 py-2 font-normal">
                {h}h
              </th>
            ))}
            <th className="border-l px-1.5 font-normal">{t('passages')}</th>
            <th className="px-1.5 font-normal">{t('duration')}</th>
            <th className="px-1.5 font-normal">{t('avg')}</th>
            <th className="border-l px-1.5 font-normal">{t('won')}</th>
            <th className="px-1.5 font-normal">{t('warm')}</th>
            <th className="px-1.5 font-normal">{t('refused')}</th>
            <th className="border-l px-1.5 font-normal">{t('engagement')}</th>
            <th className="px-1.5 font-normal">{t('conversion')}</th>
            {showMoney && <th className="px-1.5 font-normal">{t('pipeline')}</th>}
          </tr>
        </thead>
        <tbody>
          <Section
            title={t('sectionCommercial')}
            rows={commercial}
            passages={passages}
            phones={phones}
            goals={goals}
            pipeline={pipeline}
            showMoney={showMoney}
            open={open}
            onToggle={toggle}
          />
          <Section
            title={t('sectionTechnical')}
            rows={technical}
            passages={passages}
            phones={phones}
            goals={goals}
            pipeline={pipeline}
            showMoney={showMoney}
            open={open}
            onToggle={toggle}
          />
        </tbody>
      </table>
    </div>
  );
}
