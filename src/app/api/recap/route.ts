import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getCurrentUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { AI_MODELS } from '@/lib/ai/config';
import {
  computeBoards,
  getPointConfig,
  startOfTodayIso,
  startOfWeekIso,
} from '@/lib/leaderboard/score';

export const maxDuration = 60;

/**
 * Writes the daily recap shown on the leaderboard.
 * Called by the Vercel cron (Authorization: Bearer CRON_SECRET) every evening,
 * or manually by a manager/admin from the leaderboard page.
 */
export async function GET(request: Request) {
  // --- auth: cron secret OR a signed-in manager/admin ----------------------
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  const isCron = !!cronSecret && auth === `Bearer ${cronSecret}`;
  if (!isCron) {
    const user = await getCurrentUser();
    if (!user || (user.role !== 'manager' && user.role !== 'admin')) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const admin = createAdminClient();
  const pts = await getPointConfig(admin);

  // Today's raw numbers + this week's standings.
  const todayIso = startOfTodayIso();
  const [today, week] = await Promise.all([
    computeBoards(admin, todayIso, pts),
    computeBoards(admin, startOfWeekIso(), pts),
  ]);

  const facts = {
    aujourd_hui: {
      commerciaux: today.reps.map((r) => ({
        nom: r.name,
        visites: r.a,
        interesses_rdv: r.b,
        ventes: r.c,
        fcfa: r.fcfa,
      })),
      techniciens: today.techs.map((r) => ({
        nom: r.name,
        terminees: r.a,
        en_cours: r.c,
      })),
    },
    classement_semaine: {
      commerciaux_top: week.reps.slice(0, 3).map((r, i) => ({
        rang: i + 1,
        nom: r.name,
        points: r.points,
        ventes: r.c,
        fcfa: r.fcfa,
      })),
      techniciens_top: week.techs.slice(0, 3).map((r, i) => ({
        rang: i + 1,
        nom: r.name,
        points: r.points,
        terminees: r.a,
      })),
    },
  };

  const openai = new OpenAI();
  try {
    const response = await openai.responses.create({
      model: AI_MODELS.manager,
      instructions:
        "Tu écris le récap quotidien de l'équipe terrain de Nimbaa (CRM de vente, Abidjan). " +
        'À partir des données JSON fournies, rédige un message court en français (5 à 9 lignes), ' +
        'énergique et bienveillant, avec quelques emojis : ' +
        "1) le bilan chiffré du jour, 2) félicite nommément le ou les meilleurs (commercial ET technicien s'il y en a), " +
        "3) un encouragement pour demain. Si la journée est vide, reste positif et motive pour demain. " +
        'Pas de titre, pas de markdown — du texte simple.',
      input: JSON.stringify(facts),
    });
    const content = response.output_text?.trim();
    if (!content) throw new Error('empty recap');

    const day = new Date().toISOString().slice(0, 10);
    const { error } = await admin
      .from('daily_recaps')
      .upsert({ day, content }, { onConflict: 'day' });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, day });
  } catch (e) {
    console.error('[recap]', e);
    return NextResponse.json({ error: 'ai_error' }, { status: 502 });
  }
}
