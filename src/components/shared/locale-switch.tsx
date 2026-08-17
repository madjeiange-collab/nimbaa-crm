'use client';

import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

/** FR/EN toggle — switches the locale while staying on the same page. */
export function LocaleSwitch() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="flex gap-1 rounded-lg bg-muted p-1 text-xs font-semibold">
      {(['fr', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => router.replace(pathname, { locale: l })}
          aria-pressed={locale === l}
          className={`rounded-md px-3 py-1.5 uppercase ${
            locale === l ? 'bg-background shadow' : 'text-muted-foreground'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
