import { Link } from '@/i18n/navigation';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-4xl font-bold">404</p>
      <p className="text-muted-foreground">Page introuvable</p>
      <Link href="/home" className="text-primary underline underline-offset-4">
        Accueil
      </Link>
    </main>
  );
}
