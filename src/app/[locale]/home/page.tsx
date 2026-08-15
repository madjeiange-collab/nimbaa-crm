import { setRequestLocale, getTranslations } from 'next-intl/server';
import {
  DoorOpen,
  Map as MapIcon,
  Users,
  BarChart3,
  ShieldCheck,
  Settings,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth/session';
import { AppHeader } from '@/components/shared/app-header';
import { Card } from '@/components/ui/card';

function HomeCard({
  href,
  icon: Icon,
  title,
  hint,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  hint: string;
}) {
  return (
    <Link href={href} className="block">
      <Card className="flex min-h-[96px] items-center gap-4 p-4 transition-colors hover:bg-accent active:bg-accent">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold leading-tight">{title}</p>
          <p className="text-sm text-muted-foreground">{hint}</p>
        </div>
      </Card>
    </Link>
  );
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await requireUser();
  const t = await getTranslations('home');

  const isManager = user.role === 'manager' || user.role === 'admin';
  const isAdmin = user.role === 'admin';
  const isTechnician = user.role === 'technician';
  const displayName = user.full_name ?? user.username ?? '';
  const hasNoCapability =
    !user.can_do_b2b && !user.can_do_d2d && user.role === 'rep';

  return (
    <>
      <AppHeader title={t('greeting', { name: displayName })} />
      <main className="mx-auto max-w-3xl space-y-3 p-4">
        {/* Primary field action — always available to any rep. */}
        {(user.can_do_b2b || user.can_do_d2d) && (
          <HomeCard
            href="/visit/new"
            icon={DoorOpen}
            title={t('logVisit')}
            hint={t('logVisitHint')}
          />
        )}

        {/* Record an installation — sits right after "Enregistrer une visite".
            Technician's queue, or all open jobs for a manager. */}
        {(isTechnician || isManager) && (
          <HomeCard
            href="/installs"
            icon={Wrench}
            title={t('logInstall')}
            hint={t('logInstallHint')}
          />
        )}

        {user.can_do_d2d && (
          <HomeCard href="/turf" icon={MapIcon} title={t('myTurf')} hint={t('myTurfHint')} />
        )}

        {user.can_do_b2b && (
          <HomeCard
            href="/contacts"
            icon={Users}
            title={t('myContacts')}
            hint={t('myContactsHint')}
          />
        )}

        {(user.can_do_b2b || user.can_do_d2d) && (
          <HomeCard
            href="/stats"
            icon={BarChart3}
            title={t('commercialStats')}
            hint={t('myStatsHint')}
          />
        )}

        {/* Technician team statistics — right after "Statistiques commerciaux". */}
        {isManager && (
          <HomeCard
            href="/stats/technicians"
            icon={Wrench}
            title={t('techStats')}
            hint={t('techStatsHint')}
          />
        )}

        {/* Technician: customer lookup + own installation stats. */}
        {isTechnician && (
          <>
            <HomeCard
              href="/contacts"
              icon={Users}
              title={t('myContacts')}
              hint={t('myContactsHint')}
            />
            <HomeCard
              href="/stats"
              icon={BarChart3}
              title={t('myStats')}
              hint={t('myStatsHint')}
            />
          </>
        )}

        {hasNoCapability && (
          <Card className="p-4 text-sm text-muted-foreground">{t('noCapabilities')}</Card>
        )}

        {(isManager || isAdmin) && (
          <div className="space-y-3 pt-2">
            {isManager && (
              <HomeCard
                href="/dashboard"
                icon={ShieldCheck}
                title={t('managerArea')}
                hint=""
              />
            )}
            {isAdmin && (
              <HomeCard href="/admin" icon={Settings} title={t('adminArea')} hint="" />
            )}
          </div>
        )}
      </main>
    </>
  );
}
