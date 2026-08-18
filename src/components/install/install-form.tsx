'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  Camera,
  CheckCircle2,
  Loader2,
  MapPin,
  Mic,
  Plus,
  Square,
  Trash2,
  X,
  AlertTriangle,
} from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useDictation } from '@/hooks/use-dictation';
import { useGeolocation } from '@/hooks/use-geolocation';
import { markUnsaved } from '@/lib/ui/unsaved';
import { reverseGeocode } from '@/lib/geo/reverse';
import { processCheckInPhoto } from '@/lib/image/capture';
import { dHash, type PhotoMeta } from '@/lib/image/phash';
import { uploadVisitPhoto } from '@/lib/visits/upload';
import { saveInstallation, type InterventionOrigin } from '@/lib/installations/actions';
import { enqueueInstall } from '@/lib/offline/queue';
import { freshChecklist } from '@/lib/installations/protocol';
import type { ChecklistItem, EquipmentItem, InstallStatus } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { PhotoSlots } from '@/components/shared/photo-slots';

const MAX_EXTRA_PHOTOS = 6; // documentation shots, on top of the arrival + end pair

interface Photo {
  blob: Blob;
  url: string;
  meta: PhotoMeta;
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
  taskId = null,
  contacts = [],
}: {
  technicianId: string;
  technicianName?: string | null;
  /** Null when this trip opens its own job — an SAV done on the spot. */
  installationId: string | null;
  contactId: string | null;
  contactName: string | null;
  jobTitle: string | null;
  /** Customers to choose from, only needed in "new intervention" mode. */
  contacts?: { id: string; name: string | null; address: string | null }[];
  initialChecklist: ChecklistItem[] | null;
  initialEquipment: EquipmentItem[] | null;
  initialStatus: InstallStatus | null;
  /** Set when the trip was started from a planned follow-up. */
  taskId?: string | null;
}) {
  const t = useTranslations('installation');
  const tVisit = useTranslations('visit'); // shared dictation labels
  const tInt = useTranslations('intervention');
  const geo = useGeolocation(true);
  const router = useRouter();
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
  // "New intervention" mode: no job yet, so the trip carries what to create.
  const isNew = !installationId;
  const [pickedContact, setPickedContact] = useState<string | null>(contactId);
  const [contactQuery, setContactQuery] = useState('');
  const [origin, setOrigin] = useState<InterventionOrigin>('service');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const dictation = useDictation((text) =>
    setNotes((prev) => (prev ? prev + ' ' + text : text)),
  );
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

  // Everything here lives in the browser until saved — the photos above all.
  const filledEquipment = (rows: EquipmentItem[]) =>
    rows.filter((e) => e.label?.trim() || e.serial?.trim()).length;
  const started =
    photos.length > 0 ||
    notes.trim() !== '' ||
    doneCount !== (initialChecklist ?? []).filter((c) => c.done).length ||
    filledEquipment(equipment) !== filledEquipment(initialEquipment ?? []);

  useEffect(() => {
    markUnsaved(started ? t('cancelConfirm') : null);
    return () => markUnsaved(null);
  }, [started, t]);

  /** Leave the job screen, warning when work would be lost. */
  function onCancel() {
    if (started && !window.confirm(t('cancelConfirm'))) return;
    markUnsaved(null);
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    if (window.history.length > 1) router.back();
    else router.push('/home');
  }

  // EVERY trip closes with an end-of-work photo on top of the arrival one:
  // it measures the time actually spent on site (and stamps completed_at
  // when the job is marked done).
  const hasArrival = photos.some((p) => p.meta.kind === 'arrival');
  const hasCompletion = photos.some((p) => p.meta.kind === 'completion');
  const needsCompletion = hasArrival && !hasCompletion;

  const canSave =
    gpsResolved &&
    hasArrival &&
    hasCompletion &&
    !processing &&
    (!isNew || !!pickedContact) &&
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

  const nextKindRef = useRef<PhotoMeta['kind'] | null>(null);

  function startCheckIn(kind?: PhotoMeta['kind']) {
    nextKindRef.current = kind ?? null;
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
      const capturedAt = new Date();
      const blob = await processCheckInPhoto(file, {
        lat: hasFix ? geo.lat : null,
        lng: hasFix ? geo.lng : null,
        accuracy: geo.accuracy,
        at: capturedAt,
        address,
        by: technicianName,
      });
      const phash = await dHash(blob);
      // Read the requested kind NOW — the setPhotos updater runs later, after
      // the ref is cleared below.
      const requestedKind = nextKindRef.current;
      nextKindRef.current = null;
      setPhotos((prev) => {
        const kind =
          requestedKind ??
          (prev.some((p) => p.meta.kind === 'arrival') ? 'extra' : 'arrival');
        const meta: PhotoMeta = {
          kind,
          lat: hasFix ? geo.lat : null,
          lng: hasFix ? geo.lng : null,
          accuracy: geo.accuracy,
          capturedAt: capturedAt.toISOString(),
          phash,
        };
        const shot = { blob, url: URL.createObjectURL(blob), meta };
        // Arrival / end are single slots: a re-take replaces what's there.
        if (kind !== 'extra') {
          const existing = prev.findIndex((p) => p.meta.kind === kind);
          if (existing >= 0) {
            URL.revokeObjectURL(prev[existing].url);
            return prev.map((p, i) => (i === existing ? shot : p));
          }
          return [...prev, shot];
        }
        if (prev.filter((p) => p.meta.kind === 'extra').length >= MAX_EXTRA_PHOTOS) {
          URL.revokeObjectURL(shot.url);
          return prev;
        }
        return [...prev, shot];
      });
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
      // Keep only filled equipment rows.
      const cleanEquipment = equipment
        .map((e) => ({ label: e.label.trim(), serial: e.serial.trim() }))
        .filter((e) => e.label || e.serial);
      const arrivalAt = photos.find((p) => p.meta.kind === 'arrival')?.meta.capturedAt;
      const payload = {
        installationId,
        contactId: (isNew ? pickedContact : contactId) as string,
        newIntervention: isNew
          ? { origin, title: t(`origin_${origin}` as never), reason: reason.trim() || null }
          : null,
        lat: hasFix ? geo.lat : null,
        lng: hasFix ? geo.lng : null,
        status,
        checklist,
        equipment: cleanEquipment,
        notes: notes.trim() || null,
        nextVisitDate: status === 'needs_revisit' && nextVisitDate ? nextVisitDate : null,
        visitedAt: new Date().toISOString(),
        taskId,
        startedAt: arrivalAt ?? photos[0]?.meta.capturedAt ?? null,
        photoMeta: photos.map((p) => p.meta),
      };

      // No network (or it drops mid-save): keep the trip in the offline queue.
      const queueOffline = async () => {
        try {
          await enqueueInstall({
            clientUuid,
            installerId: technicianId,
            payload,
            photos: photos.map((p) => p.blob),
            queuedAt: new Date().toISOString(),
          });
          setResult({ kind: 'ok', text: t('savedOffline') });
          photos.forEach((p) => URL.revokeObjectURL(p.url));
          setPhotos([]);
          setNotes('');
          return true;
        } catch {
          return false;
        }
      };

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (await queueOffline()) return;
        setResult({ kind: 'error', text: t('saveError') });
        return;
      }

      let photoPaths: string[] = [];
      try {
        setUploading(true);
        photoPaths = await Promise.all(
          photos.map((p, i) => uploadVisitPhoto(technicianId, clientUuid, i, p.blob)),
        );
      } catch {
        setUploading(false);
        if (await queueOffline()) return;
        setResult({ kind: 'error', text: t('saveError') });
        return;
      }
      setUploading(false);

      let res: Awaited<ReturnType<typeof saveInstallation>>;
      try {
        res = await saveInstallation({ clientUuid, ...payload, photoPaths });
      } catch {
        if (await queueOffline()) return;
        setResult({ kind: 'error', text: t('saveError') });
        return;
      }

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

      {/* Which customer / affaire is being installed. In "new intervention"
          mode the job does not exist yet, so this block asks what to open —
          and saving below creates it together with the trip, in one step. */}
      {isNew ? (
        <Card className="space-y-3 p-4">
          <p className="text-sm font-semibold">{tInt('customer')}</p>
          {pickedContact ? (
            <div className="flex items-center justify-between gap-2 rounded-md bg-primary/10 px-3 py-2">
              <span className="truncate text-sm font-medium text-primary">
                {contacts.find((c) => c.id === pickedContact)?.name ?? contactName ?? '—'}
              </span>
              <button
                type="button"
                onClick={() => setPickedContact(null)}
                className="shrink-0 text-xs text-muted-foreground underline"
              >
                {tInt('change')}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                value={contactQuery}
                onChange={(e) => setContactQuery(e.target.value)}
                placeholder={tInt('searchCustomer')}
                autoFocus
              />
              <div className="max-h-56 overflow-y-auto rounded-md border">
                {(contactQuery.trim()
                  ? contacts.filter((c) =>
                      (c.name ?? '').toLowerCase().includes(contactQuery.trim().toLowerCase()),
                    )
                  : contacts
                )
                  .slice(0, 25)
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setPickedContact(c.id)}
                      className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-accent"
                    >
                      <span className="text-sm">{c.name ?? '—'}</span>
                      {c.address && <span className="text-xs text-muted-foreground">{c.address}</span>}
                    </button>
                  ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-sm font-semibold">{tInt('type')}</p>
            <div className="grid grid-cols-3 gap-2">
              {(['service', 'warranty', 'maintenance'] as InterventionOrigin[]).map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOrigin(o)}
                  className={`min-h-touch rounded-lg border px-2 text-sm font-medium ${
                    origin === o
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-input bg-background'
                  }`}
                >
                  {tInt(`origin_${o}` as never)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="i-reason">{tInt('reason')}</Label>
            <Input
              id="i-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={tInt('reasonPlaceholder')}
            />
          </div>
          <p className="text-xs text-muted-foreground">{tInt('noSaleHint')}</p>
        </Card>
      ) : (
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">{t('installingFor')}</p>
          <p className="text-lg font-semibold">{contactName ?? '—'}</p>
          {jobTitle && (
            <p className="mt-0.5 inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-sm font-medium text-primary">
              {t('affaire')}: {jobTitle}
            </p>
          )}
        </Card>
      )}

      {/* Photo + GPS check-in */}
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">{t('photo')}</p>
            <p className="text-xs text-muted-foreground">{t('checkinHint')}</p>
          </div>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              hasCompletion
                ? 'bg-knock-green/15 text-knock-green'
                : hasArrival
                  ? 'bg-brand-amber/20 text-brand-brown'
                  : 'bg-destructive/10 text-destructive'
            }`}
          >
            {hasCompletion
              ? tVisit('photoPairDone')
              : hasArrival
                ? tVisit('photoEndMissing')
                : tVisit('photoPairRequired')}
          </span>
        </div>

        <PhotoSlots
          photos={photos.map((p) => ({ url: p.url, kind: p.meta.kind }))}
          onCapture={startCheckIn}
          onRemove={removePhoto}
          processing={processing}
          maxExtra={MAX_EXTRA_PHOTOS}
          labels={{
            arrival: tVisit('photoArrival'),
            completion: tVisit('photoCompletion'),
            arrivalEmpty: tVisit('slotArrivalEmpty'),
            completionEmpty: tVisit('slotCompletionEmpty'),
            completionLocked: tVisit('slotCompletionLocked'),
            extraTitle: t('slotExtraTitle'),
            extraHint: t('slotExtraHint'),
            add: t('addPhoto'),
            remove: t('removePhoto'),
            processing: t('processingPhoto'),
          }}
        />
        {hasCompletion && (
          <p className="text-xs font-medium text-knock-green">✓ {tVisit('completionDone')}</p>
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

      {/* Notes — optional, with voice dictation */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="notes">{t('notes')}</Label>
          {dictation.status !== 'unsupported' && (
            <button
              type="button"
              onClick={dictation.toggle}
              disabled={dictation.status === 'processing'}
              className={`flex min-h-touch items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium ${
                dictation.status === 'recording'
                  ? 'border-destructive bg-destructive/10 text-destructive'
                  : 'border-input bg-background text-foreground'
              }`}
              aria-label={tVisit('dictate')}
            >
              {dictation.status === 'recording' ? (
                <>
                  <Square className="h-4 w-4" /> {tVisit('dictateStop')}
                </>
              ) : dictation.status === 'processing' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> …
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" /> {tVisit('dictate')}
                </>
              )}
            </button>
          )}
        </div>
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
        <div className="mx-auto flex max-w-lg gap-2">
          <Button
            variant="outline"
            size="xl"
            className="flex-1"
            onClick={onCancel}
            disabled={isPending}
          >
            {t('cancel')}
          </Button>
          <Button
            size="xl"
            className="flex-[2]"
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
