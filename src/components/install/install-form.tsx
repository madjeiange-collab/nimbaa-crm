'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  Camera,
  CheckCircle2,
  MapPin,
  Plus,
  Trash2,
  X,
  AlertTriangle,
} from 'lucide-react';
import { useGeolocation } from '@/hooks/use-geolocation';
import { reverseGeocode } from '@/lib/geo/reverse';
import { processCheckInPhoto } from '@/lib/image/capture';
import { uploadVisitPhoto } from '@/lib/visits/upload';
import { saveInstallation } from '@/lib/installations/actions';
import { freshChecklist } from '@/lib/installations/protocol';
import type { ChecklistItem, EquipmentItem, InstallStatus } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

const MAX_PHOTOS = 8;

interface Photo {
  blob: Blob;
  url: string;
}

function genUuid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

// Status the technician can set from the field (pending/scheduled are set by
// the assigner, not on-site).
const FIELD_STATUSES: InstallStatus[] = ['in_progress', 'done', 'needs_revisit'];

export function InstallForm({
  technicianId,
  technicianName,
  installationId,
  contactId,
  contactName,
  jobTitle,
  initialChecklist,
  initialEquipment,
  initialStatus,
}: {
  technicianId: string;
  technicianName?: string | null;
  installationId: string;
  contactId: string;
  contactName: string | null;
  jobTitle: string | null;
  initialChecklist: ChecklistItem[] | null;
  initialEquipment: EquipmentItem[] | null;
  initialStatus: InstallStatus | null;
}) {
  const t = useTranslations('installation');
  const geo = useGeolocation(true);
  const [isPending, startTransition] = useTransition();

  const [checklist, setChecklist] = useState<ChecklistItem[]>(
    initialChecklist?.length ? initialChecklist : freshChecklist(),
  );
  const [equipment, setEquipment] = useState<EquipmentItem[]>(
    initialEquipment ?? [],
  );
  const [status, setStatus] = useState<InstallStatus>(
    initialStatus && FIELD_STATUSES.includes(initialStatus)
      ? initialStatus
      : 'in_progress',
  );
  const [nextVisitDate, setNextVisitDate] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<
    { kind: 'ok'; text: string } | { kind: 'error'; text: string } | null
  >(null);

  const hasFix = geo.status === 'ready' && geo.lat != null && geo.lng != null;
  const gpsResolved = hasFix || geo.status === 'error';
  const noGps = !hasFix && geo.status === 'error';

  useEffect(() => {
    if (!hasFix || geo.lat == null || geo.lng == null) return;
    let cancelled = false;
    setAddress(null);
    reverseGeocode(geo.lat, geo.lng).then((a) => {
      if (!cancelled) setAddress(a);
    });
    return () => {
      cancelled = true;
    };
  }, [hasFix, geo.lat, geo.lng]);

  const doneCount = checklist.filter((c) => c.done).length;

  const canSave =
    gpsResolved &&
    photos.length >= 1 &&
    !processing &&
    (status !== 'needs_revisit' || !!nextVisitDate);

  function toggleStep(idx: number) {
    setChecklist((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, done: !c.done } : c)),
    );
  }

  function addEquipment() {
    setEquipment((prev) => [...prev, { label: '', serial: '' }]);
  }
  function updateEquipment(idx: number, field: keyof EquipmentItem, value: string) {
    setEquipment((prev) =>
      prev.map((e, i) => (i === idx ? { ...e, [field]: value } : e)),
    );
  }
  function removeEquipment(idx: number) {
    setEquipment((prev) => prev.filter((_, i) => i !== idx));
  }

  function startCheckIn() {
    geo.locate();
    document.getElementById('install-photo-input')?.click();
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setResult(null);
    setProcessing(true);
    try {
      const blob = await processCheckInPhoto(file, {
        lat: hasFix ? geo.lat : null,
        lng: hasFix ? geo.lng : null,
        accuracy: geo.accuracy,
        at: new Date(),
        address,
        by: technicianName,
      });
      setPhotos((prev) =>
        [...prev, { blob, url: URL.createObjectURL(blob) }].slice(0, MAX_PHOTOS),
      );
    } catch {
      setResult({ kind: 'error', text: t('photoError') });
    } finally {
      setProcessing(false);
    }
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => {
      const p = prev[idx];
      if (p) URL.revokeObjectURL(p.url);
      return prev.filter((_, i) => i !== idx);
    });
  }

  function onSave() {
    if (!canSave) return;
    setResult(null);
    startTransition(async () => {
      const clientUuid = genUuid();
      let photoPaths: string[] = [];
      try {
        setUploading(true);
        photoPaths = await Promise.all(
          photos.map((p, i) => uploadVisitPhoto(technicianId, clientUuid, i, p.blob)),
        );
      } catch {
        setUploading(false);
        setResult({ kind: 'error', text: t('saveError') });
        return;
      }
      setUploading(false);

      // Keep only filled equipment rows.
      const cleanEquipment = equipment
        .map((e) => ({ label: e.label.trim(), serial: e.serial.trim() }))
        .filter((e) => e.label || e.serial);

      const res = await saveInstallation({
        installationId,
        clientUuid,
        contactId,
        lat: hasFix ? geo.lat : null,
        lng: hasFix ? geo.lng : null,
        status,
        checklist,
        equipment: cleanEquipment,
        notes: notes.trim() || null,
        nextVisitDate: status === 'needs_revisit' && nextVisitDate ? nextVisitDate : null,
        photoPaths,
      });

      if (res.ok) {
        setResult({
          kind: 'ok',
          text: status === 'done' ? t('savedDone') : t('savedProgress'),
        });
        photos.forEach((p) => URL.revokeObjectURL(p.url));
        setPhotos([]);
        setNotes('');
      } else {
        setResult({ kind: 'error', text: t('saveError') });
      }
    });
  }

  const gpsLine = hasFix
    ? t('gpsShort', { m: Math.round(geo.accuracy ?? 0) })
    : noGps
      ? t('gpsNoneShort')
      : t('gpsLocatingShort');

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4 pb-28">
      <input
        id="install-photo-input"
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPickPhoto}
      />

      {/* Which customer / affaire is being installed */}
      <Card className="p-4">
        <p className="text-xs text-muted-foreground">{t('installingFor')}</p>
        <p className="text-lg font-semibold">{contactName ?? '—'}</p>
        {jobTitle && (
          <p className="mt-0.5 inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-sm font-medium text-primary">
            {t('affaire')}: {jobTitle}
          </p>
        )}
      </Card>

      {/* Photo + GPS check-in */}
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">{t('photo')}</p>
            <p className="text-xs text-muted-foreground">{t('checkinHint')}</p>
          </div>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              photos.length > 0
                ? 'bg-knock-green/15 text-knock-green'
                : 'bg-destructive/10 text-destructive'
            }`}
          >
            {photos.length > 0 ? t('photoCount', { n: photos.length }) : t('photoRequired')}
          </span>
        </div>

        {photos.length === 0 ? (
          <button
            type="button"
            onClick={startCheckIn}
            disabled={processing}
            className="flex min-h-[120px] w-full flex-col items-center justify-center gap-2 rounded-lg bg-primary text-primary-foreground shadow-sm disabled:opacity-50"
          >
            <Camera className="h-8 w-8" />
            <span className="text-base font-semibold">
              {processing ? t('processingPhoto') : t('capture')}
            </span>
          </button>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative aspect-square overflow-hidden rounded-lg border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  aria-label={t('removePhoto')}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={startCheckIn}
                disabled={processing}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-input text-muted-foreground disabled:opacity-50"
              >
                <Camera className="h-6 w-6" />
                <span className="px-1 text-center text-xs font-medium">
                  {processing ? t('processingPhoto') : t('addPhoto')}
                </span>
              </button>
            )}
          </div>
        )}

        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 text-xs">
            <MapPin
              className={`h-3.5 w-3.5 ${hasFix ? 'text-knock-green' : 'text-muted-foreground'}`}
            />
            <span className={hasFix ? 'font-medium text-knock-green' : 'text-muted-foreground'}>
              {gpsLine}
            </span>
          </div>
          {hasFix && address && <p className="pl-5 text-xs text-muted-foreground">{address}</p>}
        </div>

        {noGps && (
          <div className="flex items-center gap-2 rounded-md bg-brand-amber/15 px-3 py-2 text-sm font-medium text-brand-brown">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t('gpsDenied')}
          </div>
        )}
      </Card>

      {/* Installation checklist */}
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">{t('checklist')}</p>
          <span className="text-xs text-muted-foreground">
            {t('stepsDone', { done: doneCount, total: checklist.length })}
          </span>
        </div>
        <div className="space-y-1.5">
          {checklist.map((step, i) => (
            <button
              key={step.key}
              type="button"
              onClick={() => toggleStep(i)}
              className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                step.done
                  ? 'border-brand-green/40 bg-brand-green/10 font-medium text-brand-green'
                  : 'border-input bg-background'
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                  step.done ? 'border-brand-green bg-brand-green text-white' : 'border-input'
                }`}
              >
                {step.done && <CheckCircle2 className="h-4 w-4" />}
              </span>
              {step.label}
            </button>
          ))}
        </div>
      </Card>

      {/* Equipment / serial numbers */}
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">{t('equipment')}</p>
          <button
            type="button"
            onClick={addEquipment}
            className="flex items-center gap-1 text-sm font-medium text-primary"
          >
            <Plus className="h-4 w-4" />
            {t('addEquipment')}
          </button>
        </div>
        {equipment.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('noEquipment')}</p>
        ) : (
          <div className="space-y-2">
            {equipment.map((e, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={e.label}
                  onChange={(ev) => updateEquipment(i, 'label', ev.target.value)}
                  placeholder={t('equipmentLabel')}
                  className="flex-1"
                />
                <Input
                  value={e.serial}
                  onChange={(ev) => updateEquipment(i, 'serial', ev.target.value)}
                  placeholder={t('serial')}
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => removeEquipment(i)}
                  aria-label={t('removeEquipment')}
                  className="shrink-0 text-muted-foreground"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Outcome / status */}
      <div>
        <p className="mb-2 text-sm font-semibold">{t('outcome')}</p>
        <div className="grid grid-cols-3 gap-2">
          {FIELD_STATUSES.map((s) => {
            const selected = status === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`min-h-[56px] rounded-lg px-2 text-sm font-semibold shadow-sm transition ${
                  s === 'done'
                    ? 'bg-knock-green text-white'
                    : s === 'needs_revisit'
                      ? 'bg-brand-amber text-black'
                      : 'bg-secondary text-secondary-foreground'
                } ${selected ? 'ring-4 ring-offset-2 ring-foreground/30' : 'opacity-90'}`}
              >
                {t(`status.${s}`)}
              </button>
            );
          })}
        </div>
      </div>

      {status === 'needs_revisit' && (
        <div className="space-y-2">
          <Label htmlFor="revisit">{t('nextVisitDate')}</Label>
          <Input
            id="revisit"
            type="date"
            value={nextVisitDate}
            onChange={(e) => setNextVisitDate(e.target.value)}
          />
        </div>
      )}

      {/* Notes */}
      <div className="space-y-2">
        <Label htmlFor="notes">{t('notes')}</Label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('notesPlaceholder')}
          rows={2}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-base"
        />
      </div>

      {result && (
        <div
          className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
            result.kind === 'ok'
              ? 'bg-knock-green/15 text-knock-green'
              : 'bg-destructive/10 text-destructive'
          }`}
          role="status"
        >
          {result.kind === 'ok' && <CheckCircle2 className="h-4 w-4 shrink-0" />}
          {result.text}
        </div>
      )}

      {/* Sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t bg-background/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <Button
            size="xl"
            className="w-full"
            onClick={onSave}
            disabled={!canSave || isPending}
          >
            {uploading ? t('uploadingPhotos') : isPending ? t('saving') : t('save')}
          </Button>
        </div>
      </div>
    </main>
  );
}
