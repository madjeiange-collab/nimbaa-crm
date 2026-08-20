import Link from 'next/link';
import { requireStaff } from '@/lib/auth/guard';
import { surfacesFor } from '@/lib/tenancy/roles';
import { signOut } from './login/actions';

export default async function RestaurantHome({ params }: { params: { slug: string } }) {
  const ctx = await requireStaff(params.slug);
  const surfaces = surfacesFor(ctx.roles);

  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <p className="font-mono text-xs uppercase tracking-widest text-service">
        {ctx.restaurant.name}
      </p>
      <h1 className="mt-1 text-2xl font-semibold">
        Bonjour {ctx.displayName ?? ctx.username}
      </h1>
      <p className="mt-1 text-sm text-ink-faint">
        {ctx.roles.join(' · ')}
      </p>

      <nav className="mt-8 flex flex-col gap-3">
        {surfaces.map((s) => (
          <Link
            key={s.segment}
            href={`/r/${params.slug}/${s.segment}`}
            className="rounded-lg border border-rule bg-white px-5 py-4 transition-colors hover:border-service"
          >
            <span className="block font-medium">{s.label}</span>
            <span className="block text-sm text-ink-faint">{s.hint}</span>
          </Link>
        ))}
      </nav>

      <form
        action={async () => {
          'use server';
          await signOut(params.slug);
        }}
        className="mt-10"
      >
        <button type="submit" className="text-sm text-ink-faint underline underline-offset-4">
          Se déconnecter
        </button>
      </form>
    </main>
  );
}
