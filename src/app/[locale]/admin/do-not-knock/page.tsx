import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { DnkManager, type DnkRow } from '@/components/admin/dnk-manager';

export default async function AdminDnkPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['admin']);
  const t = await getTranslations('adminDnk');
  const tAdmin = await getTranslations('admin');

  const supabase = await createClient();
  const [{ data: rows }, { data: users }] = await Promise.all([
    supabase
      .from('do_not_knock_list')
      .select('id, lat, lng, address, reason, added_by, added_at')
      .order('added_at', { ascending: false })
      .limit(500),
    supabase.from('users').select('id, full_name, username'),
  ]);
  const nameById = new Map(
    ((users ?? []) as { id: string; full_name: string | null; username: string | null }[]).map(
      (u) => [u.id, u.full_name || u.username || null],
    ),
  );
  const entries: DnkRow[] = ((rows ?? []) as {
    id: string;
    lat: number;
    lng: number;
    address: string | null;
    reason: string | null;
    added_by: string | null;
    added_at: string;
  }[]).map((r) => ({
    id: r.id,
    lat: r.lat,
    lng: r.lng,
    address: r.address,
    reason: r.reason,
    addedAt: r.added_at,
    addedByName: r.added_by ? (nameById.get(r.added_by) ?? null) : null,
  }));

  return (
    <>
      <AppHeader title={t('title')} />
      <main className="mx-auto max-w-3xl space-y-3 p-4">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {tAdmin('title')}
        </Link>
        <DnkManager entries={entries} />
      </main>
    </>
  );
}
