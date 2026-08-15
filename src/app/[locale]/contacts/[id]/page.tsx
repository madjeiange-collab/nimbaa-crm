import { setRequestLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { ContactDetail } from '@/components/contacts/contact-detail';
import type {
  TimelineItem,
  ContactFull,
  Stage,
  RepOption,
} from '@/components/contacts/contact-detail';
import type { InstallJob } from '@/components/contacts/installation-card';

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations('contacts');

  const supabase = await createClient();

  const { data: contact } = await supabase
    .from('contacts')
    .select(
      'id, name, phone, address, lat, lng, lifecycle, priority, pipeline_stage_id, value_xof, tags, lost_reason, assigned_rep_id, created_at',
    )
    .eq('id', id)
    .maybeSingle();

  if (!contact) notFound();

  // Installation jobs are fetched separately so a pre-migration DB degrades to
  // "no jobs" instead of 404ing the whole contact page.
  const [{ data: stages }, { data: activities }, { data: visits }, { data: users }, { data: installs }] =
    await Promise.all([
      supabase.from('pipeline_stages').select('id, name, sort_order, is_won, is_lost').order('sort_order'),
      supabase.from('activities').select('id, type, content, created_at, rep_id').eq('contact_id', id).order('created_at', { ascending: false }),
      supabase.from('visits').select('id, disposition, notes, visited_at, rep_id, visit_photos(storage_path)').eq('contact_id', id).order('visited_at', { ascending: false }),
      supabase.from('users').select('id, full_name, username, role'),
      supabase
        .from('installations')
        .select('id, title, status, installer_id, scheduled_date, next_visit_date, checklist, equipment, created_at')
        .eq('contact_id', id)
        .order('created_at', { ascending: true }),
    ]);

  type UserRow = {
    id: string;
    full_name: string | null;
    username: string | null;
    role?: string;
  };
  const nameOf = new Map<string, string>(
    (users ?? []).map((u: UserRow) => [u.id, u.full_name ?? u.username ?? '—']),
  );
  const reps: RepOption[] = (users ?? []).map((u: UserRow) => ({
    id: u.id,
    name: u.full_name ?? u.username ?? '—',
  }));
  const technicians: RepOption[] = (users ?? [])
    .filter((u: UserRow) => u.role === 'technician')
    .map((u: UserRow) => ({ id: u.id, name: u.full_name ?? u.username ?? '—' }));

  // Sign the visit photos (private bucket) so the detail can show thumbnails.
  const photoPaths: string[] = [];
  for (const v of visits ?? []) {
    for (const p of (v.visit_photos ?? []) as { storage_path: string }[]) photoPaths.push(p.storage_path);
  }
  const signed = new Map<string, string>();
  if (photoPaths.length > 0) {
    const { data: urls } = await supabase.storage
      .from('visit-photos')
      .createSignedUrls(photoPaths, 3600);
    for (const u of urls ?? []) {
      if (u.signedUrl && u.path) signed.set(u.path, u.signedUrl);
    }
  }

  const timeline: TimelineItem[] = [
    ...(visits ?? []).map(
      (v: {
        id: string;
        disposition: string | null;
        notes: string | null;
        visited_at: string;
        rep_id: string | null;
        visit_photos?: { storage_path: string }[];
      }) => ({
        kind: 'visit' as const,
        id: v.id,
        at: v.visited_at,
        disposition: v.disposition,
        content: v.notes,
        repName: v.rep_id ? (nameOf.get(v.rep_id) ?? null) : null,
        photos: (v.visit_photos ?? [])
          .map((p) => signed.get(p.storage_path))
          .filter((u): u is string => !!u),
      }),
    ),
    ...(activities ?? []).map(
      (a: {
        id: string;
        type: string;
        content: string | null;
        created_at: string;
        rep_id: string | null;
      }) => ({
        kind: 'activity' as const,
        id: a.id,
        at: a.created_at,
        activityType: a.type,
        content: a.content,
        repName: a.rep_id ? (nameOf.get(a.rep_id) ?? null) : null,
      }),
    ),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  const full: ContactFull = {
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    address: contact.address,
    lifecycle: contact.lifecycle,
    priority: contact.priority,
    pipelineStageId: contact.pipeline_stage_id,
    valueXof: contact.value_xof,
    tags: contact.tags ?? [],
    lostReason: contact.lost_reason,
    assignedRepId: contact.assigned_rep_id,
    lat: contact.lat,
    lng: contact.lng,
  };

  type InstallRow = {
    id: string;
    title: string | null;
    status: InstallJob['status'];
    installer_id: string | null;
    scheduled_date: string | null;
    next_visit_date: string | null;
    checklist?: { done: boolean }[];
    equipment?: unknown[];
  };
  const installJobs: InstallJob[] = ((installs ?? []) as InstallRow[]).map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    installerId: r.installer_id,
    scheduledDate: r.scheduled_date,
    nextVisitDate: r.next_visit_date,
    doneSteps: (r.checklist ?? []).filter((c) => c.done).length,
    totalSteps: (r.checklist ?? []).length,
    equipmentCount: (r.equipment ?? []).length,
  }));
  const canInstall =
    user.role === 'technician' || user.role === 'manager' || user.role === 'admin';

  return (
    <>
      <AppHeader title={contact.name ?? t('noName')} />
      <main className="mx-auto max-w-3xl space-y-3 p-4">
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('title')}
        </Link>
        <ContactDetail
          contact={full}
          stages={(stages ?? []) as Stage[]}
          timeline={timeline}
          reps={reps}
          technicians={technicians}
          installJobs={installJobs}
          canInstall={canInstall}
        />
      </main>
    </>
  );
}
