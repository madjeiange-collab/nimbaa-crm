import { requireStaff } from '@/lib/auth/guard';
import { PasswordForm } from './password-form';

export default async function PasswordPage({ params }: { params: { slug: string } }) {
  const ctx = await requireStaff(params.slug, { allowPasswordChange: true });

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <p className="mb-1 font-mono text-xs uppercase tracking-widest text-service">
        {ctx.restaurant.name}
      </p>
      <h1 className="mb-2 text-2xl font-semibold">
        {ctx.mustChangePassword ? 'Choisissez votre mot de passe' : 'Changer le mot de passe'}
      </h1>
      {ctx.mustChangePassword && (
        <p className="mb-8 text-sm text-ink-soft">
          Votre compte a été créé avec un mot de passe provisoire. Choisissez-en un
          que vous seul connaissez avant de continuer.
        </p>
      )}
      <PasswordForm slug={params.slug} />
    </main>
  );
}
