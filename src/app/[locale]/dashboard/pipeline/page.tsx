import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import {
  PipelineBoard,
  type PipelineContact,
  type PipelineStage,
  type PipelineRep,
  type PipelineTerritory,
} from '@/components/dashboard/pipeline-board';

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['manager', 'admin']);
  const t = await getTranslations('dashboard');

  const supabase = await createClient();
  const [{ data: contacts }, { data: stages }, { data: users }, { data: turfs }] =
    await Promise.all([
      supabase
        .from('contacts')
        .select('id, name, lifecycle, priority, pipeline_stage_id, value_xof, assigned_rep_id, territory_id')
        .order('updated_at', { ascending: false })
        .limit(1000),
      supabase.from('pipeline_stages').select('id, name, sort_order, is_active').order('sort_order'),
      supabase.from('users').select('id, full_name, username'),
      supabase.rpc('territories_geojson'),
    ]);

  const territories: PipelineTerritory[] = ((turfs ?? []) as { id: string; name: string }[]).map(
    (r) => ({ id: r.id, name: r.name }),
  );

  const repName = new Map<string, string>(
    (users ?? []).map((u: { id: string; full_name: string | null; username: string | null }) => [
      u.id,
      u.full_name ?? u.username ?? '—',
    ]),
  );

  const contactRows: PipelineContact[] = (contacts ?? []).map(
    (c: {
      id: string;
      name: string | null;
      lifecycle: PipelineContact['lifecycle'];
      priority: PipelineContact['priority'];
      pipeline_stage_id: string | null;
      value_xof: number | null;
      assigned_rep_id: string | null;
      territory_id: string | null;
    }) => ({
      id: c.id,
      name: c.name,
      lifecycle: c.lifecycle,
      priority: c.priority,
      stageId: c.pipeline_stage_id,
      value: c.value_xof,
      repId: c.assigned_rep_id,
      repName: c.assigned_rep_id ? (repName.get(c.assigned_rep_id) ?? '—') : null,
      territoryId: c.territory_id,
    }),
  );

  const stageRows: PipelineStage[] = (stages ?? [])
    .filter((s: { is_active: boolean }) => s.is_active)
    .map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }));

  // Reps that actually have contacts (for the filter dropdown).
  const reps: PipelineRep[] = [
    ...new Map(
      contactRows
        .filter((c) => c.repId)
        .map((c) => [c.repId as string, { id: c.repId as string, name: c.repName ?? '—' }]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <AppHeader title={t('pipelineTitle')} />
      <main className="mx-auto max-w-6xl space-y-3 p-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('title')}
        </Link>
        <PipelineBoard
          contacts={contactRows}
          stages={stageRows}
          reps={reps}
          territories={territories}
        />
      </main>
    </>
  );
}
