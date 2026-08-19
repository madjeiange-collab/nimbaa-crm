import 'server-only';

import type { createClient } from '@/lib/supabase/server';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export type ContactEventKind =
  | 'created'
  | 'imported'
  | 'name'
  | 'phone'
  | 'address'
  | 'geo'
  | 'business_type'
  | 'tags'
  | 'priority'
  | 'assigned';

export interface ContactEvent {
  id: string;
  contact_id: string | null;
  contact_name: string | null;
  kind: ContactEventKind;
  from_label: string | null;
  to_label: string | null;
  actor_id: string | null;
  at: string;
}

/** Never throws: the edit it describes has already happened. */
export async function logContactEvent(
  db: ServerClient,
  e: {
    contactId: string;
    contactName: string | null;
    kind: ContactEventKind;
    from?: string | null;
    to?: string | null;
    actorId: string | null;
  },
): Promise<void> {
  try {
    await db.from('contact_events').insert({
      contact_id: e.contactId,
      contact_name: e.contactName,
      kind: e.kind,
      from_label: e.from ?? null,
      to_label: e.to ?? null,
      actor_id: e.actorId,
    });
  } catch {
    // Table missing (pre-0035) or RLS refused.
  }
}

export async function logContactDiff(
  db: ServerClient,
  base: { contactId: string; contactName: string | null; actorId: string | null },
  changes: { kind: ContactEventKind; from?: string | null; to?: string | null }[],
): Promise<void> {
  for (const c of changes) {
    await logContactEvent(db, { ...base, kind: c.kind, from: c.from, to: c.to });
  }
}

/** A pin, written the way the fiche writes it. */
export const pin = (lat: number | null | undefined, lng: number | null | undefined): string | null =>
  lat == null || lng == null ? null : `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

const same = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/**
 * What actually changed on a fiche.
 *
 * Only fields that were sent are compared — an undefined field means the form
 * did not carry it, which is different from clearing it. Tags are compared as
 * sets: reordering them is not an edit worth a line.
 */
export function contactDiff(
  before: {
    name: string | null;
    phone: string | null;
    address: string | null;
    lat: number | null;
    lng: number | null;
    business_type: string | null;
    tags: string[] | null;
    priority: string | null;
  },
  fields: {
    name?: string | null;
    phone?: string | null;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
    businessType?: string | null;
    tags?: string[];
    priority?: string;
  },
): { kind: ContactEventKind; from?: string | null; to?: string | null }[] {
  const out: { kind: ContactEventKind; from?: string | null; to?: string | null }[] = [];
  const t = (v: string | null | undefined) => (v?.trim() || null);

  if (fields.name !== undefined && t(fields.name) !== t(before.name)) {
    out.push({ kind: 'name', from: before.name, to: t(fields.name) });
  }
  // Compared without spaces on purpose. The phone field recomposes what it
  // was given — "+2250700111222" comes back as "+225 0700111222" — so a
  // literal comparison logged a change on every fiche whose number happened to
  // be stored unspaced, the first time anyone opened the form. A journal that
  // records edits nobody made stops being worth reading.
  const digits = (v: string | null | undefined) => v?.replace(/[\s.\-()]/g, '') || null;
  if (fields.phone !== undefined && digits(fields.phone) !== digits(before.phone)) {
    out.push({ kind: 'phone', from: before.phone, to: t(fields.phone) });
  }
  if (fields.address !== undefined && t(fields.address) !== t(before.address)) {
    out.push({ kind: 'address', from: before.address, to: t(fields.address) });
  }
  // The pin moves on its own: someone can correct the written address without
  // touching the map, and the reverse. The check that flags a photo far from
  // the customer reads the pin, so it earns its own line.
  if (fields.lat !== undefined || fields.lng !== undefined) {
    const to = pin(fields.lat ?? before.lat, fields.lng ?? before.lng);
    const from = pin(before.lat, before.lng);
    if (to !== from) out.push({ kind: 'geo', from, to });
  }
  if (fields.businessType !== undefined && t(fields.businessType) !== t(before.business_type)) {
    out.push({ kind: 'business_type', from: before.business_type, to: t(fields.businessType) });
  }
  if (fields.tags !== undefined && !same(fields.tags, before.tags ?? [])) {
    out.push({
      kind: 'tags',
      from: (before.tags ?? []).join(', ') || null,
      to: fields.tags.join(', ') || null,
    });
  }
  if (fields.priority !== undefined && fields.priority !== before.priority) {
    out.push({ kind: 'priority', from: before.priority, to: fields.priority });
  }
  return out;
}
