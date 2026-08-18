'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { shiftDay } from '@/lib/checkin/day';

const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Weeks of a month, Monday first, with blanks either side. */
function monthGrid(year: number, month: number): (string | null)[][] {
  const lead = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(ymd(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

/**
 * The day this page is showing, and the way to another one.
 *
 * The arrows step a day at a time — what you do inside a review meeting. The
 * calendar is for jumping. It is hand-rolled rather than a native date input
 * for one reason: the dots. Most days you flip back through are Sundays or
 * months before the CRM existed, and a native picker cannot show which days
 * actually have passages in them.
 */
export function DayPicker({
  day,
  today,
  activeDays,
  minDay,
}: {
  day: string;
  today: string;
  /** Days with at least one passage — the dots, and what enables a month. */
  activeDays: string[];
  minDay: string;
}) {
  const t = useTranslations('hourly');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<'day' | 'month'>('day');
  const [view, setView] = useState(() => ({
    y: Number(day.slice(0, 4)),
    m: Number(day.slice(5, 7)) - 1,
  }));
  const [focus, setFocus] = useState(day);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const active = useMemo(() => new Set(activeDays), [activeDays]);
  const monthsWithData = useMemo(() => {
    const s = new Set<string>();
    for (const d of activeDays) s.add(d.slice(0, 7));
    return s;
  }, [activeDays]);

  const yesterday = shiftDay(today, -1);
  const clamp = (d: string) => (d > today ? today : d < minDay ? minDay : d);

  function go(next: string) {
    const q = new URLSearchParams(params.toString());
    if (next === today) q.delete('d');
    else q.set('d', next);
    const qs = q.toString();
    setOpen(false);
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  }

  // Close on an outside touch or Escape. No overlay: the page underneath stays
  // readable while the calendar is open.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLevel('day');
    setFocus(day);
    setView({ y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)) - 1 });
    panel.current?.focus();
  }, [open, day]);

  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(
          new Date(Date.UTC(2024, 0, 1 + i)), // 1 Jan 2024 was a Monday
        ),
      ),
    [locale],
  );
  const fmt = (opts: Intl.DateTimeFormatOptions, d: string) =>
    new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));

  const monthLabel = fmt({ month: 'long', year: 'numeric' }, ymd(view.y, view.m, 1));
  const stepMonth = (n: number) => {
    const d = new Date(Date.UTC(view.y, view.m + n, 1));
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  };
  const viewFirst = ymd(view.y, view.m, 1);
  const canPrevMonth = viewFirst > `${minDay.slice(0, 7)}-01`;
  const canNextMonth = viewFirst < `${today.slice(0, 7)}-01`;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') return setOpen(false);
    if (level !== 'day') return;
    const by: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: string;
    if (by[e.key] != null) next = shiftDay(focus, by[e.key]);
    else if (e.key === 'PageUp' || e.key === 'PageDown') {
      const d = new Date(`${focus}T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + (e.key === 'PageUp' ? -1 : 1));
      next = d.toISOString().slice(0, 10);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      return go(focus);
    } else return;
    e.preventDefault();
    const c = clamp(next);
    setFocus(c);
    setView({ y: Number(c.slice(0, 4)), m: Number(c.slice(5, 7)) - 1 });
  }

  const chip = (on: boolean) =>
    `min-h-touch rounded-full border px-3 py-1 text-sm font-medium transition ${
      on ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background hover:bg-accent'
    }`;
  const arrow = 'rounded-md border border-input bg-background p-1.5 disabled:opacity-30';

  return (
    <div className={`flex flex-wrap items-center gap-2 ${isPending ? 'opacity-60' : ''}`}>
      <div ref={box} className="relative flex items-center gap-1">
        <button
          type="button"
          className={arrow}
          disabled={day <= minDay}
          onClick={() => go(shiftDay(day, -1))}
          aria-label={t('prevDay')}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex min-h-touch items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1 text-sm font-medium"
        >
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          {fmt({ weekday: 'short', day: 'numeric', month: 'long' }, day)}
        </button>

        <button
          type="button"
          className={arrow}
          disabled={day >= today}
          onClick={() => go(shiftDay(day, 1))}
          aria-label={t('nextDay')}
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        {open && (
          <div
            ref={panel}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            role="dialog"
            aria-label={t('pickDay')}
            className="absolute left-0 top-full z-30 mt-1 w-[268px] max-w-[calc(100vw-2rem)] rounded-lg border bg-card p-2.5 shadow-lg outline-none"
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <button
                type="button"
                className={arrow}
                disabled={level === 'day' ? !canPrevMonth : view.y <= Number(minDay.slice(0, 4))}
                onClick={() =>
                  level === 'day' ? stepMonth(-1) : setView((v) => ({ ...v, y: v.y - 1 }))
                }
                aria-label={level === 'day' ? t('prevMonth') : t('prevYear')}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setLevel((l) => (l === 'day' ? 'month' : 'day'))}
                className="rounded-md border border-input bg-background px-2.5 py-1 text-sm"
              >
                {level === 'day' ? `${monthLabel} ▾` : view.y}
              </button>
              <button
                type="button"
                className={arrow}
                disabled={level === 'day' ? !canNextMonth : view.y >= Number(today.slice(0, 4))}
                onClick={() =>
                  level === 'day' ? stepMonth(1) : setView((v) => ({ ...v, y: v.y + 1 }))
                }
                aria-label={level === 'day' ? t('nextMonth') : t('nextYear')}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {level === 'month' ? (
              <div className="grid grid-cols-3 gap-1">
                {Array.from({ length: 12 }, (_, m) => {
                  const key = `${view.y}-${String(m + 1).padStart(2, '0')}`;
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={!monthsWithData.has(key)}
                      onClick={() => {
                        setView({ y: view.y, m });
                        setLevel('day');
                      }}
                      className={`rounded-md py-2 text-sm disabled:opacity-30 ${
                        key === day.slice(0, 7) ? 'bg-primary/10 text-primary' : 'hover:bg-accent'
                      }`}
                    >
                      {fmt({ month: 'short' }, ymd(view.y, m, 1))}
                    </button>
                  );
                })}
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    {weekdays.map((w, i) => (
                      <th key={i} className="pb-1 text-[10px] font-normal text-muted-foreground">
                        {w}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthGrid(view.y, view.m).map((week, i) => (
                    <tr key={i}>
                      {week.map((d, j) => {
                        if (!d) return <td key={j} />;
                        return (
                          <td key={j} className="p-0 text-center">
                            <button
                              type="button"
                              disabled={d > today || d < minDay}
                              onClick={() => go(d)}
                              onMouseEnter={() => setFocus(d)}
                              className={`flex h-8 w-full flex-col items-center justify-center gap-0.5 rounded-md text-xs disabled:opacity-25 ${
                                d === day
                                  ? 'bg-primary text-primary-foreground'
                                  : d === focus
                                    ? 'bg-accent'
                                    : ''
                              } ${d === today && d !== day ? 'ring-1 ring-inset ring-border' : ''}`}
                            >
                              {Number(d.slice(8))}
                              <span
                                aria-hidden
                                className={`h-1 w-1 rounded-full ${
                                  !active.has(d)
                                    ? 'bg-transparent'
                                    : d === day
                                      ? 'bg-primary-foreground'
                                      : 'bg-primary'
                                }`}
                              />
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-1.5 px-0.5 text-[11px] leading-snug text-muted-foreground">
              {t('dotHint')}
            </p>
          </div>
        )}
      </div>

      <button type="button" className={chip(day === today)} onClick={() => go(today)}>
        {t('today')}
      </button>
      <button type="button" className={chip(day === yesterday)} onClick={() => go(yesterday)}>
        {t('yesterday')}
      </button>
    </div>
  );
}
