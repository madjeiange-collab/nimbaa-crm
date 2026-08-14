import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { ContactsList, type ContactRow } from '@/components/contacts/contacts-list';

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale } = await params;
  const { tab } = await searchParams;
  setRequestLocale(locale);
  await requireUser();
  const t = await getTranslations('contacts');

  const validTabs = ['all', 'lead', 'customer', 'lost'] as const;
  const initialTab = (validTabs as readonly string[]).includes(tab ?? '')
    ? (tab as (typeof validTabs)[number])
    : 'all';

  const supabase = await createClient();

  const [{ data: contacts }, { data: stages }, { data: territories }] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, name, lifecycle, priority, address, updated_at, pipeline_stage_id, territory_id')
      .order('updated_at', { ascending: false })
      .limit(500),
    supabase.from('pipeline_stages').select('id, name'),
    supabase.from('territories').select('id, name').order('name'),
  ]);

  const stageName = new Map<string, string>(
    (stages ?? []).map((s: { id: string; name: string }) => [s.id, s.name]),
  );

  const rows: ContactRow[] = (contacts ?? []).map(
    (c: {
      id: string;
      name: string | null;
      lifecycle: ContactRow['lifecycle'];
      priority: ContactRow['priority'];
      address: string | null;
      updated_at: string;
      pipeline_stage_id: string | null;
      territory_id: string | null;
    }) => ({
      id: c.id,
      name: c.name,
      lifecycle: c.lifecycle,
      priority: c.priority,
      address: c.address,
      updatedAt: c.updated_at,
      stageName: c.pipeline_stage_id ? (stageName.get(c.pipeline_stage_id) ?? null) : null,
      territoryId: c.territory_id,
    }),
  );

  const territoryList = ((territories ?? []) as { id: string; name: string }[]).map((tr) => ({
    id: tr.id,
    name: tr.name,
  }));

  return (
    <>
      <AppHeader title={t('title')} />
      <ContactsList rows={rows} territories={territoryList} initialTab={initialTab} />
    </>
  );
}
