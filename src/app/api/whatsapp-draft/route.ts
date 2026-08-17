import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getCurrentUser } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { AI_MODELS, DAILY_QUESTION_CAP } from '@/lib/ai/config';

export const maxDuration = 30;

/**
 * Drafts a short WhatsApp follow-up for a contact from their real history
 * (last visits, open deals). Counts against the daily AI question cap.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { contactId?: string } | null;
  const contactId = body?.contactId;
  if (!contactId || typeof contactId !== 'string') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const supabase = await createClient();

  // Same daily cap as the assistant (shared ai_usage counter).
  const day = new Date().toISOString().slice(0, 10);
  const { data: usage } = await supabase
    .from('ai_usage')
    .select('questions')
    .eq('user_id', user.id)
    .eq('day', day)
    .maybeSingle();
  const used = usage?.questions ?? 0;
  if (used >= DAILY_QUESTION_CAP) {
    return NextResponse.json({ error: 'quota' }, { status: 429 });
  }

  const [{ data: contact }, { data: visits }, { data: deals }] = await Promise.all([
    supabase
      .from('contacts')
      .select('name, lifecycle, address')
      .eq('id', contactId)
      .maybeSingle(),
    supabase
      .from('visits')
      .select('visited_at, disposition, visit_type, notes')
      .eq('contact_id', contactId)
      .order('visited_at', { ascending: false })
      .limit(5),
    supabase
      .from('deals')
      .select('title, status, value_xof, pipeline_stages(name), products(name)')
      .eq('contact_id', contactId)
      .order('updated_at', { ascending: false })
      .limit(5),
  ]);
  if (!contact) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await supabase
    .from('ai_usage')
    .upsert({ user_id: user.id, day, questions: used + 1 }, { onConflict: 'user_id,day' });

  const facts = {
    contact: { nom: contact.name, statut: contact.lifecycle },
    commercial: user.full_name || user.username,
    dernieres_visites: ((visits ?? []) as {
      visited_at: string;
      disposition: string | null;
      visit_type: string | null;
      notes: string | null;
    }[]).map((v) => ({
      date: v.visited_at.slice(0, 10),
      resultat: v.disposition,
      type: v.visit_type,
      notes: v.notes,
    })),
    affaires: ((deals ?? []) as unknown as {
      title: string | null;
      status: string;
      value_xof: number | null;
      pipeline_stages: { name: string } | null;
      products: { name: string } | null;
    }[]).map((d) => ({
      produit: d.products?.name || d.title,
      statut: d.status,
      etape: d.pipeline_stages?.name ?? null,
      valeur_fcfa: d.value_xof,
    })),
  };

  try {
    const openai = new OpenAI();
    const res = await openai.responses.create({
      model: AI_MODELS.rep,
      instructions:
        "Tu rédiges un court message WhatsApp de suivi commercial pour un commercial terrain de Nimbaa (Abidjan, Côte d'Ivoire). " +
        'À partir des données JSON (contact, dernières visites, affaires en cours), écris UN message prêt à envoyer au client : ' +
        'en français, vouvoiement, chaleureux et professionnel, 2 à 4 phrases (max 500 caractères), qui rappelle le contexte ' +
        "(dernière visite ou affaire en cours) et propose une prochaine étape concrète (RDV, démonstration, réponse à une question). " +
        'Signe avec le prénom du commercial. Pas de crochets ni de champs à remplir, pas de markdown, pas de guillemets autour du message — ' +
        'uniquement le texte final du message.',
      input: JSON.stringify(facts),
    });
    const text = res.output_text?.trim();
    if (!text) throw new Error('empty draft');
    return NextResponse.json({ text });
  } catch (e) {
    console.error('[whatsapp-draft]', e);
    return NextResponse.json({ error: 'ai_error' }, { status: 502 });
  }
}
