'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/session';

export interface ImportRow {
  name: string | null;
  phone: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** Territory (secteur) name — resolved server-side, case-insensitive. */
  territory: string | null;
  /** Rep username — resolved server-side, case-insensitive. */
  rep: string | null;
  tags: string[];
}

export interface ImportSummary {
  inserted: number;
  duplicates: number;
  invalid: number;
  unknownTerritories: string[];
  unknownReps: string[];
}

export type ImportResult = ({ ok: true } & ImportSummary) | { ok: false; error: string };

/** Digits (with optional leading +) only — the dedupe key for phones. */
function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const p = raw.trim().replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return p.length >= 6 ? p : null;
}

/**
 * Bulk-insert contacts from the admin CSV import. New rows arrive as leads
 * (source 'import'); duplicates are skipped by normalized phone — against the
 * database AND within the batch itself.
 */
export async function importContacts(rows: ImportRow[]): Promise<ImportResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: 'unauthenticated' };
  if (me.role !== 'admin') return { ok: false, error: 'forbidden' };
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: 'empty' };
  if (rows.length > 2000) return { ok: false, error: 'tooMany' };

  const supabase = await createClient();

  // Lookup maps for secteur names and rep usernames (case-insensitive).
  const [{ data: terrs }, { data: reps }] = await Promise.all([
    supabase.from('territories').select('id, name').eq('is_active', true),
    supabase.from('users').select('id, username, role, is_active'),
  ]);
  const terrByName = new Map(
    ((terrs ?? []) as { id: string; name: string }[]).map((t) => [t.name.trim().toLowerCase(), t.id]),
  );
  const repByUsername = new Map(
    ((reps ?? []) as { id: string; username: string | null; role: string; is_active: boolean }[])
      .filter((u) => u.username && (u.role === 'rep' || u.role === 'manager'))
      .map((u) => [u.username!.trim().toLowerCase(), u.id]),
  );

  const unknownTerritories = new Set<string>();
  const unknownReps = new Set<string>();
  let invalid = 0;
  let duplicates = 0;

  // Validate + normalize, deduplicating by phone within the file.
  const seenPhones = new Set<string>();
  const prepared: {
    name: string | null;
    phone: string | null;
    address: string | null;
    lat: number | null;
    lng: number | null;
    territory_id: string | null;
    assigned_rep_id: string | null;
    tags: string[];
  }[] = [];

  for (const r of rows) {
    const name = r.name?.trim() || null;
    const phone = normalizePhone(r.phone);
    if (!name && !phone) {
      invalid++;
      continue;
    }
    if (phone) {
      if (seenPhones.has(phone)) {
        duplicates++;
        continue;
      }
      seenPhones.add(phone);
    }

    let territoryId: string | null = null;
    const terrName = r.territory?.trim();
    if (terrName) {
      territoryId = terrByName.get(terrName.toLowerCase()) ?? null;
      if (!territoryId) unknownTerritories.add(terrName);
    }
    let repId: string | null = null;
    const repName = r.rep?.trim();
    if (repName) {
      repId = repByUsername.get(repName.toLowerCase()) ?? null;
      if (!repId) unknownReps.add(repName);
    }

    const lat = typeof r.lat === 'number' && Number.isFinite(r.lat) && Math.abs(r.lat) <= 90 ? r.lat : null;
    const lng = typeof r.lng === 'number' && Number.isFinite(r.lng) && Math.abs(r.lng) <= 180 ? r.lng : null;

    prepared.push({
      name,
      phone,
      address: r.address?.trim() || null,
      lat,
      lng: lat != null ? lng : null,
      territory_id: territoryId,
      assigned_rep_id: repId,
      tags: (r.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 10),
    });
  }

  // Skip phones that already exist in the database (chunked .in()).
  const phones = [...seenPhones];
  const existing = new Set<string>();
  for (let i = 0; i < phones.length; i += 200) {
    const { data } = await supabase
      .from('contacts')
      .select('phone')
      .in('phone', phones.slice(i, i + 200));
    ((data ?? []) as { phone: string | null }[]).forEach((c) => {
      if (c.phone) existing.add(c.phone);
    });
  }
  const toInsert = prepared.filter((p) => {
    if (p.phone && existing.has(p.phone)) {
      duplicates++;
      return false;
    }
    return true;
  });

  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += 500) {
    const chunk = toInsert.slice(i, i + 500).map((p) => ({
      ...p,
      lifecycle: 'lead',
      source: 'import',
      created_by: me.id,
    }));
    const { error } = await supabase.from('contacts').insert(chunk);
    if (error) return { ok: false, error: 'insertFailed' };
    inserted += chunk.length;
  }

  revalidatePath('/[locale]/contacts', 'page');
  return {
    ok: true,
    inserted,
    duplicates,
    invalid,
    unknownTerritories: [...unknownTerritories].slice(0, 10),
    unknownReps: [...unknownReps].slice(0, 10),
  };
}
