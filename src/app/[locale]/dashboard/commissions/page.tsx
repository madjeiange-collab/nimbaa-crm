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
      .select('rep_id, kind, period_index, amount_xof, status, period_month, earned_at, paid_at, deals(title, contacts(name), products(name))')
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
    rep_id: string;
    kind: string | null;
    period_index: number;
    amount_xof: number;
    status: string;
    period_month: string;
    deals: {
      title: string | null;
      contacts: { name: string | null } | null;
      products: { name: string } | null;
    } | null;
  }[]).map((e) => ({
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
