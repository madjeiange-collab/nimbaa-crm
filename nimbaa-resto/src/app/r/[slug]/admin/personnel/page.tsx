import Link from 'next/link';
import { requireManagerPage } from '@/lib/resto/admin';
import { createClient } from '@/lib/supabase/server';
import { ROLE_LABELS, grantableRoles, type Role } from '@/lib/tenancy/roles';
import { AdminForm, Text, Choice, Panel } from '@/components/admin-form';
import { addStaff } from '../actions';

export default async function PersonnelPage({ params }: { params: { slug: string } }) {
  const ctx = await requireManagerPage(params.slug);
  const supabase = createClient();

  const [{ data: staff }, { data: access }] = await Promise.all([
    supabase.schema('resto').from('staff_accounts')
      .select('user_id, username, display_name, must_change_password, disabled_at')
      .eq('restaurant_id', ctx.restaurant.id).order('username'),
    supabase.schema('core').from('product_access')
      .select('user_id, role').eq('org_id', ctx.restaurant.orgId).eq('product', 'resto'),
  ]);

  const roleOf = new Map((access ?? []).map((a) => [a.user_id, a.role as Role]));
  const grantable = grantableRoles(ctx.role);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href={`/r/${params.slug}/admin`} className="text-sm text-ink-faint underline underline-offset-4">
        ← Administration
      </Link>
      <h1 className="mt-6 text-2xl font-semibold">Le personnel</h1>
      <p className="mt-1 text-sm text-ink-faint">
        {staff?.length ?? 0} compte{(staff?.length ?? 0) > 1 ? 's' : ''} sur ce restaurant.
      </p>

      <div className="mt-8 flex flex-col gap-4">
        <Panel title="L’équipe">
          <ul className="flex flex-col divide-y divide-rule">
            {(staff ?? []).map((p) => {
              const role = roleOf.get(p.user_id);
              return (
                <li key={p.user_id} className="flex items-center justify-between gap-3 py-2.5">
                  <span>
                    <span className="font-medium">{p.display_name ?? p.username}</span>
                    <span className="ml-2 text-xs text-ink-faint">{p.username}</span>
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    {p.must_change_password && (
                      <span className="rounded-full border border-rule px-2 py-0.5 text-ink-faint">
                        mot de passe à choisir
                      </span>
                    )}
                    <span className="rounded-full bg-service-soft px-2 py-0.5 text-service">
                      {role ? ROLE_LABELS[role] : '—'}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel
          title="Créer un compte"
          hint="Donnez-lui le mot de passe de vive voix : il devra en choisir un autre à sa première connexion."
        >
          <AdminForm action={addStaff} slug={params.slug} submit="Créer le compte">
            <Text name="username" label="Identifiant" placeholder="ibrahim" />
            <Text name="display_name" label="Nom affiché" required={false} placeholder="Ibrahim Traoré" />
            <Text name="password" label="Mot de passe provisoire" type="password" />
            <Choice name="role" label="Rôle"
              options={grantable.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
          </AdminForm>
        </Panel>
      </div>
    </main>
  );
}
