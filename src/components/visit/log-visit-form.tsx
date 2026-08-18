'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Camera,
  Loader2,
  Mic,
  Square,
  X,
  MapPin,
} from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useDictation, withLivePreview } from '@/hooks/use-dictation';
import { useGeolocation } from '@/hooks/use-geolocation';
import { pointInAnyPolygon, haversineMeters } from '@/lib/geo';
import { reverseGeocode } from '@/lib/geo/reverse';
import {
  DISPOSITIONS,
  DISPOSITION_BTN_CLASSES,
  DISPOSITION_BY_KEY,
  type KnockDisposition,
} from '@/lib/visits/dispositions';
import { saveVisit } from '@/lib/visits/actions';
import { proposeDnkEntry } from '@/lib/dnk/actions';
import { enqueueVisit } from '@/lib/offline/queue';
import { processCheckInPhoto } from '@/lib/image/capture';
import { dHash, type PhotoMeta } from '@/lib/image/phash';
import { markUnsaved } from '@/lib/ui/unsaved';
import { uploadVisitPhoto } from '@/lib/visits/upload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { PhotoSlots } from '@/components/shared/photo-slots';

const DNK_RADIUS_M = 20;
const MAX_EXTRA_PHOTOS = 3; // on top of the arrival + end pair

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

interface PickContact {
  id: string;
  name: string | null;
  lifecycle: string;
  lat: number | null;
  lng: number | null;
  deals?: { id: string; title: string | null; status: string }[] | null;
}

export function LogVisitForm({
  repId,
  repName,
  turfPolygons,
  dnkPoints,
  attachedContact,
  contacts = [],
  dispositionSettings,
  taskId = null,
  presetDealId = null,
}: {
  repId: string;
  repName?: string | null;
  turfPolygons: number[][][][];
  dnkPoints: { lat: number; lng: number }[];
  canDoB2b: boolean;
  attachedContact?: { id: string; name: string | null } | null;
  contacts?: PickContact[];
  /** Set when the visit was started from a planned follow-up — closes it on save. */
  taskId?: string | null;
  presetDealId?: string | null;
  /** Admin-configured labels/visibility per outcome (defaults when absent). */
  dispositionSettings?: Partial<
    Record<KnockDisposition, { label: string | null; active: boolean }>
  >;
}) {
  const t = useTranslations('visit');
  const tDisp = useTranslations('dispositions');
  const tLife = useTranslations('lifecycle');
  const geo = useGeolocation(true);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [disposition, setDisposition] = useState<KnockDisposition | null>(null);
  const [notes, setNotes] = useState('');
  const [dnkFlag, setDnkFlag] = useState(false);
  const [appointmentDate, setAppointmentDate] = useState('');
  const [contactName, setContactName] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<
    { kind: 'ok'; text: string } | { kind: 'error'; text: string } | null
  >(null);
  const [linked, setLinked] = useState<{ id: string; name: string | null } | null>(
    attachedContact ?? null,
  );
  const dictation = useDictation((text) =>
    setNotes((prev) => (prev ? prev + ' ' + text : text)),
  );
  // Two rows only, so keep the words being spoken in view.
  const notesRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = notesRef.current;
    if (el && dictation.interim) el.scrollTop = el.scrollHeight;
  }, [dictation.interim]);
  const [dealId, setDealId] = useState<string | null>(presetDealId);
  const [showPicker, setShowPicker] = useState(false);
  const [contactQuery, setContactQuery] = useState('');

  // Affaires of the currently linked contact (for the deal picker).
  const linkedDeals = useMemo(
    () => (linked ? (contacts.find((c) => c.id === linked.id)?.deals ?? []) : []),
    [linked, contacts],
  );

  const hasFix = geo.status === 'ready' && geo.lat != null && geo.lng != null;
  const gpsResolved = hasFix || geo.status === 'error';
  const noGps = !hasFix && geo.status === 'error';

  const outOfTurf = useMemo(() => {
    if (!hasFix || turfPolygons.length === 0) return false;
    return !pointInAnyPolygon(geo.lat!, geo.lng!, turfPolygons);
  }, [hasFix, geo.lat, geo.lng, turfPolygons]);

  const dnkBlocked = useMemo(() => {
    if (!hasFix) return false;
    return dnkPoints.some(
      (p) => haversineMeters(geo.lat!, geo.lng!, p.lat, p.lng) <= DNK_RADIUS_M,
    );
  }, [hasFix, geo.lat, geo.lng, dnkPoints]);

  // Best-effort reverse geocode when a fix arrives (never blocks the check-in).
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

  // Existing contacts near the current GPS fix (link a visit to one of them).
  const nearbyContacts = useMemo(() => {
    if (!hasFix || linked) return [];
    return contacts
      .filter(
        (c) =>
          c.lat != null &&
          c.lng != null &&
          haversineMeters(geo.lat!, geo.lng!, c.lat, c.lng) <= 150,
      )
      .slice(0, 5);
  }, [hasFix, geo.lat, geo.lng, contacts, linked]);

  // Combobox behaviour: no query → droplist of all contacts (most recently
  // active first, capped for DOM weight); typing filters it down.
  const searchResults = useMemo(() => {
    const q = contactQuery.trim().toLowerCase();
    if (!q) return contacts.slice(0, 100);
    return contacts.filter((c) => (c.name ?? '').toLowerCase().includes(q)).slice(0, 20);
  }, [contactQuery, contacts]);

  const meta = disposition ? DISPOSITION_BY_KEY[disposition] : null;
  const needsAppointment = meta?.needsAppointment ?? false;
  const isEngaged = meta?.createsContact ?? false;

  // Anti-fraud photo pair: EVERY visit needs an arrival and an end photo —
  // proves presence over time and measures how long the rep stayed.
  const hasArrival = photos.some((p) => p.meta.kind === 'arrival');
  const hasCompletion = photos.some((p) => p.meta.kind === 'completion');
  const needsCompletion = hasArrival && !hasCompletion;

  const canSave =
    gpsResolved &&
    !dnkBlocked &&
    disposition != null &&
    hasArrival &&
    hasCompletion &&
    !processing &&
    (!needsAppointment || !!appointmentDate);

  // Work in progress lives only in this component (the photos are blobs), so
  // every way off the screen — Annuler, the header's back/home/logo, a reload
  // — has to warn first.
  const started =
    photos.length > 0 ||
    disposition != null ||
    notes.trim() !== '' ||
    contactName.trim() !== '' ||
    appointmentDate !== '';

  useEffect(() => {
    markUnsaved(started ? t('cancelConfirm') : null);
    return () => markUnsaved(null);
  }, [started, t]);

  /** "Annuler" abandons the visit and leaves the screen. */
  function onCancel() {
    if (started && !window.confirm(t('cancelConfirm'))) return;
    markUnsaved(null);
    reset();
    setResult(null);
    if (window.history.length > 1) router.back();
    else router.push('/home');
  }

  function reset() {
    setDisposition(null);
    setNotes('');
    setAppointmentDate('');
    setContactName('');
    setLinked(attachedContact ?? null);
    setDealId(null);
    setShowPicker(false);
    setContactQuery('');
    photos.forEach((p) => URL.revokeObjectURL(p.url));
    setPhotos([]);
  }

  // Which kind the next captured photo gets ('completion' when the rep taps
  // the end-of-visit button; otherwise arrival-if-first, extra after).
  const nextKindRef = useRef<PhotoMeta['kind'] | null>(null);

  /** One action: refresh GPS *and* open the camera. */
  function startCheckIn(kind?: PhotoMeta['kind']) {
    if (dnkBlocked) return;
    nextKindRef.current = kind ?? null;
    geo.locate();
    fileInputRef.current?.click();
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
        by: repName,
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
    if (!canSave || !disposition) return;
    setResult(null);
    startTransition(async () => {
      const clientUuid = genUuid();
      const arrivalAt = photos.find((p) => p.meta.kind === 'arrival')?.meta.capturedAt;
      const payload = {
        visitType: (linked ? 'b2b_visit' : 'd2d_knock') as 'b2b_visit' | 'd2d_knock',
        lat: hasFix ? geo.lat : null,
        lng: hasFix ? geo.lng : null,
        disposition,
        notes: notes.trim() || null,
        appointmentDate: needsAppointment && appointmentDate ? appointmentDate : null,
        contactName: isEngaged && !linked && contactName.trim() ? contactName.trim() : null,
        address: hasFix ? address : null,
        contactId: linked?.id ?? null,
        dealId: linked ? dealId : null,
        visitedAt: new Date().toISOString(),
        startedAt: arrivalAt ?? photos[0]?.meta.capturedAt ?? null,
        photoMeta: photos.map((p) => p.meta),
        taskId,
      };

      // No network: keep the visit (photos included) in the offline queue.
      const queueOffline = async () => {
        try {
          await enqueueVisit({
            clientUuid,
            repId,
            payload,
            photos: photos.map((p) => p.blob),
            queuedAt: new Date().toISOString(),
          });
          setResult({ kind: 'ok', text: t('savedOffline') });
          reset();
          geo.locate();
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
          photos.map((p, i) => uploadVisitPhoto(repId, clientUuid, i, p.blob)),
        );
      } catch {
        setUploading(false);
        // Upload failing usually means the connection just dropped — queue it.
        if (await queueOffline()) return;
        setResult({ kind: 'error', text: t('saveError') });
        return;
      }
      setUploading(false);

      let res: Awaited<ReturnType<typeof saveVisit>>;
      try {
        res = await saveVisit({ clientUuid, ...payload, photoPaths });
      } catch {
        // Server action unreachable mid-save — queue it (idempotent retry).
        if (await queueOffline()) return;
        setResult({ kind: 'error', text: t('saveError') });
        return;
      }

      if (res.ok) {
        // Rep flagged a hostile door → file a DNK proposal for the admin.
        if (dnkFlag && hasFix) {
          await proposeDnkEntry({ lat: geo.lat!, lng: geo.lng!, address }).catch(() => undefined);
          setDnkFlag(false);
        }
        const savedMsg =
          meta?.lifecycle === 'customer'
            ? t('savedCustomer')
            : meta?.createsContact
              ? t('savedLead')
              : t('savedKnock');
        setResult({ kind: 'ok', text: savedMsg });
        reset();
        geo.locate();
      } else {
        setResult({
          kind: 'error',
          text: res.error === 'do_not_knock' ? t('dnkBlocked') : t('saveError'),
        });
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
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPickPhoto}
      />

      {/* Link this visit to an existing lead / customer (or leave New) */}
      <Card className="space-y-3 p-4">
        <p className="text-sm font-semibold">{t('linkTitle')}</p>
        {linked ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 rounded-md bg-primary/10 px-3 py-2">
              <span className="truncate text-sm font-medium text-primary">
                {linked.name ?? '—'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setLinked(null);
                  setDealId(null);
                  setShowPicker(false);
                }}
                className="shrink-0 text-xs text-muted-foreground underline"
              >
                {t('unlink')}
              </button>
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">{t('whichAffaire')}</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setDealId(null)}
                  className={`min-h-touch rounded-full border px-3 py-1 text-sm font-medium ${
                    dealId === null ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background'
                  }`}
                >
                  + {t('newAffaire')}
                </button>
                {linkedDeals.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDealId(d.id)}
                    className={`min-h-touch rounded-full border px-3 py-1 text-sm font-medium ${
                      dealId === d.id ? 'border-primary bg-primary/10 text-primary' : 'border-input bg-background'
                    }`}
                  >
                    {d.title || t('affaire')}
                    {d.status === 'won' ? ' ✓' : d.status === 'lost' ? ' ✗' : ''}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {nearbyContacts.length > 0 && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">{t('nearby')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {nearbyContacts.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setLinked({ id: c.id, name: c.name })}
                      className="rounded-full border border-input bg-background px-3 py-1 text-xs font-medium hover:bg-accent"
                    >
                      {c.name ?? '—'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!showPicker ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setShowPicker(true)}
              >
                🔍 {t('linkExisting')}
              </Button>
            ) : (
              <div className="space-y-2">
                <Input
                  value={contactQuery}
                  onChange={(e) => setContactQuery(e.target.value)}
                  placeholder={t('searchContact')}
                  autoFocus
                />
                <div className="max-h-64 overflow-y-auto rounded-md border">
                  {searchResults.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">{t('noMatch')}</p>
                  ) : (
                    searchResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setLinked({ id: c.id, name: c.name });
                          setShowPicker(false);
                          setContactQuery('');
                        }}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        <span className="truncate">{c.name ?? '—'}</span>
                        <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                          {tLife(c.lifecycle as never)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t('linkNew')}</p>
          </div>
        )}
      </Card>

      {/* Combined Photo + GPS check-in */}
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
              ? t('photoPairDone')
              : hasArrival
                ? t('photoEndMissing')
                : t('photoPairRequired')}
          </span>
        </div>

        <PhotoSlots
          photos={photos.map((p) => ({ url: p.url, kind: p.meta.kind }))}
          onCapture={startCheckIn}
          onRemove={removePhoto}
          processing={processing}
          disabled={dnkBlocked}
          maxExtra={MAX_EXTRA_PHOTOS}
          labels={{
            arrival: t('photoArrival'),
            completion: t('photoCompletion'),
            arrivalEmpty: t('slotArrivalEmpty'),
            completionEmpty: t('slotCompletionEmpty'),
            completionLocked: t('slotCompletionLocked'),
            extraTitle: t('slotExtraTitle'),
            extraHint: t('slotExtraHint'),
            add: t('addPhoto'),
            remove: t('removePhoto'),
            processing: t('processingPhoto'),
          }}
        />
        {hasCompletion && (
          <p className="text-xs font-medium text-knock-green">✓ {t('completionDone')}</p>
        )}

        {/* GPS status line + resolved address */}
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 text-xs">
            <MapPin
              className={`h-3.5 w-3.5 ${hasFix ? 'text-knock-green' : 'text-muted-foreground'}`}
            />
            <span className={hasFix ? 'font-medium text-knock-green' : 'text-muted-foreground'}>
              {gpsLine}
            </span>
          </div>
          {hasFix && address && (
            <p className="pl-5 text-xs text-muted-foreground">{address}</p>
          )}
        </div>

        {outOfTurf && (
          <div className="flex items-center gap-2 rounded-md bg-brand-amber/15 px-3 py-2 text-sm font-medium text-brand-brown">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t('outOfTurf')}
          </div>
        )}
        {dnkBlocked && (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
            <Ban className="h-4 w-4 shrink-0" />
            {t('dnkBlocked')}
          </div>
        )}
        {noGps && !dnkBlocked && (
          <div className="flex items-center gap-2 rounded-md bg-brand-amber/15 px-3 py-2 text-sm font-medium text-brand-brown">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t('gpsDenied')}
          </div>
        )}
      </Card>

      {/* Disposition buttons */}
      <div>
        <p className="mb-2 text-sm font-semibold">{t('disposition')}</p>
        <div className="grid grid-cols-2 gap-2">
          {DISPOSITIONS.filter((d) => dispositionSettings?.[d.key]?.active !== false).map(
            (d) => {
              const selected = disposition === d.key;
              return (
                <button
                  key={d.key}
                  type="button"
                  disabled={dnkBlocked}
                  onClick={() => setDisposition(d.key)}
                  className={`min-h-[64px] rounded-lg px-3 text-base font-semibold shadow-sm transition disabled:opacity-40 ${
                    DISPOSITION_BTN_CLASSES[d.color]
                  } ${selected ? 'ring-4 ring-offset-2 ring-foreground/30' : 'opacity-95'}`}
                >
                  {dispositionSettings?.[d.key]?.label || tDisp(d.key)}
                </button>
              );
            },
          )}
        </div>
      </div>

      {/* Duplicate guard: an engaged knock about to CREATE a contact within
          30 m of an existing one is probably the same business. */}
      {isEngaged &&
        !linked &&
        hasFix &&
        (() => {
          const dupe = contacts.find(
            (c) =>
              c.lat != null &&
              c.lng != null &&
              haversineMeters(geo.lat!, geo.lng!, c.lat, c.lng) <= 30,
          );
          return dupe ? (
            <div className="flex items-center justify-between gap-2 rounded-md bg-brand-amber/15 px-3 py-2">
              <span className="min-w-0 text-sm">
                ⚠️ {t('dupeWarning', { name: dupe.name ?? t('noNameContact') })}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => setLinked({ id: dupe.id, name: dupe.name })}
              >
                {t('dupeLink')}
              </Button>
            </div>
          ) : null;
        })()}

      {/* Hostile door → propose a do-not-knock point (admin approves) */}
      {disposition === 'refused' && hasFix && (
        <label className="flex items-center gap-2 rounded-md bg-destructive/5 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={dnkFlag}
            onChange={(e) => setDnkFlag(e.target.checked)}
          />
          {t('dnkPropose')}
        </label>
      )}

      {/* Conditional fields for engaged dispositions */}
      {isEngaged && (needsAppointment || !linked) && (
        <Card className="space-y-4 p-4">
          {needsAppointment && (
            <div className="space-y-2">
              <Label htmlFor="appt">{t('appointmentDate')}</Label>
              <Input
                id="appt"
                type="datetime-local"
                value={appointmentDate}
                onChange={(e) => setAppointmentDate(e.target.value)}
              />
            </div>
          )}
          {!linked && (
            <div className="space-y-2">
              <Label htmlFor="cname">{t('contactName')}</Label>
              <Input
                id="cname"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="—"
              />
            </div>
          )}
        </Card>
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
              aria-label={t('dictate')}
            >
              {dictation.status === 'recording' ? (
                <>
                  <Square className="h-4 w-4" /> {t('dictateStop')}
                </>
              ) : dictation.status === 'processing' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> …
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" /> {t('dictate')}
                </>
              )}
            </button>
          )}
        </div>
        <textarea
          id="notes"
          ref={notesRef}
          value={withLivePreview(notes, dictation.interim)}
          onChange={(e) => setNotes(e.target.value)}
          // The voice is driving the field; typing into it would fight the tail.
          readOnly={!!dictation.interim}
          placeholder={
            dictation.status === 'recording' ? t('dictateListening') : t('notesPlaceholder')
          }
          rows={2}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-base"
        />
        {dictation.status === 'error' && (
          <p className="text-xs text-destructive">{t('dictateError')}</p>
        )}
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
