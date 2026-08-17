import { getTranslations } from 'next-intl/server';
import { BadgeDollarSign } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent } from '@/components/ui/card';

const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;

/**
 * "Mes commissions" — the user's own ledger, shown on rep and technician
 * statistics. RLS scopes entries to the viewer (or manager viewing a rep's
 * stats via the picker, where userId is the target).
 */
export async function MyCommissions({ userId }: { userId: string }) {
  const t = await getTranslations('commissions');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('commission_entries')
    .select('kind, amount_xof, status, period_month, period_index, deals(title, contacts(name), products(name))')
    .eq('rep_id', userId)
    .order('period_month', { ascending: false })
    .limit(500);
  // Pre-0021 database or nothing earned yet with no history → stay invisible.
  if (error) return null;
  const rows = (data ?? []) as unknown as {
    kind: string | null;
    amount_xof: number;
    status: string;
    period_month: string;
    period_index: number;
    deals: {
      title: string | null;
      contacts: { name: string | null } | null;
      products: { name: string } | null;
    } | null;
  }[];
  if (rows.length === 0) return null;

  const sum = (st: string) => rows.filter((r) => r.status === st).reduce((s, r) => s + r.amount_xof, 0);
  const earned = sum('earned');
  const pending = sum('pending');
  const paid = sum('paid');
  const expired = sum('expired');
  const upcoming = rows
    .filter((r) => r.status === 'pending')
    .sort((a, b) => (a.period_month < b.period_month ? -1 : 1))[0];

  return (
    <Card>
      <CardContent className="space-y-2 pt-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <BadgeDollarSign className="h-4 w-4 text-primary" />
          {t('myTitle')}
        </p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-knock-green/10 p-2">
            <p className="text-lg font-bold text-knock-green">{fcfa(earned)}</p>
            <p className="text-xs text-muted-foreground">{t('myEarned')}</p>
          </div>
          <div className="rounded-lg bg-brand-amber/10 p-2">
            <p className="text-lg font-bold text-brand-brown">{fcfa(pending)}</p>
            <p className="text-xs text-muted-foreground">{t('myPending')}</p>
          </div>
          <div className="rounded-lg bg-muted p-2">
            <p className="text-lg font-bold">{fcfa(paid)}</p>
            <p className="text-xs text-muted-foreground">{t('myPaid')}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {upcoming &&
            t('myUpcoming', {
              date: new Date(upcoming.period_month + 'T12:00:00').toLocaleDateString('fr-FR', {
                day: 'numeric',
                month: 'long',
              }),
              amount: fcfa(upcoming.amount_xof),
            })}
          {upcoming && expired > 0 && ' · '}
          {expired > 0 && t('myExpired', { amount: fcfa(expired) })}
        </p>

        {/* Detailed lines: which client, which product, which slice */}
        <div className="space-y-1 border-t pt-2">
          {rows.slice(0, 8).map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">
                {r.kind === 'install' ? '🔧' : '💼'} {r.deals?.contacts?.name ?? '—'} ·{' '}
                {r.deals?.products?.name ?? r.deals?.title ?? '—'} · {t('sliceN', { n: r.period_index })}
              </span>
              <span
                className={`shrink-0 font-medium ${
                  r.status === 'earned'
                    ? 'text-knock-green'
                    : r.status === 'expired'
                      ? 'text-destructive'
                      : r.status === 'paid'
                        ? 'text-muted-foreground'
                        : 'text-brand-brown'
                }`}
              >
                {fcfa(r.amount_xof)} · {t(`status_${r.status}` as never)}
              </span>
            </div>
          ))}
          {rows.length > 8 && (
            <p className="text-xs text-muted-foreground">{t('myMore', { count: rows.length - 8 })}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
