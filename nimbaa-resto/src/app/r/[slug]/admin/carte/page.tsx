import Link from 'next/link';
import { requireManagerPage, loadMenu } from '@/lib/resto/admin';
import { photoUrl } from '@/lib/ui/photo';
import { DishCard } from '@/components/dish-card';
import { PhotoField } from '@/components/photo-field';
import { PhotoButton } from '@/components/photo-button';
import { RowForm, RowSubmit } from '@/components/row-form';
import { Confirm } from '@/components/confirm';
import { AdminForm, Text, Choice, Panel } from '@/components/admin-form';
import {
  addCategory, addItem, addStation,
  renameCategory, deleteCategory, moveCategory, moveItem, toggleCategory, toggleItem,
} from '../actions';

export default async function CartePage({ params }: { params: { slug: string } }) {
  const ctx = await requireManagerPage(params.slug);
  const { categories, items, stations } = await loadMenu(ctx.restaurant.id);
  const { currency, currencyDecimals } = ctx.restaurant;
  const slug = params.slug;

  // Every category, including the empty ones and the hidden ones. This is the
  // page where they are managed, so a category the patron cannot see here is a
  // category he cannot fix.
  const groups = categories.map((c, n) => ({
    ...c,
    items: items.filter((i) => i.category_id === c.id),
    first: n === 0,
    last: n === categories.length - 1,
  }));
  const loose = items.filter((i) => !i.category_id);
  const missingPhotos = items.filter((i) => !i.photo_path).length;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href={`/r/${slug}/admin`} className="text-sm text-ink-faint underline underline-offset-4">
        ← Administration
      </Link>
      <h1 className="mt-6 text-2xl font-semibold">La carte</h1>
      <p className="mt-1 text-sm text-ink-faint">
        Prix en {currency}. Un plat sans poste de préparation est servi directement.
        L’ordre ci-dessous est celui de la salle.
      </p>

      {/* A carte without photos is an unreadable carte for half the staff. Say
          so — and put the camera on the tile itself, so saying so leads
          somewhere. */}
      {missingPhotos > 0 && (
        <p data-missing-photos={missingPhotos}
           className="mt-4 rounded-lg border border-rule bg-white px-4 py-3 text-sm">
          <strong>{missingPhotos} plat{missingPhotos > 1 ? 's' : ''}</strong> sans photo.
          En salle et en cuisine, c’est la photo qu’on reconnaît.
          Touchez le <span aria-hidden>📷</span> sur la vignette pour la prendre.
        </p>
      )}

      {/* Photographic tabs, in the order of the carte, counted. The picture
          places the category before the word does. */}
      {groups.length > 0 && (
        <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
          {groups.map((g) => (
            <a key={g.id} href={`#cat-${g.id}`} data-tab={g.name}
              className={`flex flex-none items-center gap-1.5 rounded-full border border-rule
                          bg-white py-1 pl-1 pr-3 text-sm ${g.active ? '' : 'opacity-50'}`}>
              {photoUrl(g.photo_path) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrl(g.photo_path)!} alt="" className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <span className="h-7 w-7 rounded-full bg-surface-2" aria-hidden />
              )}
              {g.name}
              <b className="rounded-full bg-black/10 px-1.5 font-mono text-xs">{g.items.length}</b>
            </a>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-6">
        {groups.map((g) => (
          <section key={g.id} id={`cat-${g.id}`} data-category={g.name} data-hidden={!g.active}>
            {/* The category's own row: its picture, its name, its place in the
                order, and whether the room sees it at all. */}
            <div className="rounded-lg border border-rule bg-white p-2">
              <div className="flex items-center gap-2">
                <PhotoButton slug={slug} restaurantId={ctx.restaurant.id}
                  target="category" id={g.id} name={g.name} url={photoUrl(g.photo_path)} />
                <RowForm action={renameCategory}
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="id" value={g.id} />
                  <input name="name" defaultValue={g.name} required maxLength={60}
                    aria-label={`Nom de la catégorie ${g.name}`}
                    className="min-w-0 flex-1 rounded-md border border-transparent bg-surface-2
                               px-2 py-1.5 text-base font-semibold outline-none
                               focus:border-service focus:bg-white" />
                  <RowSubmit label="✓" title={`Renommer ${g.name}`} />
                </RowForm>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <RowForm action={moveCategory} className="flex flex-wrap items-center gap-1.5">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="id" value={g.id} />
                  <RowSubmit name="dir" value="-1" label="↑"
                    title={`Monter ${g.name}`} disabled={g.first} />
                  <RowSubmit name="dir" value="1" label="↓"
                    title={`Descendre ${g.name}`} disabled={g.last} />
                </RowForm>

                {/* Hiding is the seasonal case: the category comes back next
                    year in the place the team already knows. Deleting it and
                    retyping it loses that place. */}
                <RowForm action={toggleCategory} className="flex flex-wrap items-center gap-1.5">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="id" value={g.id} />
                  <input type="hidden" name="active" value={String(g.active)} />
                  <RowSubmit
                    title={`${g.active ? 'Masquer' : 'Afficher'} ${g.name}`}
                    label={g.active
                      ? <><span aria-hidden>🚫</span> masquer</>
                      : <><span aria-hidden>👁</span> afficher</>} />
                </RowForm>

                <RowForm action={deleteCategory} className="flex flex-wrap items-center gap-1.5">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="id" value={g.id} />
                  <Confirm
                    label={<><span aria-hidden>🗑</span> supprimer</>}
                    confirm={`Supprimer ${g.name} ?`}
                    title={`Supprimer ${g.name}`} />
                </RowForm>

                {!g.active && (
                  <span className="ml-auto rounded-md bg-black/10 px-2 py-1 text-xs font-semibold">
                    <span aria-hidden>🚫</span> masquée en salle
                  </span>
                )}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              {g.items.map((i, n) => (
                <Dish key={i.id} item={i} slug={slug} restaurantId={ctx.restaurant.id}
                  currency={currency} decimals={currencyDecimals} stations={stations}
                  first={n === 0} last={n === g.items.length - 1} />
              ))}
            </div>
            {g.items.length === 0 && (
              <p className="mt-2 px-0.5 text-sm text-ink-faint">Aucun plat dans cette catégorie.</p>
            )}
          </section>
        ))}

        {loose.length > 0 && (
          <section data-category="Sans catégorie">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-faint">
              Sans catégorie
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {loose.map((i, n) => (
                <Dish key={i.id} item={i} slug={slug} restaurantId={ctx.restaurant.id}
                  currency={currency} decimals={currencyDecimals} stations={stations}
                  first={n === 0} last={n === loose.length - 1} />
              ))}
            </div>
          </section>
        )}

        <Panel title="Ajouter un plat" hint="Le prix s’écrit tel qu’il est affiché au client.">
          <AdminForm action={addItem} slug={slug} submit="Ajouter le plat" name="item">
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
          <Panel title="Nouvelle catégorie" hint="Elle se range à la fin ; les flèches la déplacent.">
            <AdminForm action={addCategory} slug={slug} submit="Ajouter" name="category">
              <Text name="name" label="Nom" placeholder="Plats" />
            </AdminForm>
          </Panel>
          <Panel title="Postes" hint={stations.map((s) => s.name).join(' · ') || 'Aucun pour l’instant.'}>
            <AdminForm action={addStation} slug={slug} submit="Ajouter" name="station">
              <Text name="name" label="Nom" placeholder="Cuisine" />
            </AdminForm>
          </Panel>
        </div>
      </div>
    </main>
  );
}

/** One dish: the tile, its camera, its place in the category, its 86 switch. */
function Dish({
  item, slug, restaurantId, currency, decimals, stations, first, last,
}: {
  item: Awaited<ReturnType<typeof loadMenu>>['items'][number];
  slug: string;
  restaurantId: string;
  currency: string;
  decimals: number;
  stations: { id: string; name: string }[];
  first: boolean;
  last: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <DishCard
        name={item.name}
        price={item.price}
        currency={currency}
        decimals={decimals}
        photoUrl={photoUrl(item.photo_path)}
        available={item.available}
        corner={
          <PhotoButton slug={slug} restaurantId={restaurantId} variant="corner"
            target="item" id={item.id} name={item.name} url={photoUrl(item.photo_path)} />
        }
      />
      <div className="flex items-center justify-between gap-1">
        <RowForm action={moveItem} className="flex flex-wrap items-center gap-1">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="id" value={item.id} />
          <RowSubmit name="dir" value="-1" label="↑"
            title={`Monter ${item.name}`} disabled={first} />
          <RowSubmit name="dir" value="1" label="↓"
            title={`Descendre ${item.name}`} disabled={last} />
        </RowForm>
        <RowForm action={toggleItem} className="flex flex-wrap items-center justify-end gap-1">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="available" value={String(item.available)} />
          <button type="submit" title={`${item.available ? 'Retirer' : 'Remettre'} ${item.name}`}
            className="text-xs text-ink-faint underline underline-offset-2">
            {item.available ? 'retirer' : 'remettre'}
          </button>
        </RowForm>
      </div>
      <span className="px-0.5 text-[11px] text-ink-faint">
        {item.prep_station_id
          ? stations.find((s) => s.id === item.prep_station_id)?.name ?? 'poste'
          : 'service direct'}
      </span>
    </div>
  );
}
