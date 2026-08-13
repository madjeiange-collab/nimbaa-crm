import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { PhotoAudit, type PhotoItem } from '@/components/dashboard/photo-audit';

export default async function PhotosPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['manager', 'admin']);
  const t = await getTranslations('dashboard');

  const supabase = await createClient();

  const [{ data: photos }, { data: users }, { data: turfs }] = await Promise.all([
    supabase
      .from('visit_photos')
      .select('id, storage_path, taken_at, visits(rep_id, disposition, visited_at, lat, lng)')
      .order('taken_at', { ascending: false })
      .limit(80),
    supabase.from('users').select('id, full_name, username'),
    supabase.rpc('territories_geojson'),
  ]);

  const name = new Map<string, string>(
    (users ?? []).map((u: { id: string; full_name: string | null; username: string | null }) => [
      u.id,
      u.full_name ?? u.username ?? '—',
    ]),
  );

  const territories = (
    (turfs ?? []) as { id: string; name: string; geojson?: { coordinates?: number[][][] } }[]
  )
    .filter((r) => r.geojson?.coordinates)
    .map((r) => ({ id: r.id, name: r.name, coordinates: r.geojson!.coordinates as number[][][] }));

  type Row = {
    id: string;
    storage_path: string;
    taken_at: string;
    visits: {
      rep_id: string;
      disposition: string | null;
      visited_at: string;
      lat: number | null;
      lng: number | null;
    } | null;
  };
  const rows = (photos ?? []) as unknown as Row[];

  const paths = rows.map((r) => r.storage_path);
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: urls } = await supabase.storage.from('visit-photos').createSignedUrls(paths, 3600);
    for (const u of urls ?? []) if (u.signedUrl && u.path) signed.set(u.path, u.signedUrl);
  }

  const items: PhotoItem[] = rows
    .map((r) => ({
      id: r.id,
      url: signed.get(r.storage_path) ?? '',
      repId: r.visits?.rep_id ?? '',
      repName: r.visits?.rep_id ? (name.get(r.visits.rep_id) ?? '—') : '—',
      disposition: r.visits?.disposition ?? null,
      at: r.taken_at,
      lat: r.visits?.lat ?? null,
      lng: r.visits?.lng ?? null,
    }))
    .filter((i) => i.url);

  return (
    <>
      <AppHeader title={t('photosTitle')} />
      <main className="mx-auto max-w-3xl space-y-3 p-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('title')}
        </Link>
        <PhotoAudit items={items} territories={territories} />
      </main>
    </>
  );
}
