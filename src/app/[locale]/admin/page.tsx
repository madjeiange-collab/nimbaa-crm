import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Map as MapIcon, Users, ListChecks, Upload, Ban, DoorOpen, Sparkles, Trophy, Wrench, Package, type LucideIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { AppHeader } from '@/components/shared/app-header';
import { Card } from '@/components/ui/card';

function AdminLink({
  href,
  icon: Icon,
  label,
  ready,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  ready: boolean;
}) {
  const inner = (
    <Card
      className={`flex min-h-[72px] items-center gap-3 p-4 ${
        ready ? 'transition-colors hover:bg-accent' : 'opacity-50'
      }`}
    >
      <Icon className="h-5 w-5 text-primary" />
      <span className="font-medium">{label}</span>
      {!ready && <span className="ml-auto text-xs text-muted-foreground">bientôt</span>}
    </Card>
  );
  return ready ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    <div>{inner}</div>
  );
}

export default async function AdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['admin']);
  const t = await getTranslations('admin');

  return (
    <>
      <AppHeader title={t('title')} />
      <main className="mx-auto max-w-3xl space-y-3 p-4">
        {/* Phase 1: territories are live; the rest arrive in Phase 6. */}
        <AdminLink href="/admin/territories" icon={MapIcon} label={t('territories')} ready />
        <AdminLink href="/admin/products" icon={Package} label={t('products')} ready />
        <AdminLink href="/admin/protocol" icon={Wrench} label={t('protocol')} ready />
        <AdminLink href="/admin/users" icon={Users} label={t('users')} ready />
        <AdminLink href="/admin/points" icon={Trophy} label={t('points')} ready />
        <AdminLink href="/admin/dispositions" icon={DoorOpen} label={t('dispositions')} ready />
        <AdminLink href="/admin/recap" icon={Sparkles} label={t('recap')} ready />
        <AdminLink href="/admin/stages" icon={ListChecks} label={t('stages')} ready />
        <AdminLink href="/admin/import" icon={Upload} label={t('import')} ready={false} />
        <AdminLink href="/admin/do-not-knock" icon={Ban} label={t('doNotKnock')} ready={false} />
      </main>
    </>
  );
}
