import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import {
  PipelineBoard,
  type PipelineDeal,
  type PipelineStage,
  type PipelineRep,
  type PipelineTerritory,
  type WonPeriod,
} from '@/components/dashboard/pipeline-board';
import type { DealStatus } from '@/types/database';

export default async function PipelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ life?: string; rep?: string; terr?: string; won?: string }>;
}) {
  const { locale } = await params;
  const { life, rep, terr, won } = await searchParams;
  setRequestLocale(locale);
  await requireRole(['manager', 'admin']);
  const t = await getTranslations('dashboard');

  // Map the ?life= link (from dashboard KPIs) onto deal status; carry the
  // dashboard's rep/secteur filter + an optional won-date scope.
  const initialStatus: 'all' | DealStatus =
    life === 'lead' ? 'open' : life === 'customer' ? 'won' : life === 'lost' ? 'lost' : 'all';
  const initialRepIds = rep ? rep.split(',').filter(Boolean) : [];
  const initialTerrIds = terr ? terr.split(',').filter(Boolean) : [];
  const initialWonPeriod: WonPeriod = won === 'week' || won === 'month' ? won : 'all';

  const supabase = await createClient();
  const [{ data: dealRows }, { data: stages }, { data: users }, { data: turfs }] =
    await Promise.all([
      supabase
        .from('deals')
        .select('id, title, value_xof, status, pipeline_stage_id, won_at, assigned_rep_id, contacts(id, name, territory_id), products(name)')
        .order('updated_at', { ascending: false })
        .limit(2000),
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

  type Row = {
    id: string;
    title: string | null;
    value_xof: number | null;
    status: DealStatus;
    pipeline_stage_id: string | null;
    won_at: string | null;
    assigned_rep_id: string | null;
    contacts: { id: string; name: string | null; territory_id: string | null } | null;
    products: { name: string | null } | null;
  };
  const deals: PipelineDeal[] = ((dealRows ?? []) as unknown as Row[]).map((d) => ({
    id: d.id,
    contactId: d.contacts?.id ?? '',
    name: d.contacts?.name ?? null,
    title: d.title,
    product: d.products?.name ?? null,
    value: d.value_xof,
    stageId: d.pipeline_stage_id,
    status: d.status,
    wonAt: d.won_at,
    repId: d.assigned_rep_id,
    repName: d.assigned_rep_id ? (repName.get(d.assigned_rep_id) ?? '—') : null,
    territoryId: d.contacts?.territory_id ?? null,
  }));

  const stageRows: PipelineStage[] = (stages ?? [])
    .filter((s: { is_active: boolean }) => s.is_active)
    .map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }));

  // Reps that own deals (for the filter dropdown).
  const reps: PipelineRep[] = [
    ...new Map(
      deals.filter((d) => d.repId).map((d) => [d.repId as string, { id: d.repId as string, name: d.repName ?? '—' }]),
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
          deals={deals}
          stages={stageRows}
          reps={reps}
          territories={territories}
          initialStatus={initialStatus}
          initialRepIds={initialRepIds}
          initialTerrIds={initialTerrIds}
          initialWonPeriod={initialWonPeriod}
        />
      </main>
    </>
  );
}
