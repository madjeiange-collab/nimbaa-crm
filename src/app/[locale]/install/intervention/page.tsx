import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { NewIntervention } from '@/components/install/new-intervention';

/**
 * Raise a job that no sale produced — SAV, warranty, maintenance. Open to any
 * field user: a technician taking the customer's call should not have to route
 * it through a commercial.
 */
export default async function NewInterventionPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ contact?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations('intervention');

  const supabase = await createClient();
  const [{ data: contactRows }, { data: techRows }] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, name, address, lifecycle')
      .order('updated_at', { ascending: false })
      .limit(400),
    supabase.from('users').select('id, full_name, username, role, is_active'),
  ]);

  // Customers first — an intervention is nearly always on someone we installed.
  const contacts = ((contactRows ?? []) as {
    id: string;
    name: string | null;
    address: string | null;
    lifecycle: string;
  }[])
    .sort((a, b) => Number(b.lifecycle === 'customer') - Number(a.lifecycle === 'customer'))
    .map(({ id, name, address }) => ({ id, name, address }));

  const technicians = ((techRows ?? []) as {
    id: string;
    full_name: string | null;
    username: string | null;
    role: string;
    is_active: boolean;
  }[])
    .filter((u) => u.is_active && (u.role === 'technician' || u.id === user.id))
    .map((u) => ({ id: u.id, name: u.full_name || u.username || '—' }));

  return (
    <>
      <AppHeader title={t('pageTitle')} />
      <NewIntervention
        contacts={contacts}
        technicians={technicians}
        selfId={user.id}
        presetContactId={sp.contact ?? null}
      />
    </>
  );
}
