import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';

export const maxDuration = 10;

/**
 * Field-error beacon: browser-side crashes land in the Vercel function logs
 * (project → Logs, filter "[client-error]") so breakage on reps' phones is
 * visible without waiting for complaints.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: true }); // don't leak auth state

  const body = (await request.json().catch(() => null)) as {
    message?: string;
    stack?: string;
    url?: string;
  } | null;
  if (body?.message) {
    console.error('[client-error]', {
      user: user.username ?? user.id,
      url: String(body.url ?? '').slice(0, 200),
      message: String(body.message).slice(0, 500),
      stack: String(body.stack ?? '').slice(0, 1500),
    });
  }
  return NextResponse.json({ ok: true });
}
