import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getCurrentUser } from '@/lib/auth/session';
import { TTS_MODEL, TTS_VOICE } from '@/lib/ai/config';
import { consumeAudioQuota } from '@/lib/ai/audio-cap';

export const maxDuration = 30;

/** Voice mode: turns an assistant reply into speech (mp3). */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }
  if (!(await consumeAudioQuota(user.id))) {
    return NextResponse.json({ error: 'quota' }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as { text?: string } | null;
  const text = (body?.text ?? '').trim().slice(0, 1500); // bound cost
  if (!text) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const openai = new OpenAI();
  try {
    const speech = await openai.audio.speech.create({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: text,
      instructions:
        'Voix naturelle, claire et chaleureuse. Débit modéré. Prononce les montants FCFA et les dates en français.',
    });
    const audio = Buffer.from(await speech.arrayBuffer());
    return new NextResponse(audio, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('[speak]', e);
    return NextResponse.json({ error: 'ai_error' }, { status: 502 });
  }
}
