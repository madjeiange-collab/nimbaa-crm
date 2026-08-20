import { redirect } from 'next/navigation';
import { getStaffContext } from '@/lib/auth/staff';
import { LoginForm } from './login-form';

export default async function LoginPage({ params }: { params: { slug: string } }) {
  // Already signed in here? Skip the form.
  if (await getStaffContext(params.slug)) redirect(`/r/${params.slug}`);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <p className="mb-1 font-mono text-xs uppercase tracking-widest text-service">
        {params.slug}
      </p>
      <h1 className="mb-8 text-2xl font-semibold">Connexion</h1>
      <LoginForm slug={params.slug} />
      <p className="mt-8 text-sm text-ink-faint">
        Mot de passe oublié ? Demandez au patron de le réinitialiser.
      </p>
    </main>
  );
}
