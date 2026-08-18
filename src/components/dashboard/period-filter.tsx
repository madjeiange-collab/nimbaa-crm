'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { PERIODS, type Period } from '@/lib/checkin/period';

/**
 * Window picker for Check-In and -Out. Writes ?p= so the server re-queries —
 * the durations, the per-person totals and the checks all have to move
 * together, which client-side filtering could not do.
 */
export function PeriodFilter({ active }: { active: Period }) {
  const t = useTranslations('dashboard');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function choose(p: Period) {
    const next = new URLSearchParams(params.toString());
    next.set('p', p);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  return (
    <div
      className={`flex flex-wrap gap-1.5 ${isPending ? 'opacity-60' : ''}`}
      role="group"
      aria-label={t('periodLabel')}
    >
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => choose(p)}
          aria-pressed={p === active}
          className={`min-h-touch rounded-full border px-3 py-1 text-sm font-medium transition ${
            p === active
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-input bg-background hover:bg-accent'
          }`}
        >
          {t(`period_${p}` as never)}
        </button>
      ))}
    </div>
  );
}
