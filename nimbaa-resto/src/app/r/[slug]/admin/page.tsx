import Link from 'next/link';
import { requireStaff } from '@/lib/auth/guard';
import { ROLE_LABELS } from '@/lib/tenancy/roles';

const SECTIONS = [
  { segment: 'carte', label: 'La carte', hint: 'Catégories, plats, prix, postes de préparation' },
  { segment: 'salle', label: 'La salle', hint: 'Zones et tables' },
  { segment: 'personnel', label: 'Le personnel', hint: 'Créer les comptes de l’équipe' },
];

export default async function AdminHome({ params }: { params: { slug: string } }) {
  const ctx = await requireStaff(params.slug);

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href={`/r/${params.slug}`} className="text-sm text-ink-faint underline underline-offset-4">
        ← Accueil
      </Link>
      <p className="mt-6 font-mono text-xs uppercase tracking-widest text-service">
        {ctx.restaurant.name} · {ctx.restaurant.currency}
      </p>
      <h1 className="mt-1 text-2xl font-semibold">Administration</h1>
      <p className="mt-1 text-sm text-ink-faint">{ROLE_LABELS[ctx.role]}</p>

      <nav className="mt-8 flex flex-col gap-3">
        {SECTIONS.map((s) => (
          <Link
            key={s.segment}
            href={`/r/${params.slug}/admin/${s.segment}`}
            className="rounded-lg border border-rule bg-white px-5 py-4 transition-colors hover:border-service"
          >
            <span className="block font-medium">{s.label}</span>
            <span className="block text-sm text-ink-faint">{s.hint}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
