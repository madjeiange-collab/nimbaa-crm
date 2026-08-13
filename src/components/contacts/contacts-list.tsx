'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, ChevronRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import type { ContactLifecycle, PriorityLevel } from '@/types/database';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export interface ContactRow {
  id: string;
  name: string | null;
  lifecycle: ContactLifecycle;
  priority: PriorityLevel;
  address: string | null;
  updatedAt: string;
  stageName: string | null;
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

export function ContactsList({ rows }: { rows: ContactRow[] }) {
  const t = useTranslations('contacts');
  const tLife = useTranslations('lifecycle');
  const tPrio = useTranslations('priority');
  const [tab, setTab] = useState<Tab>('all');
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab !== 'all' && r.lifecycle !== tab) return false;
      if (query && !(r.name ?? '').toLowerCase().includes(query)) return false;
      return true;
    });
  }, [rows, tab, q]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: t('tabAll') },
    { key: 'lead', label: t('tabLeads') },
    { key: 'customer', label: t('tabCustomers') },
    { key: 'lost', label: t('tabLost') },
  ];

  return (
    <main className="mx-auto max-w-3xl space-y-3 p-4">
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
