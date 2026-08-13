'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { signOut } from '@/lib/auth/actions';
import { Button } from '@/components/ui/button';

export function LogoutButton() {
  const t = useTranslations('common');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await signOut();
          router.replace('/login');
          router.refresh();
        })
      }
      aria-label={t('logout')}
    >
      <LogOut className="h-4 w-4" />
      <span className="hidden sm:inline">{t('logout')}</span>
    </Button>
  );
}
