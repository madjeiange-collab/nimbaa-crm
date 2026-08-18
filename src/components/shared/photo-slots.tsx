'use client';

import { Camera, Lock, Plus, X } from 'lucide-react';

export interface SlotPhoto {
  url: string;
  kind: 'arrival' | 'completion' | 'extra';
}

export interface PhotoSlotLabels {
  arrival: string;
  completion: string;
  arrivalEmpty: string;
  completionEmpty: string;
  completionLocked: string;
  extraTitle: string;
  extraHint: string;
  add: string;
  remove: string;
  processing: string;
}

/**
 * Three explicit photo zones — arrival, end, and free documentation shots —
 * so the rep sees at a glance what the visit still needs. The end slot stays
 * locked until the arrival photo exists (you can't leave before you arrive),
 * which is also what makes the on-site duration meaningful.
 */
export function PhotoSlots({
  photos,
  onCapture,
  onRemove,
  processing = false,
  disabled = false,
  maxExtra = 3,
  labels,
}: {
  photos: SlotPhoto[];
  onCapture: (kind: SlotPhoto['kind']) => void;
  onRemove: (index: number) => void;
  processing?: boolean;
  disabled?: boolean;
  maxExtra?: number;
  labels: PhotoSlotLabels;
}) {
  const arrivalIdx = photos.findIndex((p) => p.kind === 'arrival');
  const completionIdx = photos.findIndex((p) => p.kind === 'completion');
  const extras = photos
    .map((p, i) => ({ photo: p, index: i }))
    .filter(({ photo }) => photo.kind === 'extra');

  const hasArrival = arrivalIdx >= 0;
  const completionLocked = !hasArrival;

  function Slot({
    index,
    filled,
    title,
    emptyLabel,
    locked,
    tone,
  }: {
    index: number;
    filled: boolean;
    title: string;
    emptyLabel: string;
    locked?: boolean;
    tone: 'arrival' | 'completion';
  }) {
    const kind: SlotPhoto['kind'] = tone === 'arrival' ? 'arrival' : 'completion';
    return (
      <div className="space-y-1">
        <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
          {filled && <span className="text-knock-green">✓</span>}
        </p>
        {filled ? (
          <div className="relative aspect-square overflow-hidden rounded-lg border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photos[index].url} alt={title} className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onRemove(index)}
              aria-label={labels.remove}
              className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onCapture(kind)}
            disabled={disabled || processing || locked}
            className={`flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-lg px-2 text-center shadow-sm transition disabled:opacity-50 ${
              locked
                ? 'border-2 border-dashed border-input bg-muted/40 text-muted-foreground shadow-none'
                : tone === 'arrival'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-brand-amber text-black'
            }`}
          >
            {locked ? <Lock className="h-6 w-6" /> : <Camera className="h-7 w-7" />}
            <span className="text-sm font-semibold leading-tight">
              {processing ? labels.processing : locked ? labels.completionLocked : emptyLabel}
            </span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Slot
          index={arrivalIdx}
          filled={hasArrival}
          title={labels.arrival}
          emptyLabel={labels.arrivalEmpty}
          tone="arrival"
        />
        <Slot
          index={completionIdx}
          filled={completionIdx >= 0}
          title={labels.completion}
          emptyLabel={labels.completionEmpty}
          locked={completionLocked}
          tone="completion"
        />
      </div>

      <div className="space-y-1.5 border-t pt-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {labels.extraTitle}
          </p>
          <p className="text-xs text-muted-foreground">{labels.extraHint}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {extras.map(({ photo, index }) => (
            <div key={index} className="relative h-20 w-20 overflow-hidden rounded-lg border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onRemove(index)}
                aria-label={labels.remove}
                className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {extras.length < maxExtra && (
            <button
              type="button"
              onClick={() => onCapture('extra')}
              disabled={disabled || processing}
              className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-input text-muted-foreground disabled:opacity-50"
            >
              <Plus className="h-5 w-5" />
              <span className="text-[11px] font-medium">{labels.add}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
