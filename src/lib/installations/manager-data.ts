import 'server-only';

import type { createClient } from '@/lib/supabase/server';
import type { InstallStatus } from '@/types/database';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

export interface ManagerInstallRow {
  id: string;
  status: InstallStatus;
  installerId: string | null;
  completedAt: string | null;
  scheduledDate: string | null;
  nextVisitDate: string | null;
  title: string | null;
  contactId: string | null;
  contactName: string | null;
  lat: number | null;
  lng: number | null;
  /** Business type + tags of the linked deal (branch filters). */
  businessType: string | null;
  tags: string[];
}

export interface ManagerTerritory {
  id: string;
  name: string;
  coordinates: number[][][];
}

export interface InstallManagerData {
  installations: ManagerInstallRow[];
  technicians: { id: string; name: string }[];
  territories: ManagerTerritory[];
}

/**
 * Team-wide installation data for the manager views (technician dashboard tab,
 * standalone technician stats). Installations carry their customer's location
 * so the views can filter by secteur (point-in-polygon) and plot the map.
 */
export async function loadInstallManagerData(supabase: ServerClient): Promise<InstallManagerData> {
  const [{ data: rawInstalls }, { data: users }, { data: turfs }] = await Promise.all([
    supabase
      .from('installations')
      .select('id, status, installer_id, completed_at, scheduled_date, next_visit_date, title, contact_id, contacts(name, lat, lng), deals(business_type, tags)')
      .limit(5000),
    supabase.from('users').select('id, full_name, username, role'),
    supabase.rpc('territories_geojson'),
  ]);

  type Raw = {
    id: string;
    status: InstallStatus;
    installer_id: string | null;
    completed_at: string | null;
    scheduled_date: string | null;
    next_visit_date: string | null;
    title: string | null;
    contact_id: string | null;
    contacts: { name: string | null; lat: number | null; lng: number | null } | null;
    deals: { business_type: string | null; tags: string[] | null } | null;
  };
  const installations: ManagerInstallRow[] = ((rawInstalls ?? []) as unknown as Raw[]).map((r) => ({
    id: r.id,
    status: r.status,
    installerId: r.installer_id,
    completedAt: r.completed_at,
    scheduledDate: r.scheduled_date,
    nextVisitDate: r.next_visit_date,
    title: r.title,
    contactId: r.contact_id,
    contactName: r.contacts?.name ?? null,
    lat: r.contacts?.lat ?? null,
    lng: r.contacts?.lng ?? null,
    businessType: r.deals?.business_type ?? null,
    tags: r.deals?.tags ?? [],
  }));

  const technicians = ((users ?? []) as { id: string; full_name: string | null; username: string | null; role?: string }[])
    .filter((u) => u.role === 'technician')
    .map((u) => ({ id: u.id, name: u.full_name ?? u.username ?? '—' }));

  const territories: ManagerTerritory[] = (
    (turfs ?? []) as { id: string; name: string; geojson?: { coordinates?: number[][][] } }[]
  )
    .filter((r) => r.geojson?.coordinates)
    .map((r) => ({ id: r.id, name: r.name, coordinates: r.geojson!.coordinates as number[][][] }));

  return { installations, technicians, territories };
}
