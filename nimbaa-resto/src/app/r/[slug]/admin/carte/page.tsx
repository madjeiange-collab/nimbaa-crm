import Link from 'next/link';
import { requireManagerPage, loadMenu } from '@/lib/resto/admin';
import { photoUrl } from '@/lib/ui/photo';
import { DishCard } from '@/components/dish-card';
import { PhotoField } from '@/components/photo-field';
import { AdminForm, Text, Choice, Panel } from '@/components/admin-form';
import { addCategory, addItem, addStation, toggleItemForm } from '../actions';

export default async function CartePage({ params }: { params: { slug: string } }) {
  const ctx = await requireManagerPage(params.slug);
  const { categories, items, stations } = await loadMenu(ctx.restaurant.id);
  const { currency, currencyDecimals } = ctx.restaurant;

  const groups = [
    ...categories.map((c) => ({ id: c.id, name: c.name, items: items.filter((i) => i.category_id === c.id) })),
    { id: 'none', name: 'Sans catégorie', items: items.filter((i) => !i.category_id) },
  ].filter((g) => g.items.length > 0);

  const missingPhotos = items.filter((i) => !i.photo_path).length;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href={`/r/${params.slug}/admin`} className="text-sm text-ink-faint underline underline-offset-4">
        ← Administration
      </Link>
      <h1 className="mt-6 text-2xl font-semibold">La carte</h1>
      <p className="mt-1 text-sm text-ink-faint">
        Prix en {currency}. Un plat sans poste de préparation est servi directement.
      </p>

      {/* A carte without photos is an unreadable carte for half the staff. Say so. */}
      {missingPhotos > 0 && (
        <p data-missing-photos={missingPhotos}
           className="mt-4 rounded-lg border border-rule bg-white px-4 py-3 text-sm">
          <strong>{missingPhotos} plat{missingPhotos > 1 ? 's' : ''}</strong> sans photo.
          En salle et en cuisine, c’est la photo qu’on reconnaît.
        </p>
      )}

      {/* Counted category tabs — the count is a numeral, so it reads. */}
      {groups.length > 0 && (
        <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
          {groups.map((g, n) => (
            <span key={g.id}
              className={`flex flex-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
                n === 0 ? 'border-service bg-service text-white' : 'border-rule bg-white text-ink-soft'}`}>
              {g.name}
              <b className={`rounded-full px-1.5 font-mono text-xs ${
                n === 0 ? 'bg-white/25' : 'bg-black/10'}`}>{g.items.length}</b>
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-6">
        {groups.map((g) => (
          <section key={g.id}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-faint">
              {g.name}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {g.items.map((i) => (
                <div key={i.id} className="flex flex-col gap-1.5">
                  <DishCard
                    name={i.name}
                    price={i.price}
                    currency={currency}
                    decimals={currencyDecimals}
                    photoUrl={photoUrl(i.photo_path)}
                    available={i.available}
                  />
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-xs text-ink-faint">
                      {i.prep_station_id
                        ? stations.find((s) => s.id === i.prep_station_id)?.name ?? 'poste'
                        : 'service direct'}
                    </span>
                    <form action={toggleItemForm}>
                      <input type="hidden" name="slug" value={params.slug} />
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="available" value={String(i.available)} />
                      <button type="submit" className="text-xs text-ink-faint underline underline-offset-2">
                        {i.available ? 'retirer' : 'remettre'}
                      </button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        <Panel title="Ajouter un plat" hint="Le prix s’écrit tel qu’il est affiché au client.">
          <AdminForm action={addItem} slug={params.slug} submit="Ajouter le plat">
            <PhotoField restaurantId={ctx.restaurant.id} name="photo_path" />
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
