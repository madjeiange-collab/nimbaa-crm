import { setRequestLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { ContactDetail } from '@/components/contacts/contact-detail';
import { TaskList } from '@/components/tasks/task-list';
import { loadContactTasks } from '@/lib/tasks/queries';
import { JobHistoryPanel } from '@/components/install/job-history';
import { loadJobHistory, type JobHistory } from '@/lib/installations/history';
import type {
  TimelineItem,
  ContactFull,
  Stage,
  RepOption,
} from '@/components/contacts/contact-detail';
import type { DealCard, ProductOption } from '@/components/contacts/deals-section';

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations('contacts');
  const tTasks = await getTranslations('tasks');

  const supabase = await createClient();
  const contactTasks = await loadContactTasks(supabase, id);

  // Trip history per job (needs 0026; returns nothing before it).
  const { data: jobRows } = await supabase
    .from('installations')
    .select('id')
    .eq('contact_id', id)
    .limit(10);
  const jobHistories = (
    await Promise.all(
      ((jobRows ?? []) as { id: string }[]).map((j) => loadJobHistory(supabase, j.id)),
    )
  ).filter((h): h is JobHistory => h != null);

  const { data: contact } = await supabase
    .from('contacts')
    .select(
      'id, name, phone, address, lat, lng, lifecycle, priority, value_xof, tags, assigned_rep_id, business_type, created_at',
    )
    .eq('id', id)
    .maybeSingle();

  if (!contact) notFound();

  // Deals (with their installations) are fetched separately so a pre-migration
  // DB degrades to "no affaires" instead of 404ing the whole contact page.
  const [{ data: stages }, { data: activities }, { data: visits }, { data: users }, { data: dealRows }] =
    await Promise.all([
      supabase.from('pipeline_stages').select('id, name, sort_order, is_won, is_lost').eq('is_active', true).order('sort_order'),
      supabase.from('activities').select('id, type, content, created_at, rep_id').eq('contact_id', id).order('created_at', { ascending: false }),
      supabase.from('visits').select('id, disposition, notes, visited_at, started_at, rep_id, visit_type, install_status, visit_photos(storage_path)').eq('contact_id', id).order('visited_at', { ascending: false }),
      supabase.from('users').select('id, full_name, username, role'),
      supabase
        .from('deals')
        .select('id, title, product_id, value_xof, status, pipeline_stage_id, needs_installation, contact_person_id, installations(id, status, installer_id, scheduled_date, next_visit_date, checklist, equipment)')
        .eq('contact_id', id)
        .order('created_at', { ascending: true }),
    ]);

  // Interlocuteurs of this business (fetched separately: pre-0014 DB degrades
  // to an empty list instead of breaking the page).
  const { data: peopleRows } = await supabase
    .from('contact_people')
    .select('id, name, role, phone, email')
    .eq('contact_id', id)
    .order('created_at', { ascending: true });
  const people = (peopleRows ?? []) as {
    id: string;
    name: string;
    role: string | null;
    phone: string | null;
    email: string | null;
  }[];

  const { data: productRows } = await supabase
    .from('products')
    .select('id, name, price_xof, commission_pct, commission_mode, commission_months, tech_commission_pct')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  const products: ProductOption[] = (productRows ?? []) as ProductOption[];

  // Subscriptions + commission slices of this contact's deals (pre-0021 DB
  // degrades to none). RLS: reps see their own, managers everything.
  const { data: subRows } = await supabase
    .from('subscriptions')
    .select('id, deal_id, status, commission_months, commission_entries(period_index, status, amount_xof, period_month)')
    .eq('contact_id', id);
  const subByDeal = new Map(
    ((subRows ?? []) as unknown as {
      id: string;
      deal_id: string | null;
      status: string;
      commission_months: number;
      commission_entries: { period_index: number; status: string; amount_xof: number; period_month: string }[];
    }[])
      .filter((s) => s.deal_id)
      .map((s) => [
        s.deal_id as string,
        {
          id: s.id,
          status: s.status as 'active' | 'cancelled',
          slices: (s.commission_entries ?? [])
            .sort((a, b) => a.period_index - b.period_index)
            .map((e) => ({
              index: e.period_index,
              status: e.status,
              amount: e.amount_xof,
              month: e.period_month,
            })),
        },
      ]),
  );

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
        started_at: string | null;
        rep_id: string | null;
        visit_type: string | null;
        install_status: string | null;
        visit_photos?: { storage_path: string }[];
      }) => ({
        kind: 'visit' as const,
        id: v.id,
        at: v.visited_at,
        disposition: v.disposition,
        content: v.notes,
        repName: v.rep_id ? (nameOf.get(v.rep_id) ?? null) : null,
        visitType: v.visit_type,
        installStatus: v.install_status,
        durationMin: v.started_at
          ? Math.max(
              0,
              Math.round(
                (new Date(v.visited_at).getTime() - new Date(v.started_at).getTime()) / 60_000,
              ),
            )
          : null,
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
    valueXof: contact.value_xof,
    tags: contact.tags ?? [],
    assignedRepId: contact.assigned_rep_id,
    lat: contact.lat,
    lng: contact.lng,
    businessType: contact.business_type ?? null,
  };

  type InstRow = {
    id: string;
    status: DealCard['installs'][number]['status'];
    installer_id: string | null;
    scheduled_date: string | null;
    next_visit_date: string | null;
    checklist?: { done: boolean }[];
    equipment?: unknown[];
  };
  type DealRow = {
    id: string;
    title: string | null;
    product_id: string | null;
    value_xof: number | null;
    status: DealCard['status'];
    pipeline_stage_id: string | null;
    needs_installation: boolean;
    contact_person_id: string | null;
    installations?: InstRow[];
  };
  // Type + tags fetched separately: pre-0019 DB degrades to empty values
  // instead of breaking the whole deals list.
  const { data: dealMetaRows } = await supabase
    .from('deals')
    .select('id, business_type, tags')
    .eq('contact_id', id);
  const dealMeta = new Map(
    ((dealMetaRows ?? []) as { id: string; business_type: string | null; tags: string[] | null }[]).map(
      (m) => [m.id, m],
    ),
  );

  const deals: DealCard[] = ((dealRows ?? []) as unknown as DealRow[]).map((d) => ({
    id: d.id,
    title: d.title,
    productId: d.product_id,
    valueXof: d.value_xof,
    status: d.status,
    pipelineStageId: d.pipeline_stage_id,
    needsInstallation: d.needs_installation,
    contactPersonId: d.contact_person_id ?? null,
    businessType: dealMeta.get(d.id)?.business_type ?? null,
    tags: dealMeta.get(d.id)?.tags ?? [],
    subscription: subByDeal.get(d.id) ?? null,
    installs: (d.installations ?? []).map((i) => ({
      id: i.id,
      status: i.status,
      installerId: i.installer_id,
      scheduledDate: i.scheduled_date,
      nextVisitDate: i.next_visit_date,
      doneSteps: (i.checklist ?? []).filter((c) => c.done).length,
      totalSteps: (i.checklist ?? []).length,
      equipmentCount: (i.equipment ?? []).length,
    })),
  }));
  // Anyone in the field may open an intervention. A commercial who finds a
  // fault standing in the shop should not have to route it through a
  // technician to get it on the books, any more than a technician should need
  // a commercial to raise one. The database never restricted this either —
  // installations RLS is "any authenticated user".
  const canInstall = true;

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
          deals={deals}
          products={products}
          people={people}
          canInstall={canInstall}
          isManager={user.role === 'manager' || user.role === 'admin'}
        />
        {/* Raising an SAV / warranty / maintenance job sits with "Visite" in the
            composer above — down here it read as an afterthought. */}

        {/* Each job as its trips: how many returns, how long, with the photos */}
        {jobHistories.map((h) => (
          <JobHistoryPanel key={h.installationId} history={h} />
        ))}

        {/* Follow-ups on this customer — everyone on the job sees the same list */}
        <TaskList
          tasks={contactTasks}
          title={tTasks('contactTasks')}
          showContact={false}
          showAssignee
          emptyHint={tTasks('noneOnContact')}
        />
      </main>
    </>
  );
}
