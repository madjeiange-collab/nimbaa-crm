'use client';

import { useMemo, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { Polygon } from 'geojson';
import { saveTerritory } from '@/lib/territories/actions';
import type { TerritoryType } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';

// Leaflet touches window/document → load only on the client.
const LeafletDrawMap = dynamic(() => import('@/components/map/leaflet-draw-map'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      …
    </div>
  ),
});

type ExistingTerritory = { id: string; name: string; type: TerritoryType };

export function TerritoryManager({ existing }: { existing: ExistingTerritory[] }) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState('');
  const [type, setType] = useState<TerritoryType>('d2d');
  const [geometry, setGeometry] = useState<Polygon | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null,
  );

  const typeOptions = useMemo(
    () =>
      [
        { value: 'd2d', label: t('territoryTypeD2d') },
        { value: 'b2b', label: t('territoryTypeB2b') },
        { value: 'mixed', label: t('territoryTypeMixed') },
      ] as { value: TerritoryType; label: string }[],
    [t],
  );

  function onSave() {
    setMessage(null);
    if (!geometry) {
      setMessage({ kind: 'error', text: t('noPolygon') });
      return;
    }
    startTransition(async () => {
      const res = await saveTerritory({ name, type, geometry });
      if (res.ok) {
        setMessage({ kind: 'ok', text: t('territorySaved') });
        setName('');
        setGeometry(null);
        router.refresh();
      } else {
        setMessage({
          kind: 'error',
          text: res.error === 'noPolygon' ? t('noPolygon') : t('territorySaveError'),
        });
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      {/* Map */}
      <Card className="order-2 overflow-hidden lg:order-1">
        <div className="h-[60vh] min-h-[360px] w-full">
          <LeafletDrawMap onChange={setGeometry} />
        </div>
      </Card>

      {/* Form + existing list */}
      <div className="order-1 space-y-4 lg:order-2">
        <Card>
          <CardContent className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">{t('drawPolygon')}</p>

            <div className="space-y-2">
              <Label htmlFor="terr-name">{t('territoryName')}</Label>
              <Input
                id="terr-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('territoryNamePlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="terr-type">{t('territoryType')}</Label>
              <select
                id="terr-type"
                value={type}
                onChange={(e) => setType(e.target.value as TerritoryType)}
                className="flex min-h-touch w-full rounded-md border border-input bg-background px-3 py-2 text-base"
              >
                {typeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span
                className={
                  geometry ? 'font-medium text-knock-green' : 'text-muted-foreground'
                }
              >
                {geometry ? '● polygone prêt' : '○ ' + t('noPolygon')}
              </span>
            </div>

            {message && (
              <p
                role="alert"
                className={
                  message.kind === 'ok'
                    ? 'text-sm font-medium text-knock-green'
                    : 'text-sm font-medium text-destructive'
                }
              >
                {message.text}
              </p>
            )}

            <Button onClick={onSave} className="w-full" size="lg" disabled={isPending}>
              {isPending ? tCommon('saving') : t('saveTerritory')}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <p className="mb-2 text-sm font-semibold">{t('existingTerritories')}</p>
            {existing.length === 0 ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {existing.map((terr) => (
                  <li key={terr.id} className="flex items-center justify-between">
                    <span className="truncate">{terr.name}</span>
                    <span className="ml-2 shrink-0 rounded bg-secondary px-2 py-0.5 text-xs uppercase text-secondary-foreground">
                      {terr.type}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
