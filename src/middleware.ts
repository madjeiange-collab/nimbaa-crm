import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
import { routing } from '@/i18n/routing';
import { updateSession } from '@/lib/supabase/middleware';

const intlMiddleware = createMiddleware(routing);

export async function middleware(request: NextRequest) {
  // 1. Locale routing (fr default, en fallback) produces the base response.
  const response = intlMiddleware(request);
  // 2. Refresh the Supabase session and sync auth cookies onto that response.
  return updateSession(request, response);
}

export const config = {
  // Run on everything except static assets and API routes.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
