'use client';

import { useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Trash2, Plus, X } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { addDnkEntry, deleteDnkEntry, approveDnkEntry } from '@/lib/dnk/actions';
import type { DnkPoint } from '@/components/admin/dnk-map';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

const DnkMap = dynamic(() => import('@/components/admin/dnk-map'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">…</div>
  ),
});

export interface DnkRow extends DnkPoint {
  addedAt: string;
  addedByName: string | null;
  approved: boolean;
}

export function DnkManager({ entries }: { entries: DnkRow[] }) {
  const t = useTranslations('adminDnk');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pending, setPending] = useState<{ lat: number; lng: number } | null>(null);
  const [address, setAddress] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  function onAdd() {
    if (!pending) return;
    setMsg(null);
    startTransition(async () => {
      const res = await addDnkEntry({ ...pending, address, reason });
      if (!res.ok) {
        setMsg(t('error'));
        return;
      }
      setPending(null);
      setAddress('');
      setReason('');
      router.refresh();
    });
  }

  function onDelete(id: string) {
    if (!window.confirm(t('deleteConfirm'))) return;
    setMsg(null);
    startTransition(async () => {
      const res = await deleteDnkEntry(id);
      if (!res.ok) setMsg(t('error'));
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      <Card className="overflow-hidden">
        <div className="h-[45vh] min-h-[320px] w-full">
          <DnkMap entries={entries} pending={pending} onPick={(lat, lng) => setPending({ lat, lng })} />
        </div>
      </Card>

      {pending && (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <p className="text-sm font-semibold">
              {t('newPoint')} — {pending.lat.toFixed(5)}, {pending.lng.toFixed(5)}
            </p>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t('addressPlaceholder')}
            />
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('reasonPlaceholder')}
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setPending(null)} disabled={isPending}>
                <X className="mr-1 h-4 w-4" />
                {t('cancel')}
              </Button>
              <Button onClick={onAdd} disabled={isPending} className="flex-1">
                <Plus className="mr-1 h-4 w-4" />
                {isPending ? t('adding') : t('add')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {msg && (
        <p role="alert" className="text-sm font-medium text-destructive">{msg}</p>
      )}

      {/* Rep-proposed points awaiting approval */}
      {entries.some((e) => !e.approved) && (
        <Card className="border-brand-amber/60">
          <CardContent className="space-y-2 pt-4">
            <p className="text-sm font-semibold">
              {t('pendingTitle', { count: entries.filter((e) => !e.approved).length })}
            </p>
            {entries
              .filter((e) => !e.approved)
              .map((e) => (
                <div key={e.id} className="flex items-center gap-2 rounded-lg border border-dashed p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      ⏳ {e.address || `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}`}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {e.reason && <>{e.reason} · </>}
                      {new Date(e.addedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={isPending}
                    onClick={() => {
                      setMsg(null);
                      startTransition(async () => {
                        const res = await approveDnkEntry(e.id);
                        if (!res.ok) setMsg(t('error'));
                        router.refresh();
                      });
                    }}
                  >
                    {t('approve')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(e.id)}
                    disabled={isPending}
                    aria-label={t('delete')}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-2 pt-4">
          <p className="text-sm font-semibold">{t('listTitle', { count: entries.filter((e) => e.approved).length })}</p>
          {entries.filter((e) => e.approved).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            entries.filter((e) => e.approved).map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-lg border p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    🚫 {e.address || `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}`}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {e.reason && <>{e.reason} · </>}
                    {new Date(e.addedAt).toLocaleDateString()}
                    {e.addedByName && <> · {e.addedByName}</>}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(e.id)}
                  disabled={isPending}
                  aria-label={t('delete')}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
