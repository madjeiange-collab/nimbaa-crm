import { notFound } from 'next/navigation';

// Catches any path not matched by a real route and renders the localized
// not-found page (app/[locale]/not-found.tsx). This is the next-intl pattern
// for handling 404s without a root layout outside the [locale] segment.
export default function CatchAllPage() {
  notFound();
}
