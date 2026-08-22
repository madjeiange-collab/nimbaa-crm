import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Reads and writes the auth session from the request cookies, so every query
 * runs as the signed-in staff member and RLS applies.
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Next caches every fetch a Server Component makes, and with no
      // cache-control from the API that default is "keep it forever". A
      // restaurant is a live shared view: the patron edits the carte on his
      // phone while the waiter reads it on a tablet, and each read that comes
      // from a cache is a plate ordered from a menu that no longer exists.
      // Nothing this client fetches is ever cacheable.
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, { ...init, cache: 'no-store' }),
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}
