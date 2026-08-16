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
  searchParams: Promise<{ job?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations('installation');

  // A target installation job is required.
  if (!sp.job) redirect({ href: '/installs', locale });

  const supabase = await createClient();

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
      />
    </>
  );
}
