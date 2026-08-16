import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { TerritoryManager } from '@/components/admin/territory-manager';

export default async function AdminTerritoriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['admin']);
  const t = await getTranslations('admin');

  const supabase = await createClient();
  const [{ data: rows }, { data: geo }] = await Promise.all([
    supabase
      .from('territories')
      .select('id, name, type, description')
      .order('created_at', { ascending: false }),
    supabase.rpc('territories_geojson'),
  ]);
  const geoById = new Map<string, unknown>(
    ((geo ?? []) as { id: string; geojson: unknown }[]).map((g) => [g.id, g.geojson]),
  );
  const existing = (rows ?? []).map((r) => ({
    ...r,
    geojson: (geoById.get(r.id) ?? null) as import('geojson').Polygon | null,
  }));

  return (
    <>
      <AppHeader title={t('territoriesTitle')} subtitle={t('territoriesHint')} />
      <main className="mx-auto max-w-5xl space-y-3 p-4">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('title')}
        </Link>
        <TerritoryManager existing={existing} />
      </main>
    </>
  );
}
