import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AppHeader } from '@/components/shared/app-header';
import { CommissionsPanel, type CommissionRow } from '@/components/dashboard/commissions-panel';

export default async function CommissionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['manager', 'admin']);
  const t = await getTranslations('commissions');
  const tAdmin = await getTranslations('admin');

  const supabase = await createClient();
  const [{ data: entries }, { data: users }, { data: subs }] = await Promise.all([
    supabase
      .from('commission_entries')
      .select('id, rep_id, kind, period_index, amount_xof, base_xof, rate_pct, status, period_month, earned_at, paid_at, deals(title, value_xof, contacts(id, name), products(name))')
      .order('period_month', { ascending: false })
      .limit(5000),
    supabase.from('users').select('id, full_name, username, role'),
    supabase
      .from('subscriptions')
      .select('id, status, monthly_price_xof, start_date')
      .limit(5000),
  ]);

  const nameById = new Map(
    ((users ?? []) as { id: string; full_name: string | null; username: string | null }[]).map(
      (u) => [u.id, u.full_name || u.username || '—'],
    ),
  );
  const roleById = new Map(
    ((users ?? []) as { id: string; role: string }[]).map((u) => [u.id, u.role]),
  );

  const rows: CommissionRow[] = ((entries ?? []) as unknown as {
    id: string;
    rep_id: string;
    kind: string | null;
    period_index: number;
    amount_xof: number;
    base_xof: number | null;
    rate_pct: number | null;
    status: string;
    period_month: string;
    deals: {
      title: string | null;
      value_xof: number | null;
      contacts: { id: string; name: string | null } | null;
      products: { name: string } | null;
    } | null;
  }[]).map((e) => ({
    id: e.id,
    contactId: e.deals?.contacts?.id ?? null,
    repId: e.rep_id,
    name: nameById.get(e.rep_id) ?? '—',
    role: roleById.get(e.rep_id) ?? 'rep',
    kind: e.kind === 'install' ? 'install' : 'sale',
    amount: e.amount_xof,
    status: e.status,
    periodMonth: e.period_month,
    periodIndex: e.period_index,
    client: e.deals?.contacts?.name ?? '—',
    product: e.deals?.products?.name ?? e.deals?.title ?? '—',
    // Calculation shown per line: snapshot preferred, deal value as fallback
    // for entries created before the snapshot columns existed.
    base: e.base_xof ?? e.deals?.value_xof ?? null,
    rate:
      e.rate_pct ??
      (e.base_xof ?? e.deals?.value_xof
        ? Math.round((e.amount_xof / ((e.base_xof ?? e.deals?.value_xof) as number)) * 1000) / 10
        : null),
  }));

  const subRows = (subs ?? []) as { status: string; monthly_price_xof: number; start_date: string }[];
  const mrr = subRows
    .filter((s) => s.status === 'active')
    .reduce((sum, s) => sum + s.monthly_price_xof, 0);
  const activeSubs = subRows.filter((s) => s.status === 'active').length;

  return (
    <>
      <AppHeader title={t('title')} />
      <main className="mx-auto max-w-3xl space-y-3 p-4">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {tAdmin('title')}
        </Link>
        <CommissionsPanel rows={rows} mrr={mrr} activeSubs={activeSubs} />
      </main>
    </>
  );
}
