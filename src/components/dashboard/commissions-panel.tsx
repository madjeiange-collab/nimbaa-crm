'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { BadgeDollarSign, Check, Download } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { payEarnedCommissions } from '@/lib/commissions/actions';
import { downloadCsv } from '@/lib/csv';
import { StatTile } from '@/components/charts/stat-tile';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export interface CommissionRow {
  repId: string;
  name: string;
  role: string;
  kind: 'sale' | 'install';
  amount: number;
  status: string;
  periodMonth: string;
}

const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;

export function CommissionsPanel({
  rows,
  mrr,
  activeSubs,
}: {
  rows: CommissionRow[];
  mrr: number;
  activeSubs: number;
}) {
  const t = useTranslations('commissions');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const earned = rows.filter((r) => r.status === 'earned');
  const pending = rows.filter((r) => r.status === 'pending');
  const paid = rows.filter((r) => r.status === 'paid');
  const toPay = earned.reduce((s, r) => s + r.amount, 0);

  // Per-person payable breakdown (sale vs install).
  const byPerson = useMemo(() => {
    const m = new Map<string, { name: string; role: string; sale: number; install: number }>();
    for (const r of earned) {
      const cur = m.get(r.repId) ?? { name: r.name, role: r.role, sale: 0, install: 0 };
      cur[r.kind === 'install' ? 'install' : 'sale'] += r.amount;
      m.set(r.repId, cur);
    }
    return [...m.values()].sort((a, b) => b.sale + b.install - (a.sale + a.install));
  }, [earned]);

  function exportCsv() {
    downloadCsv('commissions-a-payer.csv', [
      ['Personne', 'Rôle', 'Commission ventes', 'Commission installations', 'Total FCFA'],
      ...byPerson.map((p) => [p.name, p.role, p.sale, p.install, p.sale + p.install]),
    ]);
  }

  function onPay() {
    if (!window.confirm(t('payConfirm', { amount: fcfa(toPay) }))) return;
    setMsg(null);
    startTransition(async () => {
      const res = await payEarnedCommissions();
      setMsg(res.ok ? t('paidDone', { count: res.count }) : t('error'));
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label={t('toPay')} value={fcfa(toPay)} accent="amber" />
        <StatTile label={t('pending')} value={fcfa(pending.reduce((s, r) => s + r.amount, 0))} accent="primary" />
        <StatTile label={t('paidTotal')} value={fcfa(paid.reduce((s, r) => s + r.amount, 0))} accent="green" />
        <StatTile label={t('mrr')} value={`${fcfa(mrr)} · ${activeSubs}`} accent="primary" />
      </div>

      <Card>
        <CardContent className="space-y-2 pt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <BadgeDollarSign className="h-4 w-4 text-primary" />
              {t('byPersonTitle')}
            </p>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={byPerson.length === 0}>
              <Download className="h-4 w-4" />
            </Button>
          </div>
          {byPerson.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('nothingToPay')}</p>
          ) : (
            byPerson.map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.sale > 0 && `${t('kindSale')}: ${fcfa(p.sale)}`}
                    {p.sale > 0 && p.install > 0 && ' · '}
                    {p.install > 0 && `${t('kindInstall')}: ${fcfa(p.install)}`}
                  </p>
                </div>
                <span className="shrink-0 font-semibold">{fcfa(p.sale + p.install)}</span>
              </div>
            ))
          )}
          {msg && <p className="text-sm font-medium text-knock-green">{msg}</p>}
          <Button className="w-full" size="lg" onClick={onPay} disabled={isPending || toPay === 0}>
            <Check className="mr-1 h-4 w-4" />
            {isPending ? t('paying') : t('payButton')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('payHint')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
