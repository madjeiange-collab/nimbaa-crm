import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except static assets. Route guards live in the layouts, which
  // can query membership; the middleware only keeps the session fresh.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
