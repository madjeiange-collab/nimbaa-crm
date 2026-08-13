import type { DispositionType, ContactLifecycle } from '@/types/database';

export type KnockDisposition = Exclude<DispositionType, 'do_not_knock'>;
export type DispositionColor = 'grey' | 'red' | 'yellow' | 'green';

export interface DispositionMeta {
  key: KnockDisposition;
  color: DispositionColor;
  /** Engaged knocks create a contact in the pipeline. */
  createsContact: boolean;
  lifecycle?: ContactLifecycle;
  /** Name of the seeded pipeline stage to place the new contact in. */
  stageName?: string;
  /** Requires an appointment date field. */
  needsAppointment?: boolean;
}

// Order = on-screen button order (the fast "no answer" path is first).
export const DISPOSITIONS: DispositionMeta[] = [
  { key: 'no_answer', color: 'grey', createsContact: false },
  { key: 'not_home', color: 'grey', createsContact: false },
  { key: 'refused', color: 'red', createsContact: false },
  { key: 'interested', color: 'yellow', createsContact: true, lifecycle: 'lead', stageName: 'Intéressé' },
  {
    key: 'appointment_set',
    color: 'yellow',
    createsContact: true,
    lifecycle: 'lead',
    stageName: 'RDV',
    needsAppointment: true,
  },
  { key: 'sold', color: 'green', createsContact: true, lifecycle: 'customer', stageName: 'Gagné (Client)' },
];

export const DISPOSITION_BY_KEY: Record<KnockDisposition, DispositionMeta> =
  Object.fromEntries(DISPOSITIONS.map((d) => [d.key, d])) as Record<
    KnockDisposition,
    DispositionMeta
  >;

/** Tailwind classes for each disposition button / pin colour. */
export const DISPOSITION_BTN_CLASSES: Record<DispositionColor, string> = {
  grey: 'bg-knock-grey text-white',
  red: 'bg-knock-red text-white',
  yellow: 'bg-knock-yellow text-black',
  green: 'bg-knock-green text-white',
};

/** Hex-ish CSS colour (from the shared HSL vars) for Leaflet pins. */
export function dispositionCssColor(color: DispositionColor): string {
  return `hsl(var(--knock-${color}))`;
}

/** Map a disposition to its pin colour (do_not_knock renders red). */
export function colorForDisposition(d: DispositionType | null): DispositionColor {
  if (!d) return 'grey';
  if (d === 'do_not_knock') return 'red';
  return DISPOSITION_BY_KEY[d as KnockDisposition]?.color ?? 'grey';
}
