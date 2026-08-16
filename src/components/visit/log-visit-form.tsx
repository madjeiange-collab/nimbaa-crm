'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Ban, CheckCircle2, Camera, X, MapPin } from 'lucide-react';
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
import { processCheckInPhoto } from '@/lib/image/capture';
import { uploadVisitPhoto } from '@/lib/visits/upload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

const DNK_RADIUS_M = 20;
const MAX_PHOTOS = 5;

interface Photo {
  blob: Blob;
  url: string;
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
}: {
  repId: string;
  repName?: string | null;
  turfPolygons: number[][][][];
  dnkPoints: { lat: number; lng: number }[];
  canDoB2b: boolean;
  attachedContact?: { id: string; name: string | null } | null;
  contacts?: PickContact[];
}) {
  const t = useTranslations('visit');
  const tDisp = useTranslations('dispositions');
  const tLife = useTranslations('lifecycle');
  const geo = useGeolocation(true);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [disposition, setDisposition] = useState<KnockDisposition | null>(null);
  const [notes, setNotes] = useState('');
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
  const [dealId, setDealId] = useState<string | null>(null);
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

  const canSave =
    gpsResolved &&
    !dnkBlocked &&
    disposition != null &&
    photos.length >= 1 &&
    !processing &&
    (!needsAppointment || !!appointmentDate);

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

  /** One action: refresh GPS *and* open the camera. */
  function startCheckIn() {
    if (dnkBlocked) return;
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
      const blob = await processCheckInPhoto(file, {
        lat: hasFix ? geo.lat : null,
        lng: hasFix ? geo.lng : null,
        accuracy: geo.accuracy,
        at: new Date(),
        address,
        by: repName,
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
    if (!canSave || !disposition) return;
    setResult(null);
    startTransition(async () => {
      const clientUuid = genUuid();
      let photoPaths: string[] = [];
      try {
        setUploading(true);
        photoPaths = await Promise.all(
          photos.map((p, i) => uploadVisitPhoto(repId, clientUuid, i, p.blob)),
        );
      } catch {
        setUploading(false);
        setResult({ kind: 'error', text: t('saveError') });
        return;
      }
      setUploading(false);

      const res = await saveVisit({
        clientUuid,
        visitType: linked ? 'b2b_visit' : 'd2d_knock',
        lat: hasFix ? geo.lat : null,
        lng: hasFix ? geo.lng : null,
        disposition,
        notes: notes.trim() || null,
        appointmentDate: needsAppointment && appointmentDate ? appointmentDate : null,
        contactName: isEngaged && !linked && contactName.trim() ? contactName.trim() : null,
        address: hasFix ? address : null,
        contactId: linked?.id ?? null,
        dealId: linked ? dealId : null,
        photoPaths,
      });

      if (res.ok) {
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
              photos.length > 0
                ? 'bg-knock-green/15 text-knock-green'
                : 'bg-destructive/10 text-destructive'
            }`}
          >
            {photos.length > 0 ? t('photoCount', { n: photos.length }) : t('photoRequired')}
          </span>
        </div>

        {photos.length === 0 ? (
          // Primary one-tap action: camera + GPS together
          <button
            type="button"
            onClick={startCheckIn}
            disabled={processing || dnkBlocked}
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
          {DISPOSITIONS.map((d) => {
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
                {tDisp(d.key)}
              </button>
            );
          })}
        </div>
      </div>

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

      {/* Notes — optional */}
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
        <div className="mx-auto flex max-w-lg gap-2">
          <Button
            variant="outline"
            size="xl"
            className="flex-1"
            onClick={() => {
              reset();
              setResult(null);
            }}
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
