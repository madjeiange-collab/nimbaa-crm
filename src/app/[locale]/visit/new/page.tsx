import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { getDispositionConfig } from '@/lib/visits/disposition-config';
import { AppHeader } from '@/components/shared/app-header';
import { LogVisitForm } from '@/components/visit/log-visit-form';

export default async function NewVisitPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ contact?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations('visit');

  const supabase = await createClient();

  // Optional: a visit against an existing contact (from the contact detail page).
  let attachedContact: { id: string; name: string | null } | null = null;
  if (sp.contact) {
    const { data: c } = await supabase
      .from('contacts')
      .select('id, name')
      .eq('id', sp.contact)
      .maybeSingle();
    if (c) attachedContact = { id: c.id, name: c.name };
  }

  // Rep's turf polygons → client-side out-of-turf warning.
  const { data: turfs } = await supabase.rpc('territories_geojson');
  const turfPolygons: number[][][][] = (turfs ?? [])
    .map(
      (t: { geojson: { type?: string; coordinates?: number[][][] } }) =>
        t.geojson?.coordinates,
    )
    .filter(Boolean) as number[][][][];

  // Do-not-knock points → instant client-side proximity check (server re-checks).
  const { data: dnk } = await supabase.from('do_not_knock_list').select('lat, lng');
  const dnkPoints = (dnk ?? []) as { lat: number; lng: number }[];

  // The rep's contacts (+ their affaires) → link a visit to an existing
  // lead/customer and to a specific deal.
  const { data: myContacts } = await supabase
    .from('contacts')
    .select('id, name, lifecycle, lat, lng, deals(id, title, status)')
    .order('updated_at', { ascending: false })
    .limit(500);
  const contacts = (myContacts ?? []) as unknown as {
    id: string;
    name: string | null;
    lifecycle: string;
    lat: number | null;
    lng: number | null;
    deals: { id: string; title: string | null; status: string }[] | null;
  }[];

  // Admin-adjusted outcome labels/visibility (defaults when unset).
  const dispositionSettings = await getDispositionConfig(supabase);

  return (
    <>
      <AppHeader title={t('title')} />
      <LogVisitForm
        repId={user.id}
        repName={user.full_name || user.username}
        dispositionSettings={dispositionSettings}
        turfPolygons={turfPolygons}
        dnkPoints={dnkPoints}
        canDoB2b={user.can_do_b2b}
        attachedContact={attachedContact}
        contacts={contacts}
      />
    </>
  );
}
