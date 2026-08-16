'use client';

import { useMemo, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Pencil, Trash2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import type { Polygon } from 'geojson';
import { saveTerritory, updateTerritory, deleteTerritory } from '@/lib/territories/actions';
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

type ExistingTerritory = {
  id: string;
  name: string;
  type: TerritoryType;
  description: string | null;
  geojson: Polygon | null;
};

export function TerritoryManager({ existing }: { existing: ExistingTerritory[] }) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<TerritoryType>('d2d');
  const [geometry, setGeometry] = useState<Polygon | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null,
  );

  const editing = editingId ? existing.find((e) => e.id === editingId) ?? null : null;

  const typeOptions = useMemo(
    () =>
      [
        { value: 'd2d', label: t('territoryTypeD2d') },
        { value: 'b2b', label: t('territoryTypeB2b') },
        { value: 'mixed', label: t('territoryTypeMixed') },
      ] as { value: TerritoryType; label: string }[],
    [t],
  );

  function resetForm() {
    setEditingId(null);
    setName('');
    setDescription('');
    setType('d2d');
    setGeometry(null);
  }

  function startEdit(terr: ExistingTerritory) {
    setMessage(null);
    setEditingId(terr.id);
    setName(terr.name);
    setDescription(terr.description ?? '');
    setType(terr.type);
    setGeometry(null); // only replaces the polygon if the admin redraws
  }

  function errorText(code: string) {
    if (code === 'noPolygon') return t('noPolygon');
    if (code === 'territoryInUse') return t('territoryInUse');
    return t('territorySaveError');
  }

  function onSave() {
    setMessage(null);
    if (!editing && !geometry) {
      setMessage({ kind: 'error', text: t('noPolygon') });
      return;
    }
    startTransition(async () => {
      const res = editing
        ? await updateTerritory({ id: editing.id, name, type, description, geometry })
        : await saveTerritory({ name, type, geometry: geometry as Polygon, description });
      if (res.ok) {
        setMessage({ kind: 'ok', text: editing ? t('territoryUpdated') : t('territorySaved') });
        resetForm();
        router.refresh();
      } else {
        setMessage({ kind: 'error', text: errorText(res.error) });
      }
    });
  }

  function onDelete(terr: ExistingTerritory) {
    if (!window.confirm(t('deleteTerritoryConfirm', { name: terr.name }))) return;
    setMessage(null);
    startTransition(async () => {
      const res = await deleteTerritory(terr.id);
      if (res.ok) {
        if (editingId === terr.id) resetForm();
        setMessage({ kind: 'ok', text: t('territoryDeleted') });
        router.refresh();
      } else {
        setMessage({ kind: 'error', text: errorText(res.error) });
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      {/* Map */}
      <Card className="order-2 overflow-hidden lg:order-1">
        <div className="h-[60vh] min-h-[360px] w-full">
          <LeafletDrawMap onChange={setGeometry} preview={editing?.geojson ?? null} />
        </div>
      </Card>

      {/* Form + existing list */}
      <div className="order-1 space-y-4 lg:order-2">
        <Card>
          <CardContent className="space-y-4 pt-4">
            {editing ? (
              <p className="text-sm font-semibold">
                {t('editTerritoryTitle', { name: editing.name })}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t('drawPolygon')}</p>
            )}

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
              <Label htmlFor="terr-desc">{t('territoryDescription')}</Label>
              <Input
                id="terr-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('territoryDescriptionPlaceholder')}
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
                {geometry
                  ? '● polygone prêt'
                  : editing
                    ? '○ ' + t('redrawHint')
                    : '○ ' + t('noPolygon')}
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
              {isPending
                ? tCommon('saving')
                : editing
                  ? t('updateTerritory')
                  : t('saveTerritory')}
            </Button>
            {editing && (
              <Button
                onClick={resetForm}
                variant="outline"
                className="w-full"
                disabled={isPending}
              >
                {tCommon('cancel')}
              </Button>
            )}
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
                  <li
                    key={terr.id}
                    className={`flex items-start justify-between gap-1 rounded-md px-1 py-0.5 ${
                      terr.id === editingId ? 'bg-accent' : ''
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate">{terr.name}</span>
                      {terr.description && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {terr.description}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="rounded bg-secondary px-2 py-0.5 text-xs uppercase text-secondary-foreground">
                        {terr.type}
                      </span>
                      <button
                        type="button"
                        onClick={() => startEdit(terr)}
                        aria-label={tCommon('edit')}
                        className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(terr)}
                        aria-label={tCommon('delete')}
                        disabled={isPending}
                        className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
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
