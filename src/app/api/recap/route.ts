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

  // Today's raw numbers + this week's standings + prior week AT THE SAME
  // POINT (Monday → same weekday/time last week) for a fair comparison.
  const todayIso = startOfTodayIso();
  const weekStartIso = startOfWeekIso();
  const weekStart = new Date(weekStartIso);
  const prevWeekStart = new Date(weekStart.getTime() - 7 * 86400_000);
  const prevWeekCutoff = new Date(Date.now() - 7 * 86400_000);
  const [today, week, prevWeekToDate] = await Promise.all([
    computeBoards(admin, todayIso, pts),
    computeBoards(admin, weekStartIso, pts),
    computeBoards(admin, prevWeekStart.toISOString(), pts, prevWeekCutoff.toISOString()),
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
  const startTomorrow = new Date(startToday.getTime() + 86400_000);
  const startAfterTomorrow = new Date(startToday.getTime() + 2 * 86400_000);
  const tomorrowDate = startTomorrow.toISOString().slice(0, 10);
  const monthStart = new Date(startToday.getFullYear(), startToday.getMonth(), 1);
  const prevMonthStart = new Date(startToday.getFullYear(), startToday.getMonth() - 1, 1);
  const staleCutoff = new Date(Date.now() - 7 * 86400_000).toISOString();

  const [
    { data: flaggedToday },
    { count: staleCount },
    { data: rdvTomorrow },
    { data: lateInstalls },
    { data: revisitsTomorrow },
    { data: salesToday },
    { data: lostWeek },
    { data: hotDeals },
    { data: visitsTodayTimes },
    { data: terrAssign },
    { data: monthDeals },
    { data: goalSetting },
  ] = await Promise.all([
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
    admin
      .from('visits')
      .select('rep_id, appointment_date, contacts(name)')
      .gte('appointment_date', startTomorrow.toISOString())
      .lt('appointment_date', startAfterTomorrow.toISOString())
      .limit(100),
    admin
      .from('installations')
      .select('scheduled_date, installer_id, contacts(name)')
      .in('status', ['pending', 'scheduled', 'in_progress'])
      .lt('scheduled_date', startToday.toISOString().slice(0, 10))
      .limit(50),
    admin
      .from('installations')
      .select('installer_id, contacts(name)')
      .eq('next_visit_date', tomorrowDate)
      .limit(50),
    admin
      .from('deals')
      .select('value_xof, assigned_rep_id, won_at, title, products(name), contacts(name)')
      .eq('status', 'won')
      .gte('won_at', startToday.toISOString())
      .limit(50),
    admin
      .from('deals')
      .select('lost_reason, assigned_rep_id, contacts(name)')
      .eq('status', 'lost')
      .gte('updated_at', weekStartIso)
      .limit(50),
    admin
      .from('deals')
      .select('title, value_xof, updated_at, assigned_rep_id, pipeline_stages(name), contacts(name)')
      .eq('status', 'open')
      .order('value_xof', { ascending: false, nullsFirst: false })
      .limit(6),
    admin
      .from('visits')
      .select('rep_id, visited_at')
      .neq('visit_type', 'installation')
      .gte('visited_at', startToday.toISOString())
      .limit(2000),
    admin
      .from('territories')
      .select('name, is_active, user_territories(user_id)')
      .eq('is_active', true),
    admin
      .from('deals')
      .select('assigned_rep_id, won_at, value_xof')
      .eq('status', 'won')
      .gte('won_at', prevMonthStart.toISOString())
      .limit(5000),
    admin.from('app_settings').select('value').eq('key', 'daily_visit_goal').maybeSingle(),
  ]);

  const nameById = new Map(
    [...today.reps, ...today.techs, ...week.reps, ...week.techs].map((r) => [r.id, r.name]),
  );
  const repName = (id: string | null) => (id ? (nameById.get(id) ?? '—') : '—');
  const dailyGoal =
    Number((goalSetting?.value as { goal?: number } | null)?.goal) > 0
      ? Number((goalSetting!.value as { goal: number }).goal)
      : 30;

  // Amplitude of each rep's day (first → last visit).
  const times = new Map<string, { first: string; last: string }>();
  for (const v of (visitsTodayTimes ?? []) as { rep_id: string; visited_at: string }[]) {
    const t = times.get(v.rep_id);
    if (!t) times.set(v.rep_id, { first: v.visited_at, last: v.visited_at });
    else {
      if (v.visited_at < t.first) t.first = v.visited_at;
      if (v.visited_at > t.last) t.last = v.visited_at;
    }
  }
  const hhmm = (iso: string) => iso.slice(11, 16);

  // Secteurs with no visits this week from their assigned reps.
  const weekVisitsByRep = new Map(week.reps.map((r) => [r.id, r.visits]));
  const secteursSansActivite = ((terrAssign ?? []) as unknown as {
    name: string;
    user_territories: { user_id: string }[];
  }[])
    .filter(
      (t) =>
        t.user_territories.length === 0 ||
        t.user_territories.every((u) => (weekVisitsByRep.get(u.user_id) ?? 0) === 0),
    )
    .map((t) => t.name);

  // Auth activity: who has not signed in today (data-entry risk).
  let nonConnectes: string[] = [];
  try {
    const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 200 });
    const fieldIds = new Set([...week.reps, ...week.techs].map((r) => r.id));
    nonConnectes = (authUsers?.users ?? [])
      .filter(
        (u) =>
          fieldIds.has(u.id) &&
          (!u.last_sign_in_at || new Date(u.last_sign_in_at) < startToday),
      )
      .map((u) => repName(u.id));
  } catch {
    // auth admin unavailable — skip silently
  }

  // Month-end projection (run rate) vs last month.
  type MonthDeal = { assigned_rep_id: string | null; won_at: string | null; value_xof: number | null };
  const mDeals = (monthDeals ?? []) as MonthDeal[];
  const curMonth = mDeals.filter((d) => d.won_at && d.won_at >= monthStart.toISOString());
  const prevMonth = mDeals.filter((d) => d.won_at && d.won_at < monthStart.toISOString());
  const dayOfMonth = startToday.getDate();
  const daysInMonth = new Date(startToday.getFullYear(), startToday.getMonth() + 1, 0).getDate();
  const project = (n: number) => Math.round((n / Math.max(1, dayOfMonth)) * daysInMonth);

  // Streaks & records: days since each rep's last sale + best team day this month.
  const lastSaleByRep = new Map<string, string>();
  for (const d of mDeals) {
    if (!d.assigned_rep_id || !d.won_at) continue;
    const prev = lastSaleByRep.get(d.assigned_rep_id);
    if (!prev || d.won_at > prev) lastSaleByRep.set(d.assigned_rep_id, d.won_at);
  }
  const salesByDay = new Map<string, number>();
  for (const d of curMonth) {
    if (!d.won_at) continue;
    const day = d.won_at.slice(0, 10);
    salesByDay.set(day, (salesByDay.get(day) ?? 0) + 1);
  }
  const bestDay = [...salesByDay.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

  const managerFacts = {
    objectif_visites_par_jour: dailyGoal,
    aujourd_hui_par_commercial: today.reps.map((r) => ({
      nom: r.name,
      visites: r.visits,
      objectif_atteint_pct: Math.round((r.visits / dailyGoal) * 100),
      amplitude_journee: times.has(r.id)
        ? `${hhmm(times.get(r.id)!.first)}–${hhmm(times.get(r.id)!.last)}`
        : null,
      refus: r.refused,
      interesses: r.interested,
      rdv: r.rdv,
      ventes: r.sales,
      ca_fcfa: r.fcfa,
      taux_engagement_pct: r.engagementPct,
      leads_crees: r.leads,
      jours_depuis_derniere_vente: lastSaleByRep.has(r.id)
        ? Math.floor(
            (Date.now() - new Date(lastSaleByRep.get(r.id)!).getTime()) / 86400_000,
          )
        : null,
    })),
    aujourd_hui_par_technicien: today.techs.map((r) => ({
      nom: r.name,
      terminees: r.done,
      revisites: r.revisits,
      en_cours: r.open,
      taux_completion_pct: r.completionPct,
    })),
    classement_semaine: facts.classement_semaine,
    // Week-to-date vs prior week at the same point (fair comparison).
    semaine_vs_semaine_derniere_a_date: {
      commerciaux: week.reps.map((r) => {
        const prev = prevWeekToDate.reps.find((p) => p.id === r.id);
        return {
          nom: r.name,
          visites: { cette_semaine: r.visits, semaine_derniere: prev?.visits ?? 0 },
          ventes: { cette_semaine: r.sales, semaine_derniere: prev?.sales ?? 0 },
          ca_fcfa: { cette_semaine: r.fcfa, semaine_derniere: prev?.fcfa ?? 0 },
        };
      }),
      techniciens: week.techs.map((r) => {
        const prev = prevWeekToDate.techs.find((p) => p.id === r.id);
        return {
          nom: r.name,
          terminees: { cette_semaine: r.done, semaine_derniere: prev?.done ?? 0 },
        };
      }),
    },
    ventes_du_jour: ((salesToday ?? []) as unknown as {
      value_xof: number | null;
      assigned_rep_id: string | null;
      title: string | null;
      products: { name: string } | null;
      contacts: { name: string | null } | null;
    }[]).map((d) => ({
      client: d.contacts?.name ?? '—',
      produit: d.products?.name || d.title || '—',
      ca_fcfa: d.value_xof ?? 0,
      vendeur: repName(d.assigned_rep_id),
    })),
    affaires_chaudes_a_pousser: ((hotDeals ?? []) as unknown as {
      title: string | null;
      value_xof: number | null;
      updated_at: string;
      assigned_rep_id: string | null;
      pipeline_stages: { name: string } | null;
      contacts: { name: string | null } | null;
    }[]).map((d) => ({
      client: d.contacts?.name ?? '—',
      affaire: d.title || '—',
      valeur_fcfa: d.value_xof ?? 0,
      etape: d.pipeline_stages?.name ?? '—',
      commercial: repName(d.assigned_rep_id),
      jours_sans_activite: Math.floor(
        (Date.now() - new Date(d.updated_at).getTime()) / 86400_000,
      ),
    })),
    demain: {
      rdv: ((rdvTomorrow ?? []) as unknown as {
        rep_id: string;
        appointment_date: string;
        contacts: { name: string | null } | null;
      }[]).map((r) => ({
        commercial: repName(r.rep_id),
        heure: hhmm(r.appointment_date),
        client: r.contacts?.name ?? '—',
      })),
      revisites_installation: ((revisitsTomorrow ?? []) as unknown as {
        installer_id: string | null;
        contacts: { name: string | null } | null;
      }[]).map((r) => ({
        technicien: repName(r.installer_id),
        client: r.contacts?.name ?? '—',
      })),
    },
    installations_en_retard: ((lateInstalls ?? []) as unknown as {
      scheduled_date: string | null;
      installer_id: string | null;
      contacts: { name: string | null } | null;
    }[]).map((r) => ({
      client: r.contacts?.name ?? '—',
      technicien: repName(r.installer_id),
      prevue_le: r.scheduled_date,
    })),
    pertes_de_la_semaine: ((lostWeek ?? []) as unknown as {
      lost_reason: string | null;
      assigned_rep_id: string | null;
      contacts: { name: string | null } | null;
    }[]).map((d) => ({
      client: d.contacts?.name ?? '—',
      raison: d.lost_reason?.trim() || 'non précisée',
      commercial: repName(d.assigned_rep_id),
    })),
    cap_fin_de_mois: {
      jour_du_mois: `${dayOfMonth}/${daysInMonth}`,
      ventes_mois_en_cours: curMonth.length,
      ca_mois_en_cours_fcfa: curMonth.reduce((s, d) => s + (d.value_xof ?? 0), 0),
      projection_ventes_fin_de_mois: project(curMonth.length),
      projection_ca_fin_de_mois_fcfa: project(
        curMonth.reduce((s, d) => s + (d.value_xof ?? 0), 0),
      ),
      mois_precedent: {
        ventes: prevMonth.length,
        ca_fcfa: prevMonth.reduce((s, d) => s + (d.value_xof ?? 0), 0),
      },
      meilleure_journee_du_mois: bestDay
        ? { date: bestDay[0], ventes: bestDay[1] }
        : null,
    },
    points_attention: {
      visites_suspectes_aujourd_hui: (flaggedToday ?? []).length,
      affaires_ouvertes_sans_activite_7j: staleCount ?? 0,
      secteurs_sans_activite_cette_semaine: secteursSansActivite,
      pas_connectes_aujourd_hui: nonConnectes,
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
          'À partir des données JSON, rédige en français un brief factuel et actionnable (20 à 40 lignes), structuré en sections courtes : ' +
          "1) « Commerciaux : » une ligne par commercial actif — visites (+ % objectif et amplitude de journée si dispo), engagés, ventes, CA FCFA ; mentionne un taux d'engagement faible (<20%) ou fort (>40%), tout commercial à zéro visite, et une série sans vente ≥5 jours. " +
          '2) « Techniciens : » une ligne par technicien — terminées, en cours, revisites — plus les installations EN RETARD (client + technicien) s\'il y en a. ' +
          "3) « Semaine vs semaine dernière (à date comparable) : » évolution par personne (visites, ventes, CA / terminées) avec ↗/↘/= — souligne les vraies progressions et les baisses inquiétantes. " +
          "4) « Conclu aujourd'hui : » chaque vente du jour (client, produit, CA, vendeur) — et les pertes de la semaine avec leur raison si présentes. " +
          '5) « À pousser : » les 3 à 5 affaires chaudes les plus intéressantes (client, valeur, étape, jours sans activité, commercial). ' +
          '6) « Demain : » les RDV (heure, client, commercial) et les revisites d\'installation prévues. ' +
          "7) « Cap fin de mois : » projection ventes/CA au rythme actuel vs le mois dernier, et la meilleure journée du mois ; termine par « À surveiller : » visites suspectes, affaires dormantes, secteurs sans activité et personnes non connectées aujourd'hui, avec une recommandation concrète chacun. " +
          "Omets toute section vide. Ton direct de chef d'équipe, sans flatterie. Tirets simples, pas de markdown lourd.",
        input: JSON.stringify(managerFacts),
      }),
    ]);

    const content = publicRes.output_text?.trim();
    const managerBrief = managerRes.output_text?.trim();
    if (!content || !managerBrief) throw new Error('empty recap');

    // Managers read the same high-level story first, then the full detail.
    const managerContent = `${content}\n\n────── Détail ──────\n\n${managerBrief}`;

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
