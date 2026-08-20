/**
 * There is no platform-wide home in phase one: every surface belongs to a
 * restaurant, and staff arrive by a bookmarked /r/<slug>/... URL.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Nimbaa Resto</h1>
      <p className="mt-3 text-ink-soft">
        Ouvrez l’adresse de votre restaurant, par exemple{' '}
        <code className="rounded bg-white px-1.5 py-0.5 text-sm">/r/le-bambou</code>.
      </p>
    </main>
  );
}
