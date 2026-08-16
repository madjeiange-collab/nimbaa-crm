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
        visites: r.visits,
        refus: r.refused,
        interesses: r.interested,
        rdv: r.rdv,
        ventes: r.sales,
        taux_engagement_pct: r.engagementPct,
      })),
      techniciens: today.techs.map((r) => ({
        nom: r.name,
        terminees: r.done,
        en_cours: r.open,
      })),
    },
    classement_semaine: {
      commerciaux_top: week.reps.slice(0, 3).map((r, i) => ({
        rang: i + 1,
        nom: r.name,
        points: r.points,
        ventes: r.sales,
        taux_conversion_pct: r.conversionPct,
      })),
      techniciens_top: week.techs.slice(0, 3).map((r, i) => ({
        rang: i + 1,
        nom: r.name,
        points: r.points,
        terminees: r.done,
        taux_completion_pct: r.completionPct,
      })),
    },
  };

  // --- Manager brief facts: full per-person detail + attention points ------
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const staleCutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [{ data: flaggedToday }, { count: staleCount }] = await Promise.all([
    admin
      .from('flagged_visits')
      .select('rep_id, out_of_turf, implausible_rate, rapid_fire')
      .gte('visited_at', startToday.toISOString())
      .limit(500),
    admin
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .lt('updated_at', staleCutoff),
  ]);

  const managerFacts = {
    aujourd_hui_par_commercial: today.reps.map((r) => ({
      nom: r.name,
      visites: r.visits,
      refus: r.refused,
      interesses: r.interested,
      rdv: r.rdv,
      ventes: r.sales,
      ca_fcfa: r.fcfa,
      taux_engagement_pct: r.engagementPct,
      leads_crees: r.leads,
    })),
    aujourd_hui_par_technicien: today.techs.map((r) => ({
      nom: r.name,
      terminees: r.done,
      revisites: r.revisits,
      en_cours: r.open,
      taux_completion_pct: r.completionPct,
    })),
    classement_semaine: facts.classement_semaine,
    points_attention: {
      visites_suspectes_aujourd_hui: (flaggedToday ?? []).length,
      affaires_ouvertes_sans_activite_7j: staleCount ?? 0,
    },
  };

  const openai = new OpenAI();
  try {
    const [publicRes, managerRes] = await Promise.all([
      openai.responses.create({
        model: AI_MODELS.manager,
        instructions:
          "Tu écris le récap quotidien de l'équipe terrain de Nimbaa (CRM de vente, Abidjan). " +
          'À partir des données JSON fournies, rédige un message court en français (5 à 9 lignes), ' +
          'énergique et bienveillant, avec quelques emojis : ' +
          "1) le bilan chiffré du jour, 2) félicite nommément le ou les meilleurs (commercial ET technicien s'il y en a), " +
          "3) un encouragement pour demain. Si la journée est vide, reste positif et motive pour demain. " +
          'Pas de titre, pas de markdown — du texte simple.',
        input: JSON.stringify(facts),
      }),
      openai.responses.create({
        model: AI_MODELS.manager,
        instructions:
          'Tu écris le BRIEF MANAGER quotidien de Nimbaa (CRM de vente terrain, Abidjan) — réservé aux managers. ' +
          'À partir des données JSON, rédige en français un brief factuel et actionnable (10 à 18 lignes), structuré ainsi : ' +
          '1) « Commerciaux : » une ligne par commercial actif — nom, visites, engagés, ventes, CA FCFA, avec une mention si le taux d\'engagement est faible (<20%) ou fort (>40%) ; signale aussi tout commercial à zéro visite. ' +
          '2) « Techniciens : » une ligne par technicien — terminées, en cours, revisites. ' +
          '3) « À surveiller : » les points d\'attention (visites suspectes, affaires sans activité depuis 7j) avec une recommandation concrète chacun. ' +
          'Ton direct de chef d\'équipe, sans flatterie inutile. Tirets simples, pas de markdown lourd.',
        input: JSON.stringify(managerFacts),
      }),
    ]);

    const content = publicRes.output_text?.trim();
    const managerContent = managerRes.output_text?.trim();
    if (!content || !managerContent) throw new Error('empty recap');

    const day = new Date().toISOString().slice(0, 10);
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      admin.from('daily_recaps').upsert({ day, content }, { onConflict: 'day' }),
      admin
        .from('manager_recaps')
        .upsert({ day, content: managerContent }, { onConflict: 'day' }),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2 && !/manager_recaps/.test(e2.message)) throw new Error(e2.message);

    return NextResponse.json({ ok: true, day });
  } catch (e) {
    console.error('[recap]', e);
    return NextResponse.json({ error: 'ai_error' }, { status: 502 });
  }
}
