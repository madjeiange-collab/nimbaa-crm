'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, ChevronRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { ContactLifecycle, PriorityLevel } from '@/types/database';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { TerritoryFilter } from '@/components/dashboard/rep-multi-filter';

export interface ContactRow {
  id: string;
  name: string | null;
  lifecycle: ContactLifecycle;
  priority: PriorityLevel;
  address: string | null;
  updatedAt: string;
  stageName: string | null;
  territoryId: string | null;
  visits: number;
  lastVisitAt: string | null;
  openDeals: number;
  wonDeals: number;
  wonValueXof: number;
}

type Tab = 'all' | 'lead' | 'customer' | 'lost';

const PRIORITY_CLASS: Record<PriorityLevel, string> = {
  vip: 'bg-brand-amber/20 text-brand-brown',
  high: 'bg-brand-amber/15 text-brand-brown',
  medium: 'bg-secondary text-secondary-foreground',
  low: 'bg-muted text-muted-foreground',
};

const LIFECYCLE_CLASS: Record<ContactLifecycle, string> = {
  lead: 'bg-brand-amber/15 text-brand-brown',
  customer: 'bg-knock-green/15 text-knock-green',
  lost: 'bg-destructive/10 text-destructive',
};

export function ContactsList({
  rows,
  territories = [],
  initialTab = 'all',
}: {
  rows: ContactRow[];
  territories?: { id: string; name: string }[];
  initialTab?: Tab;
}) {
  const t = useTranslations('contacts');
  const tLife = useTranslations('lifecycle');
  const tPrio = useTranslations('priority');
  const [tab, setTab] = useState<Tab>(initialTab);
  const [q, setQ] = useState('');
  const [territorySel, setTerritorySel] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab !== 'all' && r.lifecycle !== tab) return false;
      if (query && !(r.name ?? '').toLowerCase().includes(query)) return false;
      if (territorySel.length > 0 && !(r.territoryId && territorySel.includes(r.territoryId)))
        return false;
      return true;
    });
  }, [rows, tab, q, territorySel]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: t('tabAll') },
    { key: 'lead', label: t('tabLeads') },
    { key: 'customer', label: t('tabCustomers') },
    { key: 'lost', label: t('tabLost') },
  ];

  // Summary of the current selection (search + secteur, across all tabs).
  const summary = useMemo(() => {
    const query = q.trim().toLowerCase();
    const base = rows.filter((r) => {
      if (query && !(r.name ?? '').toLowerCase().includes(query)) return false;
      if (territorySel.length > 0 && !(r.territoryId && territorySel.includes(r.territoryId)))
        return false;
      return true;
    });
    const leads = base.filter((r) => r.lifecycle === 'lead').length;
    const customers = base.filter((r) => r.lifecycle === 'customer').length;
    const lost = base.filter((r) => r.lifecycle === 'lost').length;
    const total = leads + customers + lost;
    return {
      leads,
      customers,
      conversion: total > 0 ? Math.round((customers / total) * 100) : 0,
      value: base.reduce((s, r) => s + r.wonValueXof, 0),
    };
  }, [rows, q, territorySel]);

  const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });

  return (
    <main className="mx-auto max-w-3xl space-y-3 p-4">
      {/* Summary strip for the current selection */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: t('kpiLeads'), value: String(summary.leads), cls: 'text-brand-brown' },
          { label: t('kpiCustomers'), value: String(summary.customers), cls: 'text-knock-green' },
          { label: t('kpiConversion'), value: `${summary.conversion}%`, cls: 'text-primary' },
          {
            label: t('kpiValue'),
            value: summary.value >= 1_000_000
              ? `${(summary.value / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`
              : summary.value.toLocaleString('fr-FR'),
            cls: 'text-primary',
          },
        ].map((k) => (
          <Card key={k.label} className="p-2.5 text-center">
            <p className={`text-lg font-bold leading-tight ${k.cls}`}>{k.value}</p>
            <p className="text-[11px] text-muted-foreground">{k.label}</p>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`min-h-touch whitespace-nowrap rounded-lg px-4 text-sm font-medium ${
              tab === tb.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('search')}
          className="pl-9"
        />
      </div>

      {/* Secteur (territory) filter — hidden when no territories exist */}
      {territories.length > 0 && (
        <div className="flex">
          <TerritoryFilter
            territories={territories}
            selected={territorySel}
            onChange={setTerritorySel}
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">{t('empty')}</Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <Link key={r.id} href={`/contacts/${r.id}`} className="block">
              <Card className="flex items-center gap-3 p-3 transition-colors hover:bg-accent">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{r.name ?? t('noName')}</p>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${LIFECYCLE_CLASS[r.lifecycle]}`}
                    >
                      {tLife(r.lifecycle)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    {r.stageName && <span>{r.stageName}</span>}
                    {r.address && <span className="truncate">· {r.address}</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{t('rowVisits', { n: r.visits })}</span>
                    {r.lastVisitAt && <span>· {t('rowLastVisit', { date: shortDate(r.lastVisitAt) })}</span>}
                    {r.openDeals > 0 && (
                      <span className="text-brand-brown">· {t('rowOpenDeals', { n: r.openDeals })}</span>
                    )}
                    {r.wonDeals > 0 && (
                      <span className="text-knock-green">
                        · {t('rowWonDeals', { n: r.wonDeals })}
                        {r.wonValueXof > 0 && ` (${r.wonValueXof.toLocaleString('fr-FR')} F)`}
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${PRIORITY_CLASS[r.priority]}`}
                >
                  {tPrio(r.priority)}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
