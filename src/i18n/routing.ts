import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  // French is the default; English is the fallback.
  locales: ['fr', 'en'],
  defaultLocale: 'fr',
  // Keep the default locale prefix hidden: "/home" is French, "/en/home" English.
  localePrefix: 'as-needed',
});

export type Locale = (typeof routing.locales)[number];
