'use client';

import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

/**
 * Header back control. Goes back in history (the natural "return from a
 * drill-down"), falling back to Home on a fresh/direct load. Hidden on Home,
 * which is the top of the navigation.
 */
export function BackButton() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('common');

  if (pathname === '/home' || pathname === '/') return null;

  const onBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/home');
    }
  };

  return (
    <button
      type="button"
      onClick={onBack}
      aria-label={t('back')}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent active:bg-accent"
    >
      <ArrowLeft className="h-5 w-5" />
    </button>
  );
}
