'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { BadgeDollarSign, Check, Download } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { payEarnedCommissions, payCommissionEntry } from '@/lib/commissions/actions';
import { Link } from '@/i18n/navigation';
import { downloadCsv } from '@/lib/csv';
import { StatTile } from '@/components/charts/stat-tile';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export interface CommissionRow {
  id: string;
  contactId: string | null;
  repId: string;
  name: string;
  role: string;
  kind: 'sale' | 'install';
  amount: number;
  status: string;
  periodMonth: string;
  periodIndex: number;
  client: string;
  product: string;
  base: number | null;
  rate: number | null;
}

/** "25 000 × 10 % = 2 500 FCFA" — the visible math behind a ledger line. */
function calcLabel(r: { base: number | null; rate: number | null; amount: number }): string | null {
  if (r.base == null || r.rate == null) return null;
  return `${r.base.toLocaleString('fr-FR')} × ${r.rate} % = ${r.amount.toLocaleString('fr-FR')} FCFA`;
}

const STATUS_BADGE: Record<string, string> = {
  earned: 'bg-knock-green/15 text-knock-green',
  pending: 'bg-brand-amber/15 text-brand-brown',
  paid: 'bg-muted text-muted-foreground',
  expired: 'bg-destructive/10 text-destructive',
};

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
  const [fPerson, setFPerson] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fKind, setFKind] = useState('');
  const [fMonth, setFMonth] = useState('');

  const earned = rows.filter((r) => r.status === 'earned');
  const pending = rows.filter((r) => r.status === 'pending');
  const paid = rows.filter((r) => r.status === 'paid');
  const toPay = earned.reduce((s, r) => s + r.amount, 0);

  // Per-person payable breakdown (sale vs install).
  const byPerson = useMemo(() => {
    const m = new Map<string, { repId: string; name: string; role: string; sale: number; install: number }>();
    for (const r of earned) {
      const cur = m.get(r.repId) ?? { repId: r.repId, name: r.name, role: r.role, sale: 0, install: 0 };
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
          {byPerson.length > 0 && (
            <p className="text-xs text-muted-foreground">{t('personFilterHint')}</p>
          )}
          {byPerson.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('nothingToPay')}</p>
          ) : (
            byPerson.map((p) => (
              <button
                key={p.repId}
                type="button"
                aria-pressed={fPerson === p.repId}
                onClick={() => setFPerson(fPerson === p.repId ? '' : p.repId)}
                className={`flex w-full items-center justify-between rounded-lg border p-2.5 text-left text-sm transition-colors ${
                  fPerson === p.repId
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-accent'
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {p.name}
                    {fPerson === p.repId && ' ✓'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.sale > 0 && `${t('kindSale')}: ${fcfa(p.sale)}`}
                    {p.sale > 0 && p.install > 0 && ' · '}
                    {p.install > 0 && `${t('kindInstall')}: ${fcfa(p.install)}`}
                  </p>
                </div>
                <span className="shrink-0 font-semibold">{fcfa(p.sale + p.install)}</span>
              </button>
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

      <DetailedReport
        rows={rows}
        fPerson={fPerson} setFPerson={setFPerson}
        fStatus={fStatus} setFStatus={setFStatus}
        fKind={fKind} setFKind={setFKind}
        fMonth={fMonth} setFMonth={setFMonth}
      />
    </div>
  );
}

/** Full ledger, entry by entry, with filters and a detailed CSV export. */
function DetailedReport({
  rows,
  fPerson, setFPerson,
  fStatus, setFStatus,
  fKind, setFKind,
  fMonth, setFMonth,
}: {
  rows: CommissionRow[];
  fPerson: string; setFPerson: (v: string) => void;
  fStatus: string; setFStatus: (v: string) => void;
  fKind: string; setFKind: (v: string) => void;
  fMonth: string; setFMonth: (v: string) => void;
}) {
  const t = useTranslations('commissions');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function payLine(id: string) {
    startTransition(async () => {
      await payCommissionEntry(id);
      router.refresh();
    });
  }

  const people = useMemo(
    () => [...new Map(rows.map((r) => [r.repId, r.name])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [rows],
  );
  const months = useMemo(
    () => [...new Set(rows.map((r) => r.periodMonth.slice(0, 7)))].sort().reverse(),
    [rows],
  );
  const filtered = rows.filter(
    (r) =>
      (fPerson === '' || r.repId === fPerson) &&
      (fStatus === '' || r.status === fStatus) &&
      (fKind === '' || r.kind === fKind) &&
      (fMonth === '' || r.periodMonth.startsWith(fMonth)),
  );
  const total = filtered.reduce((s, r) => s + r.amount, 0);

  function exportDetail() {
    downloadCsv('commissions-detail.csv', [
      ['Personne', 'Rôle', 'Type', 'Client', 'Produit', 'Mensualité', 'Mois', 'Base FCFA', 'Taux %', 'Montant FCFA', 'Statut'],
      ...filtered.map((r) => [
        r.name, r.role, r.kind === 'install' ? 'installation' : 'vente',
        r.client, r.product, r.periodIndex, r.periodMonth,
        r.base ?? '', r.rate ?? '', r.amount, r.status,
      ]),
    ]);
  }

  const selectCls =
    'flex min-h-touch w-full rounded-md border border-input bg-background px-2 text-sm';

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">{t('detailTitle')}</p>
          <Button variant="outline" size="sm" onClick={exportDetail} disabled={filtered.length === 0}>
            <Download className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select value={fPerson} onChange={(e) => setFPerson(e.target.value)} className={selectCls} aria-label={t('filterPerson')}>
            <option value="">{t('filterPerson')}</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <select value={fKind} onChange={(e) => setFKind(e.target.value)} className={selectCls} aria-label={t('filterKind')}>
            <option value="">{t('filterKind')}</option>
            <option value="sale">{t('kindSale')}</option>
            <option value="install">{t('kindInstall')}</option>
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={selectCls} aria-label={t('filterStatus')}>
            <option value="">{t('filterStatus')}</option>
            {(['earned', 'pending', 'paid', 'expired'] as const).map((s) => (
              <option key={s} value={s}>{t(`status_${s}` as never)}</option>
            ))}
          </select>
          <select value={fMonth} onChange={(e) => setFMonth(e.target.value)} className={selectCls} aria-label={t('filterMonth')}>
            <option value="">{t('filterMonth')}</option>
            {months.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <p className="text-xs text-muted-foreground">
          {t('detailSummary', { count: filtered.length, total: fcfa(total) })}
        </p>

        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detailEmpty')}</p>
        ) : (
          <div className="space-y-1.5">
            {filtered.slice(0, 100).map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg border p-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {r.name}
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {r.kind === 'install' ? t('kindInstall') : t('kindSale')} ·{' '}
                      {r.contactId ? (
                        <Link href={`/contacts/${r.contactId}`} className="text-primary underline">
                          {r.client} · {r.product}
                        </Link>
                      ) : (
                        <>{r.client} · {r.product}</>
                      )}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('sliceN', { n: r.periodIndex })} ·{' '}
                    {new Date(r.periodMonth + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {calcLabel(r) && <> · {calcLabel(r)}</>}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status] ?? 'bg-muted'}`}>
                  {t(`status_${r.status}` as never)}
                </span>
                <span className="w-24 shrink-0 text-right font-semibold">{fcfa(r.amount)}</span>
                {r.status === 'earned' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={isPending}
                    onClick={() => payLine(r.id)}
                  >
                    {t('payLine')}
                  </Button>
                )}
              </div>
            ))}
            {filtered.length > 100 && (
              <p className="text-xs text-muted-foreground">{t('detailTruncated', { count: filtered.length - 100 })}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
