import Link from 'next/link';
import { requireManagerPage, loadMenu } from '@/lib/resto/admin';
import { formatMoney } from '@/lib/ui/money';
import { AdminForm, Text, Choice, Panel } from '@/components/admin-form';
import { addCategory, addItem, addStation, toggleItemForm } from '../actions';

export default async function CartePage({ params }: { params: { slug: string } }) {
  const ctx = await requireManagerPage(params.slug);
  const { categories, items, stations } = await loadMenu(ctx.restaurant.id);
  const { currency, currencyDecimals } = ctx.restaurant;

  const byCategory = categories.map((c) => ({
    ...c, items: items.filter((i) => i.category_id === c.id),
  }));
  const orphans = items.filter((i) => !i.category_id);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href={`/r/${params.slug}/admin`} className="text-sm text-ink-faint underline underline-offset-4">
        ← Administration
      </Link>
      <h1 className="mt-6 text-2xl font-semibold">La carte</h1>
      <p className="mt-1 text-sm text-ink-faint">
        Prix en {currency}. Un plat sans poste de préparation est servi directement.
      </p>

      <div className="mt-8 flex flex-col gap-4">
        {[...byCategory, { id: 'orphans', name: 'Sans catégorie', items: orphans }]
          .filter((c) => c.items.length > 0)
          .map((c) => (
            <Panel key={c.id} title={c.name}>
              <ul className="flex flex-col divide-y divide-rule">
                {c.items.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 py-2.5">
                    {/* Name and station stack: inline, they wrap into each other
                        on a phone and the station reads as part of the dish. */}
                    <span className="min-w-0">
                      <span className={`block ${i.available ? 'font-medium' : 'font-medium line-through text-ink-faint'}`}>
                        {i.name}
                      </span>
                      <span className="block text-xs text-ink-faint">
                        {i.prep_station_id
                          ? stations.find((s) => s.id === i.prep_station_id)?.name ?? 'poste'
                          : 'service direct'}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="whitespace-nowrap font-mono text-sm tabular-nums">
                        {formatMoney(i.price, currency, currencyDecimals)}
                      </span>
                      <form action={toggleItemForm}>
                        <input type="hidden" name="slug" value={params.slug} />
                        <input type="hidden" name="id" value={i.id} />
                        <input type="hidden" name="available" value={String(i.available)} />
                        <button type="submit" className="text-xs text-ink-faint underline underline-offset-2">
                          {i.available ? 'retirer' : 'remettre'}
                        </button>
                      </form>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ))}

        <Panel title="Ajouter un plat" hint="Le prix s’écrit tel qu’il est affiché au client.">
          <AdminForm action={addItem} slug={params.slug} submit="Ajouter le plat">
            <Text name="name" label="Nom" placeholder="Poisson braisé" />
            <Text name="price" label={`Prix (${currency})`} placeholder={currencyDecimals ? '12,50' : '3500'} />
            <Text name="description" label="Description" required={false} placeholder="attiéké, piment" />
            <Choice name="category_id" label="Catégorie" empty="— aucune —"
              options={categories.map((c) => ({ value: c.id, label: c.name }))} />
            <Choice name="prep_station_id" label="Poste de préparation"
              empty="— service direct —"
              options={stations.map((s) => ({ value: s.id, label: s.name }))} />
          </AdminForm>
        </Panel>

        <div className="grid gap-4 sm:grid-cols-2">
          <Panel title="Catégories" hint={categories.map((c) => c.name).join(' · ') || 'Aucune pour l’instant.'}>
            <AdminForm action={addCategory} slug={params.slug} submit="Ajouter">
              <Text name="name" label="Nom" placeholder="Plats" />
            </AdminForm>
          </Panel>
          <Panel title="Postes" hint={stations.map((s) => s.name).join(' · ') || 'Aucun pour l’instant.'}>
            <AdminForm action={addStation} slug={params.slug} submit="Ajouter">
              <Text name="name" label="Nom" placeholder="Cuisine" />
            </AdminForm>
          </Panel>
        </div>
      </div>
    </main>
  );
}
