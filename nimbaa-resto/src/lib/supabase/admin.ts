import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client. Bypasses RLS entirely, so it may only be used where the
 * caller has already been authorised by hand.
 *
 * The `server-only` import above is the guard: importing this module from a
 * Client Component is a build error, not a runtime leak of the key.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquant.');

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    // Same reason as the request client: no read of live data is cacheable.
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
}
