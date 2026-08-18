'use client';

import { ArrowLeft, Home } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { confirmDiscard } from '@/lib/ui/unsaved';

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
    // A form may hold photos that only exist in the browser — ask first.
    if (!confirmDiscard()) return;
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

/**
 * Explicit "home" control beside the back arrow — one tap back to the
 * dashboard from any depth. Hidden on Home itself.
 */
export function HomeButton() {
  const pathname = usePathname();
  const t = useTranslations('common');

  if (pathname === '/home' || pathname === '/') return null;

  return (
    <Link
      href="/home"
      aria-label={t('home')}
      onClick={(e) => {
        if (!confirmDiscard()) e.preventDefault();
      }}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent active:bg-accent"
    >
      <Home className="h-5 w-5" />
    </Link>
  );
}

/**
 * The brand logo doubles as a home link, so it needs the same guard. Kept here
 * beside the other navigation controls rather than in the server-rendered
 * header, which cannot hold an onClick.
 */
export function GuardedHomeLink({
  children,
  className,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <Link
      href="/home"
      aria-label={ariaLabel}
      className={className}
      onClick={(e) => {
        if (!confirmDiscard()) e.preventDefault();
      }}
    >
      {children}
    </Link>
  );
}
