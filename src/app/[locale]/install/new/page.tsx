import { setRequestLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { InstallForm } from '@/components/install/install-form';
import type { ChecklistItem, EquipmentItem, InstallStatus } from '@/types/database';

export default async function NewInstallPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ job?: string; task?: string; contact?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations('installation');

  const supabase = await createClient();

  // No job? Then this trip opens one — an SAV or a warranty call handled on the
  // spot. Same form, same protocol, one save.
  if (!sp.job) {
    const [{ data: contactRows }, { data: template }] = await Promise.all([
      supabase
        .from('contacts')
        .select('id, name, address, lifecycle')
        .order('updated_at', { ascending: false })
        .limit(400),
      supabase
        .from('install_protocol_steps')
        .select('key, label')
        .eq('is_active', true)
        .order('sort_order'),
    ]);
    const contacts = ((contactRows ?? []) as {
      id: string;
      name: string | null;
      address: string | null;
      lifecycle: string;
    }[])
      // Customers first: an intervention is nearly always somewhere we installed.
      .sort((a, b) => Number(b.lifecycle === 'customer') - Number(a.lifecycle === 'customer'))
      .map(({ id, name, address }) => ({ id, name, address }));
    const preset = sp.contact
      ? (contacts.find((c) => c.id === sp.contact) ?? null)
      : null;

    return (
      <>
        <AppHeader title={t('interventionTitle')} />
        <InstallForm
          technicianId={user.id}
          technicianName={user.full_name || user.username}
          installationId={null}
          contactId={preset?.id ?? null}
          contactName={preset?.name ?? null}
          jobTitle={null}
          initialChecklist={
            ((template ?? []) as { key: string; label: string }[]).map((s) => ({ ...s, done: false }))
          }
          initialEquipment={null}
          initialStatus={null}
          contacts={contacts}
          taskId={sp.task ?? null}
        />
      </>
    );
  }

  const { data: install } = await supabase
    .from('installations')
    .select('id, title, status, checklist, equipment, contact_id, contacts(id, name), deals(title, value_xof)')
    .eq('id', sp.job)
    .maybeSingle();
  if (!install) redirect({ href: '/installs', locale });
  // The to-one `contacts`/`deals` embeds mis-infer as arrays on the untyped client.
  const job = install as unknown as {
    id: string;
    title: string | null;
    status: InstallStatus;
    checklist: ChecklistItem[] | null;
    equipment: EquipmentItem[] | null;
    contact_id: string;
    contacts: { id: string; name: string | null } | null;
    deals: { title: string | null; value_xof: number | null } | null;
  };

  return (
    <>
      <AppHeader title={t('title')} />
      <InstallForm
        technicianId={user.id}
        technicianName={user.full_name || user.username}
        installationId={job.id}
        contactId={job.contact_id}
        contactName={job.contacts?.name ?? null}
        jobTitle={job.deals?.title ?? job.title}
        initialChecklist={job.checklist ?? null}
        initialEquipment={job.equipment ?? null}
        initialStatus={job.status ?? null}
        taskId={sp.task ?? null}
      />
    </>
  );
}
