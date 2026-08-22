import Link from 'next/link';
import { requireManagerPage, loadFloor } from '@/lib/resto/admin';
import { AdminForm, Text, Choice, Panel } from '@/components/admin-form';
import { addArea, addTable } from '../actions';

export default async function SallePage({ params }: { params: { slug: string } }) {
  const ctx = await requireManagerPage(params.slug);
  const { areas, tables } = await loadFloor(ctx.restaurant.id);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href={`/r/${params.slug}/admin`} className="text-sm text-ink-faint underline underline-offset-4">
        ← Administration
      </Link>
      <h1 className="mt-6 text-2xl font-semibold">La salle</h1>
      <p className="mt-1 text-sm text-ink-faint">
        {tables.length} table{tables.length > 1 ? 's' : ''} ·{' '}
        {tables.reduce((n, t) => n + t.seats, 0)} couverts
      </p>

      <div className="mt-8 flex flex-col gap-4">
        {[...areas, { id: null, name: 'Sans zone' }]
          .map((a) => ({ ...a, tables: tables.filter((t) => t.area_id === a.id) }))
          .filter((a) => a.tables.length > 0)
          .map((a) => (
            <Panel key={a.id ?? 'none'} title={a.name}>
              <ul className="flex flex-wrap gap-2">
                {a.tables.map((t) => (
                  <li key={t.id}
                      className="rounded-md border border-rule px-3 py-2 text-sm">
                    <span className="font-medium">{t.label}</span>
                    <span className="ml-1.5 text-xs text-ink-faint">{t.seats} pl.</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}

        <Panel title="Ajouter une table">
          <AdminForm action={addTable} slug={params.slug} submit="Ajouter la table">
            <Text name="label" label="Numéro ou nom" placeholder="12" />
            <Text name="seats" label="Couverts" type="number" defaultValue="4" />
            <Choice name="area_id" label="Zone" empty="— aucune —"
              options={areas.map((a) => ({ value: a.id, label: a.name }))} />
          </AdminForm>
        </Panel>

        <Panel title="Zones" hint={areas.map((a) => a.name).join(' · ') || 'Aucune pour l’instant.'}>
          <AdminForm action={addArea} slug={params.slug} submit="Ajouter">
            <Text name="name" label="Nom" placeholder="Terrasse" />
          </AdminForm>
        </Panel>
      </div>
    </main>
  );
}
