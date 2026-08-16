import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getCurrentUser } from '@/lib/auth/session';
import { TRANSCRIBE_MODEL } from '@/lib/ai/config';

export const maxDuration = 30;

/** Voice dictation: accepts a short audio recording, returns the transcript. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const form = await request.formData().catch(() => null);
  const audio = form?.get('audio');
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  if (audio.size > 15 * 1024 * 1024) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 });
  }

  const openai = new OpenAI();
  try {
    const result = await openai.audio.transcriptions.create({
      file: audio,
      model: TRANSCRIBE_MODEL,
      // No language pin: reps speak French with Ivorian accents, sometimes
      // mixed with English — let the model auto-detect. The prompt biases it
      // toward the CRM's domain vocabulary instead of phonetic guesses.
      prompt:
        "Dictée d'un commercial terrain à Abidjan (Côte d'Ivoire) pour un CRM : " +
        'clients, prospects, affaires, rendez-vous (RDV), relance, montants en FCFA, ' +
        'installation, Cocody, Yopougon, Abobo, Marcory, Treichville, Koumassi, Port-Bouët.',
    });
    return NextResponse.json({ text: result.text ?? '' });
  } catch (e) {
    console.error('[transcribe]', e);
    return NextResponse.json({ error: 'ai_error' }, { status: 502 });
  }
}
