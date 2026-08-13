import 'server-only';

import { createClient } from '@supabase/supabase-js';

/**
 * Privileged Supabase client using the service-role key.
 *
 * SERVER ONLY. Never import this into a Client Component. Used exclusively by
 * admin Server Actions (creating users, resetting passwords) which bypass RLS.
 * The `server-only` import above makes a client bundle fail loudly if misused.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
