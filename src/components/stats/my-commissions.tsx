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
    .select('kind, amount_xof, status, period_month')
    .eq('rep_id', userId)
    .order('period_month', { ascending: false })
    .limit(500);
  // Pre-0021 database or nothing earned yet with no history → stay invisible.
  if (error) return null;
  const rows = (data ?? []) as {
    kind: string | null;
    amount_xof: number;
    status: string;
    period_month: string;
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
      </CardContent>
    </Card>
  );
}
