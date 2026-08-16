import { User } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { LogoutButton } from './logout-button';
import { BrandLogo } from './brand-logo';
import { BackButton, HomeButton } from './back-button';

/** Sticky top bar for authenticated screens. */
export function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-1">
          <BackButton />
          <HomeButton />
          <Link href="/home" aria-label="Nimbaa — Accueil" className="shrink-0 pl-1">
            <BrandLogo variant="inline" />
          </Link>
          <div className="min-w-0 border-l pl-3">
            <p className="truncate text-sm font-semibold leading-tight">{title}</p>
            {subtitle && (
              <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            href="/profile"
            aria-label="Profil"
            className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
          >
            <User className="h-4 w-4" />
          </Link>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
