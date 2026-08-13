'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Supabase client for use in Client Components (browser).
 *
 * NOTE: intentionally untyped for now. The hand-written `Database` type does
 * not satisfy supabase-js 2.112's deep result-type inference (every select
 * collapses to `never`). Once the project is linked, regenerate real types with
 * `supabase gen types typescript ... > src/types/database.ts` and add the
 * `<Database>` generic back here for fully typed queries.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
