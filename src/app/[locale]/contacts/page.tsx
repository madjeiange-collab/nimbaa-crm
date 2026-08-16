import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { ContactsList, type ContactRow } from '@/components/contacts/contacts-list';

export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string; mine?: string; scope?: string }>;
}) {
  const { locale } = await params;
  const { tab, mine, scope: scopeParam } = await searchParams;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations('contacts');

  const validTabs = ['all', 'lead', 'customer', 'lost'] as const;
  const initialTab = (validTabs as readonly string[]).includes(tab ?? '')
    ? (tab as (typeof validTabs)[number])
    : 'all';

  const supabase = await createClient();

  // Field roles land on THEIR book of business first; one tap widens to the
  // whole team. Managers/admins default to everything. (?mine=1 is the legacy
  // param from the stats drill-downs.)
  const isField = user.role === 'rep' || user.role === 'technician';
  const scope: 'mine' | 'all' =
    scopeParam === 'all' ? 'all' : scopeParam === 'mine' || mine || isField ? 'mine' : 'all';

  let contactsQuery = supabase
    .from('contacts')
    .select('id, name, lifecycle, priority, address, updated_at, pipeline_stage_id, territory_id')
    .order('updated_at', { ascending: false })
    .limit(500);
  let emptyMine = false;
  if (scope === 'mine') {
    if (user.role === 'technician') {
      // A technician's allocation = customers where they have an installation.
      const { data: myJobs } = await supabase
        .from('installations')
        .select('contact_id')
        .eq('installer_id', user.id);
      const ids = [...new Set((myJobs ?? []).map((j) => j.contact_id).filter(Boolean))];
      if (ids.length === 0) emptyMine = true;
      else contactsQuery = contactsQuery.in('id', ids);
    } else {
      contactsQuery = contactsQuery.eq('assigned_rep_id', user.id);
    }
  }

  const [{ data: contacts }, { data: stages }, { data: territories }] = await Promise.all([
    emptyMine ? Promise.resolve({ data: [] as never[] }) : contactsQuery,
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
      {isField && (
        <div className="mx-auto max-w-3xl px-4 pt-4">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {(['mine', 'all'] as const).map((s) => (
              <Link
                key={s}
                href={`/contacts?scope=${s}${initialTab !== 'all' ? `&tab=${initialTab}` : ''}`}
                className={`rounded-md px-3 py-1.5 text-center text-sm font-medium ${
                  scope === s ? 'bg-background shadow' : 'text-muted-foreground'
                }`}
              >
                {s === 'mine' ? t('scopeMine') : t('scopeAll')}
              </Link>
            ))}
          </div>
        </div>
      )}
      <ContactsList rows={rows} territories={territoryList} initialTab={initialTab} />
    </>
  );
}
