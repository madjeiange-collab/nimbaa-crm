import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppUser } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';
import { pointInAnyPolygon } from '@/lib/geo';
import { computeBoards, getPointConfig, startOfWeekIso } from '@/lib/leaderboard/score';

/**
 * Assistant tools. Every executor runs on the LOGGED-IN user's Supabase
 * client, so RLS scopes what the assistant can see exactly like the app UI.
 * Executors return plain JSON-serialisable data; the model does the prose.
 */

// OpenAI Responses API function-tool definitions (flat format).
export const TOOL_DEFINITIONS: OpenAI.Responses.Tool[] = [
  {
    type: 'function' as const,
    strict: true,
    name: 'search_contacts',
    description:
      "Recherche des clients/prospects par nom ou numéro de téléphone. Retourne id, nom, téléphone, statut (lead/customer/lost), adresse et valeur FCFA.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Nom (partiel) ou numéro de téléphone' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'pipeline_stats',
    description:
      "Statistiques du pipeline de ventes (affaires par étape, gagnées/perdues, valeur FCFA). Pour un commercial : ses affaires. Pour un manager/admin : toute l'équipe. Utiliser pour toute question sur les ventes, le pipeline, les chiffres.",
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['week', 'month', 'all'],
          description: "Période pour les affaires gagnées ('week'=7 jours, 'month'=30 jours, 'all'=tout)",
        },
      },
      required: ['period'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'visit_stats',
    description:
      "Statistiques d'activité terrain agrégées : nombre de visites, contacts visités (clients vs prospects, uniques), répartition par résultat (intéressé, vendu, refus…), et — pour un manager — par commercial. Utiliser pour 'combien de visites/clients visités aujourd'hui', 'activité de la semaine', 'qui a visité combien'.",
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['today', 'week', 'month'],
          description: "Période ('today' = aujourd'hui, 'week' = 7 jours, 'month' = 30 jours)",
        },
      },
      required: ['period'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'my_todo',
    description:
      "La liste 'À faire' de l'utilisateur : rendez-vous du jour, rendez-vous en retard, et prospects à relancer (sans contact depuis plus de 7 jours). Utiliser pour 'qui dois-je relancer', 'mes RDV', 'quoi faire aujourd'hui'.",
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'contact_history',
    description:
      "Historique d'un contact : dernières visites (avec résultat et notes) et activités (appels, WhatsApp, notes). Utiliser avant un rendez-vous ou pour résumer la relation. Passer l'id retourné par search_contacts.",
    parameters: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: 'ID du contact (uuid)' },
      },
      required: ['contact_id'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'installations_list',
    description:
      "Les installations (interventions techniques) : titre, statut (pending/scheduled/in_progress/done/needs_revisit), dates, client, technicien. Pour un technicien : ses installations. Pour les autres rôles : toutes. Utiliser pour 'mes installations', 'installations en attente', 'planning technicien'.",
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'done', 'all'],
          description: "'open' = pas encore terminées, 'done' = terminées, 'all' = toutes",
        },
      },
      required: ['status'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'products_list',
    description:
      'Le catalogue produits : nom, prix en FCFA et taux de commission (%). Utiliser pour toute question sur les produits, tarifs ou commissions.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'territories_list',
    description:
      "Les secteurs (territoires) : nom, type, zones couvertes, et qui y est assigné. Un commercial ne voit que ses propres secteurs ; un manager/admin les voit tous. Utiliser pour 'mes secteurs', 'qui couvre Yopougon', etc.",
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'photos_summary',
    description:
      "Résumé des photos de visite (preuve de passage) : nombre de photos par commercial sur une période. Pour un commercial : ses propres photos. Utiliser pour l'audit photo, 'combien de photos cette semaine'.",
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['week', 'month'], description: 'Période' },
      },
      required: ['period'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'funnel_stats',
    description:
      "Entonnoir de conversion avec comparaison à la période précédente : visites → intéressés → RDV → ventes, taux à chaque étape, évolution. Pour un manager : aussi le détail par commercial. Utiliser pour 'où perd-on des prospects', 'pourquoi moins de ventes', 'analyse de la conversion'.",
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['week', 'month'], description: 'Période analysée (comparée à la précédente)' },
      },
      required: ['period'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'secteur_stats',
    description:
      "Performance par secteur (territoire) : visites, prospects créés, ventes et CA par zone géographique. Utiliser pour 'quel secteur performe', 'où renforcer l'équipe', 'comparer les zones'.",
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['week', 'month', 'all'], description: 'Période' },
      },
      required: ['period'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'product_stats',
    description:
      "Ventes par produit : nombre d'affaires gagnées, CA, panier moyen, meilleur produit de la période, avec comparaison à la période précédente. Utiliser pour 'qu'est-ce qui se vend', 'quel produit marche'.",
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['week', 'month', 'all'], description: 'Période' },
      },
      required: ['period'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'commission_stats',
    description:
      "Commissions : acquises, payées, en attente et expirées sur la période, séparées ventes (commerciaux) / installations (techniciens), avec comparaison à la période précédente équivalente (jour vs veille, semaine vs semaine dernière à date, mois vs mois dernier à date). Managers/admins voient tout le monde (+ détail par personne) ; commerciaux et techniciens uniquement leurs propres commissions. Utiliser pour 'mes commissions', 'combien de commissions ce mois', 'commissions à payer', 'évolution des commissions'.",
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month'], description: 'Période' },
      },
      required: ['period'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'business_type_stats',
    description:
      "Analyse par type d'activité (maquis, restaurant, glacier, chawarma, boutique…) : affaires gagnées et pipeline ouvert par type, plus les tags les plus fréquents. Utiliser pour 'quel type de commerce achète le plus', 'combien de maquis ce mois', 'analyse par tag'.",
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['week', 'month', 'all'], description: 'Période' },
      },
      required: ['period'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'stale_deals',
    description:
      "Affaires qui traînent : affaires OUVERTES sans aucune mise à jour depuis N jours, les plus anciennes d'abord, avec client et étape. Utiliser pour 'quelles affaires sont bloquées', 'relances pipeline'.",
    parameters: {
      type: 'object',
      properties: {
        min_days: { type: 'number', description: 'Ancienneté minimale en jours (7 par défaut si hésitation)' },
      },
      required: ['min_days'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'neglected_contacts',
    description:
      "Clients à risque : clients sans visite depuis N jours et prospects jamais recontactés — avec téléphone pour agir. Utiliser pour 'qui risque-t-on de perdre', 'clients délaissés'.",
    parameters: {
      type: 'object',
      properties: {
        min_days: { type: 'number', description: 'Jours sans visite (30 par défaut si hésitation)' },
      },
      required: ['min_days'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'install_cycle_stats',
    description:
      "Analyse des installations : délai moyen vente→installation terminée, backlog par statut, taux de revisite, détail par technicien. Utiliser pour 'installe-t-on assez vite', 'charge des techniciens'.",
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['week', 'month', 'all'], description: 'Période (installations terminées)' },
      },
      required: ['period'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'rdv_overview',
    description:
      "Vue des rendez-vous : RDV à venir (7 jours) et RDV en retard, avec client et téléphone. Pour un manager : toute l'équipe, par commercial. Utiliser pour 'qui a des RDV demain', 'RDV manqués'.",
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'lost_analysis',
    description:
      "Analyse des affaires perdues : nombre, raisons de perte (lost_reason) et détail par commercial. Utiliser pour 'pourquoi perd-on', 'raisons d'échec'.",
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['month', 'all'], description: 'Période' },
      },
      required: ['period'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'leaderboard_standings',
    description:
      "Le classement de la semaine (points) : top commerciaux et top techniciens, comme sur la page Classement. Utiliser pour 'qui est en tête', 'mon rang'.",
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'monthly_stats',
    description:
      "Série mensuelle (mois calendaires) : pour chaque mois — visites, prospects engagés, ventes, nouveaux contacts, installations terminées, et CA pour un manager. LA référence pour comparer un mois à un autre ('juillet vs août'), analyser l'évolution sur plusieurs mois ou la saisonnalité.",
    parameters: {
      type: 'object',
      properties: {
        months: {
          type: 'number',
          description: 'Nombre de mois à couvrir, mois en cours inclus (6 par défaut si hésitation, max 12)',
        },
      },
      required: ['months'],
      additionalProperties: false,
    },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'daily_trend',
    description:
      "Tendance jour par jour sur 30 jours : visites et ventes quotidiennes, pour dire si l'activité monte ou descend. Utiliser pour 'ça progresse ?', 'momentum', 'comparer les semaines'.",
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'flagged_visits_summary',
    description:
      "RÉSERVÉ MANAGERS/ADMINS — visites suspectes (anti-fraude) : hors secteur, cadence invraisemblable (>40 portes/heure), enchaînement trop rapide (<3s). Retourne les comptes par commercial et les cas récents.",
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function' as const,
    strict: true,
    name: 'team_list',
    description:
      "RÉSERVÉ MANAGERS/ADMINS — la liste de l'équipe : nom, rôle (commercial/technicien/manager/admin), actif ou non, capacités B2B/porte-à-porte.",
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
];

type Db = SupabaseClient;

async function searchContacts(db: Db, args: { query: string }) {
  const q = (args.query ?? '').trim();
  if (!q) return { error: 'requête vide' };
  const { data, error } = await db
    .from('contacts')
    .select('id, name, phone, lifecycle, address, value_xof, priority')
    .or(`name.ilike.%${q.replace(/[%,()]/g, '')}%,phone.ilike.%${q.replace(/[%,()]/g, '')}%`)
    .limit(8);
  if (error) return { error: error.message };
  return { results: data ?? [] };
}

async function pipelineStats(db: Db, user: AppUser, args: { period: string }) {
  const isManager = user.role === 'manager' || user.role === 'admin';
  const days = args.period === 'week' ? 7 : args.period === 'month' ? 30 : null;
  const since = days ? new Date(Date.now() - days * 86400_000).toISOString() : null;

  let dealsQ = db
    .from('deals')
    .select('status, value_xof, won_at, pipeline_stages(name)');
  if (!isManager) dealsQ = dealsQ.eq('assigned_rep_id', user.id);
  const { data: deals, error } = await dealsQ;
  if (error) return { error: error.message };

  const rows = (deals ?? []) as unknown as {
    status: string;
    value_xof: number | null;
    won_at: string | null;
    pipeline_stages: { name: string } | null;
  }[];

  const byStage: Record<string, number> = {};
  for (const d of rows.filter((d) => d.status === 'open')) {
    const stage = d.pipeline_stages?.name ?? 'Sans étape';
    byStage[stage] = (byStage[stage] ?? 0) + 1;
  }
  const won = rows.filter(
    (d) => d.status === 'won' && (!since || (d.won_at && d.won_at >= since)),
  );
  const lost = rows.filter((d) => d.status === 'lost');

  return {
    scope: isManager ? 'équipe entière' : 'mes affaires',
    period: args.period,
    open_by_stage: byStage,
    open_total: rows.filter((d) => d.status === 'open').length,
    won_count: won.length,
    won_value_xof: won.reduce((s, d) => s + (d.value_xof ?? 0), 0),
    lost_count: lost.length,
  };
}

async function visitStats(db: Db, user: AppUser, args: { period: string }) {
  const isManager = user.role === 'manager' || user.role === 'admin';
  const since = new Date();
  if (args.period === 'today') since.setHours(0, 0, 0, 0);
  else if (args.period === 'week') since.setDate(since.getDate() - 7);
  else since.setDate(since.getDate() - 30);

  let q = db
    .from('visits')
    .select('rep_id, disposition, contact_id, visit_type, contacts(lifecycle)')
    .neq('visit_type', 'installation')
    .gte('visited_at', since.toISOString())
    .limit(5000);
  if (!isManager) q = q.eq('rep_id', user.id);
  const { data, error } = await q;
  if (error) return { error: error.message };

  const rows = (data ?? []) as unknown as {
    rep_id: string;
    disposition: string | null;
    contact_id: string | null;
    contacts: { lifecycle: string } | null;
  }[];

  const byResult: Record<string, number> = {};
  const customers = new Set<string>();
  const leads = new Set<string>();
  const byRep = new Map<string, number>();
  for (const v of rows) {
    byResult[v.disposition ?? 'inconnu'] = (byResult[v.disposition ?? 'inconnu'] ?? 0) + 1;
    if (v.contact_id) {
      if (v.contacts?.lifecycle === 'customer') customers.add(v.contact_id);
      else if (v.contacts?.lifecycle === 'lead') leads.add(v.contact_id);
    }
    byRep.set(v.rep_id, (byRep.get(v.rep_id) ?? 0) + 1);
  }

  let parCommercial: { commercial: string; visites: number }[] | undefined;
  if (isManager) {
    const { data: reps } = await db
      .from('users')
      .select('id, full_name, username')
      .in('id', [...byRep.keys()]);
    const nameOf = new Map((reps ?? []).map((u) => [u.id, u.full_name || u.username || u.id]));
    parCommercial = [...byRep.entries()]
      .map(([id, n]) => ({ commercial: nameOf.get(id) ?? '—', visites: n }))
      .sort((a, b) => b.visites - a.visites);
  }

  return {
    scope: isManager ? 'équipe entière' : 'mes visites',
    periode: args.period,
    visites_total: rows.length,
    clients_visites_uniques: customers.size,
    prospects_visites_uniques: leads.size,
    portes_sans_contact: rows.filter((v) => !v.contact_id).length,
    par_resultat: byResult,
    ...(parCommercial ? { par_commercial: parCommercial } : {}),
  };
}

async function myTodo(db: Db, user: AppUser) {
  const now = new Date();
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const in7d = new Date(now.getTime() + 7 * 86400_000);
  const ago7d = new Date(now.getTime() - 7 * 86400_000).toISOString();

  const [{ data: appts }, { data: stale }] = await Promise.all([
    db
      .from('visits')
      .select('appointment_date, contacts(id, name, phone, address)')
      .eq('rep_id', user.id)
      .not('appointment_date', 'is', null)
      .gte('appointment_date', new Date(startToday.getTime() - 30 * 86400_000).toISOString())
      .lte('appointment_date', in7d.toISOString())
      .order('appointment_date', { ascending: true })
      .limit(20),
    db
      .from('contacts')
      .select('id, name, phone, updated_at')
      .eq('assigned_rep_id', user.id)
      .eq('lifecycle', 'lead')
      .lt('updated_at', ago7d)
      .order('updated_at', { ascending: true })
      .limit(10),
  ]);

  type Appt = {
    appointment_date: string;
    contacts: { id: string; name: string | null; phone: string | null; address: string | null } | null;
  };
  const rows = (appts ?? []) as unknown as Appt[];
  const overdue = rows.filter((a) => new Date(a.appointment_date) < startToday);
  const upcoming = rows.filter((a) => new Date(a.appointment_date) >= startToday);

  return {
    rendez_vous_en_retard: overdue.map((a) => ({
      date: a.appointment_date,
      contact: a.contacts?.name ?? '—',
      phone: a.contacts?.phone,
    })),
    rendez_vous_a_venir: upcoming.map((a) => ({
      date: a.appointment_date,
      contact: a.contacts?.name ?? '—',
      phone: a.contacts?.phone,
    })),
    prospects_a_relancer: (stale ?? []).map((c) => ({
      contact: c.name ?? '—',
      phone: c.phone,
      dernier_contact: c.updated_at,
    })),
  };
}

async function contactHistory(db: Db, args: { contact_id: string }) {
  const [{ data: contact }, { data: visits }, { data: activities }, { data: deals }, { data: people }] =
    await Promise.all([
      db
        .from('contacts')
        .select('id, name, phone, lifecycle, address, value_xof, priority')
        .eq('id', args.contact_id)
        .maybeSingle(),
      db
        .from('visits')
        .select('visited_at, disposition, notes, appointment_date, users(full_name)')
        .eq('contact_id', args.contact_id)
        .order('visited_at', { ascending: false })
        .limit(8),
      db
        .from('activities')
        .select('type, content, created_at, users(full_name)')
        .eq('contact_id', args.contact_id)
        .order('created_at', { ascending: false })
        .limit(8),
      db
        .from('deals')
        .select('title, status, value_xof, won_at, business_type, tags, pipeline_stages(name)')
        .eq('contact_id', args.contact_id),
      db
        .from('contact_people')
        .select('name, role, phone, email')
        .eq('contact_id', args.contact_id),
    ]);
  if (!contact) return { error: 'contact introuvable' };
  return {
    contact,
    interlocuteurs: people ?? [],
    affaires: deals ?? [],
    visites: visits ?? [],
    activites: activities ?? [],
  };
}

const OPEN_INSTALL_STATUSES = ['pending', 'scheduled', 'in_progress', 'needs_revisit'];

async function installationsList(db: Db, user: AppUser, args: { status: string }) {
  let q = db
    .from('installations')
    .select(
      'title, status, scheduled_date, next_visit_date, completed_at, contacts(name, address), installer:users!installer_id(full_name)',
    )
    .order('updated_at', { ascending: false })
    .limit(25);
  if (user.role === 'technician') q = q.eq('installer_id', user.id);
  if (args.status === 'open') q = q.in('status', OPEN_INSTALL_STATUSES);
  if (args.status === 'done') q = q.eq('status', 'done');
  const { data, error } = await q;
  if (error) return { error: error.message };

  const rows = (data ?? []) as unknown as {
    title: string | null;
    status: string;
    scheduled_date: string | null;
    next_visit_date: string | null;
    completed_at: string | null;
    contacts: { name: string | null; address: string | null } | null;
    installer: { full_name: string | null } | null;
  }[];
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return {
    scope: user.role === 'technician' ? 'mes installations' : 'toutes les installations',
    counts_by_status: byStatus,
    installations: rows.map((r) => ({
      titre: r.title,
      statut: r.status,
      date_prevue: r.scheduled_date,
      revisite: r.next_visit_date,
      terminee_le: r.completed_at,
      client: r.contacts?.name ?? '—',
      adresse: r.contacts?.address,
      technicien: r.installer?.full_name ?? null,
    })),
  };
}

async function productsList(db: Db) {
  const { data, error } = await db
    .from('products')
    .select('name, price_xof, commission_pct, is_active')
    .order('sort_order');
  if (error) return { error: error.message };
  return {
    produits: (data ?? []).map((p) => ({
      nom: p.name,
      prix_fcfa: p.price_xof,
      commission_pct: p.commission_pct,
      actif: p.is_active,
    })),
  };
}

async function territoriesList(db: Db) {
  const [{ data: terrs, error }, { data: links }] = await Promise.all([
    db.from('territories').select('id, name, type, description, is_active').order('name'),
    db.from('user_territories').select('territory_id, users(full_name)'),
  ]);
  if (error) return { error: error.message };
  type Link = { territory_id: string; users: { full_name: string | null } | null };
  const byTerr = new Map<string, string[]>();
  for (const l of (links ?? []) as unknown as Link[]) {
    if (!l.users?.full_name) continue;
    const list = byTerr.get(l.territory_id) ?? [];
    list.push(l.users.full_name);
    byTerr.set(l.territory_id, list);
  }
  return {
    note: 'Un commercial ne voit que ses propres secteurs (RLS).',
    secteurs: (terrs ?? []).map((t) => ({
      nom: t.name,
      type: t.type,
      zones: t.description,
      actif: t.is_active,
      assigne_a: byTerr.get(t.id) ?? [],
    })),
  };
}

async function photosSummary(db: Db, user: AppUser, args: { period: string }) {
  const days = args.period === 'week' ? 7 : 30;
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const { data, error } = await db
    .from('visit_photos')
    .select('taken_at, visits!inner(rep_id)')
    .gte('taken_at', since)
    .limit(2000);
  if (error) return { error: error.message };

  const rows = (data ?? []) as unknown as { visits: { rep_id: string } }[];
  const byRep = new Map<string, number>();
  for (const r of rows) byRep.set(r.visits.rep_id, (byRep.get(r.visits.rep_id) ?? 0) + 1);

  // Resolve names (managers/admins can read all users; a rep resolves only itself).
  const { data: reps } = await db
    .from('users')
    .select('id, full_name, username')
    .in('id', [...byRep.keys()]);
  const nameOf = new Map((reps ?? []).map((u) => [u.id, u.full_name || u.username || u.id]));

  return {
    periode: args.period,
    total_photos: rows.length,
    par_commercial: [...byRep.entries()].map(([id, n]) => ({
      commercial: nameOf.get(id) ?? '—',
      photos: n,
    })),
  };
}

async function flaggedVisitsSummary(db: Db, user: AppUser) {
  if (user.role !== 'manager' && user.role !== 'admin') {
    return { error: 'Réservé aux managers et administrateurs.' };
  }
  const { data, error } = await db
    .from('flagged_visits')
    .select('rep_id, visited_at, out_of_turf, implausible_rate, rapid_fire')
    .order('visited_at', { ascending: false })
    .limit(100);
  if (error) return { error: error.message };

  const rows = data ?? [];
  const byRep = new Map<string, { hors_secteur: number; cadence: number; rapide: number }>();
  for (const r of rows) {
    const agg = byRep.get(r.rep_id) ?? { hors_secteur: 0, cadence: 0, rapide: 0 };
    if (r.out_of_turf) agg.hors_secteur++;
    if (r.implausible_rate) agg.cadence++;
    if (r.rapid_fire) agg.rapide++;
    byRep.set(r.rep_id, agg);
  }
  const { data: reps } = await db
    .from('users')
    .select('id, full_name, username')
    .in('id', [...byRep.keys()]);
  const nameOf = new Map((reps ?? []).map((u) => [u.id, u.full_name || u.username || u.id]));

  return {
    note: '100 cas les plus récents. hors_secteur = visite hors zone assignée ; cadence = >40 portes/h ; rapide = <3s entre deux portes.',
    total_recent: rows.length,
    par_commercial: [...byRep.entries()].map(([id, agg]) => ({
      commercial: nameOf.get(id) ?? '—',
      ...agg,
    })),
    derniers_cas: rows.slice(0, 10).map((r) => ({
      commercial: nameOf.get(r.rep_id) ?? '—',
      date: r.visited_at,
      hors_secteur: r.out_of_turf,
      cadence_invraisemblable: r.implausible_rate,
      trop_rapide: r.rapid_fire,
    })),
  };
}

async function teamList(db: Db, user: AppUser) {
  if (user.role !== 'manager' && user.role !== 'admin') {
    return { error: 'Réservé aux managers et administrateurs.' };
  }
  const { data, error } = await db
    .from('users')
    .select('full_name, username, role, is_active, can_do_b2b, can_do_d2d')
    .order('role')
    .order('full_name');
  if (error) return { error: error.message };
  return {
    equipe: (data ?? []).map((u) => ({
      nom: u.full_name || u.username,
      role: u.role,
      actif: u.is_active,
      b2b: u.can_do_b2b,
      porte_a_porte: u.can_do_d2d,
    })),
  };
}

// ---------------------------------------------------------------------------
// Analysis aggregations
// ---------------------------------------------------------------------------

function periodStart(period: string, from = new Date()): Date {
  const d = new Date(from);
  if (period === 'today') d.setHours(0, 0, 0, 0);
  else if (period === 'week') d.setDate(d.getDate() - 7);
  else if (period === 'month') d.setDate(d.getDate() - 30);
  else return new Date(0); // 'all'
  return d;
}

const isManagerRole = (u: AppUser) => u.role === 'manager' || u.role === 'admin';
const pctOf = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);

async function repNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await db.from('users').select('id, full_name, username').in('id', ids);
  return new Map((data ?? []).map((u) => [u.id, u.full_name || u.username || '—']));
}

async function funnelStats(db: Db, user: AppUser, args: { period: string }) {
  const isManager = isManagerRole(user);
  const now = new Date();
  const since = periodStart(args.period, now);
  const prevSince = new Date(since.getTime() - (now.getTime() - since.getTime()));

  let vq = db
    .from('visits')
    .select('rep_id, disposition, visited_at')
    .neq('visit_type', 'installation')
    .gte('visited_at', prevSince.toISOString())
    .limit(10000);
  if (!isManager) vq = vq.eq('rep_id', user.id);
  let dq = db
    .from('deals')
    .select('assigned_rep_id, won_at')
    .eq('status', 'won')
    .gte('won_at', prevSince.toISOString())
    .limit(5000);
  if (!isManager) dq = dq.eq('assigned_rep_id', user.id);
  const [{ data: vs, error }, { data: ds }] = await Promise.all([vq, dq]);
  if (error) return { error: error.message };

  const cut = since.toISOString();
  const funnelOf = (rows: { disposition: string | null }[], won: number) => {
    const visites = rows.length;
    const interesses = rows.filter((v) => v.disposition === 'interested').length;
    const rdv = rows.filter((v) => v.disposition === 'appointment_set').length;
    const vendus = rows.filter((v) => v.disposition === 'sold').length;
    const engages = interesses + rdv + vendus;
    return {
      visites,
      interesses,
      rdv,
      ventes: won,
      taux_engagement_pct: pctOf(engages, visites),
      taux_conversion_engages_pct: pctOf(won, engages),
    };
  };
  const cur = funnelOf(
    (vs ?? []).filter((v) => v.visited_at >= cut),
    (ds ?? []).filter((d) => d.won_at && d.won_at >= cut).length,
  );
  const prev = funnelOf(
    (vs ?? []).filter((v) => v.visited_at < cut),
    (ds ?? []).filter((d) => d.won_at && d.won_at < cut).length,
  );

  let parCommercial: unknown;
  if (isManager) {
    const curVisits = (vs ?? []).filter((v) => v.visited_at >= cut);
    const ids = [...new Set(curVisits.map((v) => v.rep_id))];
    const names = await repNames(db, ids);
    parCommercial = ids
      .map((id) => {
        const mine = curVisits.filter((v) => v.rep_id === id);
        const ventes = (ds ?? []).filter(
          (d) => d.assigned_rep_id === id && d.won_at && d.won_at >= cut,
        ).length;
        return { commercial: names.get(id) ?? '—', visites: mine.length, ventes };
      })
      .sort((a, b) => b.visites - a.visites);
  }

  return {
    scope: isManager ? 'équipe' : 'moi',
    periode: args.period,
    periode_courante: cur,
    periode_precedente: prev,
    ...(parCommercial ? { par_commercial: parCommercial } : {}),
  };
}

async function secteurStats(db: Db, user: AppUser, args: { period: string }) {
  const since = periodStart(args.period).toISOString();
  const [{ data: turfs, error }, { data: vs }, { data: won }, { data: created }] =
    await Promise.all([
      db.rpc('territories_geojson'),
      db
        .from('visits')
        .select('lat, lng')
        .neq('visit_type', 'installation')
        .gte('visited_at', since)
        .not('lat', 'is', null)
        .limit(10000),
      db
        .from('deals')
        .select('value_xof, contacts(lat, lng)')
        .eq('status', 'won')
        .gte('won_at', since)
        .limit(5000),
      db
        .from('contacts')
        .select('lat, lng')
        .gte('created_at', since)
        .not('lat', 'is', null)
        .limit(10000),
    ]);
  if (error) return { error: error.message };
  const terrs = ((turfs ?? []) as { name: string; geojson?: { coordinates?: number[][][] } }[])
    .filter((t) => t.geojson?.coordinates)
    .map((t) => ({ name: t.name, polys: [t.geojson!.coordinates as number[][][]] }));
  if (terrs.length === 0) return { error: 'aucun secteur actif visible' };

  const inTerr = (t: { polys: number[][][][] }, lat: number | null, lng: number | null) =>
    lat != null && lng != null && pointInAnyPolygon(lat, lng, t.polys);

  const showMoney = isManagerRole(user);
  return {
    periode: args.period,
    note: 'Un point peut compter dans plusieurs secteurs qui se chevauchent.',
    secteurs: terrs.map((t) => {
      const wonHere = ((won ?? []) as unknown as {
        value_xof: number | null;
        contacts: { lat: number | null; lng: number | null } | null;
      }[]).filter((d) => inTerr(t, d.contacts?.lat ?? null, d.contacts?.lng ?? null));
      return {
        secteur: t.name,
        visites: (vs ?? []).filter((v) => inTerr(t, v.lat, v.lng)).length,
        nouveaux_contacts: (created ?? []).filter((c) => inTerr(t, c.lat, c.lng)).length,
        ventes: wonHere.length,
        ...(showMoney
          ? { ca_fcfa: wonHere.reduce((s, d) => s + (d.value_xof ?? 0), 0) }
          : {}),
      };
    }),
  };
}

async function productStats(db: Db, user: AppUser, args: { period: string }) {
  const isManager = isManagerRole(user);
  const now = new Date();
  const since = periodStart(args.period, now);
  const prevSince =
    args.period === 'all'
      ? new Date(0)
      : new Date(since.getTime() - (now.getTime() - since.getTime()));

  let q = db
    .from('deals')
    .select('title, value_xof, won_at, product_id, products(name)')
    .eq('status', 'won')
    .gte('won_at', prevSince.toISOString())
    .limit(5000);
  if (!isManager) q = q.eq('assigned_rep_id', user.id);
  const { data, error } = await q;
  if (error) return { error: error.message };

  const cut = since.toISOString();
  type Row = {
    title: string | null;
    value_xof: number | null;
    won_at: string | null;
    products: { name: string } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const cur = rows.filter((d) => args.period === 'all' || (d.won_at && d.won_at >= cut));
  const prevCount = rows.length - cur.length;

  const byProduct = new Map<string, { ventes: number; ca: number }>();
  for (const d of cur) {
    const name = d.products?.name || d.title || 'Sans produit';
    const agg = byProduct.get(name) ?? { ventes: 0, ca: 0 };
    agg.ventes++;
    agg.ca += d.value_xof ?? 0;
    byProduct.set(name, agg);
  }
  const totalCa = cur.reduce((s, d) => s + (d.value_xof ?? 0), 0);

  return {
    scope: isManager ? 'équipe' : 'mes ventes',
    periode: args.period,
    ventes_total: cur.length,
    ...(args.period !== 'all' ? { ventes_periode_precedente: prevCount } : {}),
    ...(isManager
      ? { ca_total_fcfa: totalCa, panier_moyen_fcfa: cur.length ? Math.round(totalCa / cur.length) : 0 }
      : {}),
    par_produit: [...byProduct.entries()]
      .map(([produit, agg]) => ({
        produit,
        ventes: agg.ventes,
        ...(isManager ? { ca_fcfa: agg.ca } : {}),
      }))
      .sort((a, b) => b.ventes - a.ventes),
  };
}

async function staleDeals(db: Db, user: AppUser, args: { min_days: number }) {
  const isManager = isManagerRole(user);
  const days = Number.isFinite(args.min_days) && args.min_days > 0 ? Math.min(args.min_days, 365) : 7;
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();

  let q = db
    .from('deals')
    .select('title, updated_at, assigned_rep_id, value_xof, pipeline_stages(name), contacts(name, phone)')
    .eq('status', 'open')
    .lt('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(20);
  if (!isManager) q = q.eq('assigned_rep_id', user.id);
  const { data, error } = await q;
  if (error) return { error: error.message };

  type Row = {
    title: string | null;
    updated_at: string;
    assigned_rep_id: string | null;
    value_xof: number | null;
    pipeline_stages: { name: string } | null;
    contacts: { name: string | null; phone: string | null } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const names = isManager
    ? await repNames(db, [...new Set(rows.map((r) => r.assigned_rep_id).filter(Boolean) as string[])])
    : new Map<string, string>();

  return {
    scope: isManager ? 'équipe' : 'mes affaires',
    critere: `ouvertes, sans mise à jour depuis ${days} jours ou plus (20 plus anciennes)`,
    affaires: rows.map((r) => ({
      affaire: r.title || 'Sans titre',
      client: r.contacts?.name ?? '—',
      telephone: r.contacts?.phone,
      etape: r.pipeline_stages?.name ?? '—',
      jours_sans_activite: Math.floor((Date.now() - new Date(r.updated_at).getTime()) / 86400_000),
      ...(isManager && r.assigned_rep_id
        ? { commercial: names.get(r.assigned_rep_id) ?? '—' }
        : {}),
    })),
  };
}

async function neglectedContacts(db: Db, user: AppUser, args: { min_days: number }) {
  const isManager = isManagerRole(user);
  const days = Number.isFinite(args.min_days) && args.min_days > 0 ? Math.min(args.min_days, 365) : 30;
  const cutoff = Date.now() - days * 86400_000;

  let cq = db
    .from('contacts')
    .select('id, name, phone, lifecycle, updated_at')
    .in('lifecycle', ['lead', 'customer'])
    .limit(500);
  if (!isManager) cq = cq.eq('assigned_rep_id', user.id);
  const { data: contacts, error } = await cq;
  if (error) return { error: error.message };
  const ids = (contacts ?? []).map((c) => c.id);
  if (ids.length === 0) return { clients_delaisses: [], prospects_delaisses: [] };

  const { data: vs } = await db
    .from('visits')
    .select('contact_id, visited_at')
    .in('contact_id', ids)
    .limit(10000);
  const lastVisit = new Map<string, string>();
  for (const v of (vs ?? []) as { contact_id: string | null; visited_at: string }[]) {
    if (!v.contact_id) continue;
    const prev = lastVisit.get(v.contact_id);
    if (!prev || v.visited_at > prev) lastVisit.set(v.contact_id, v.visited_at);
  }

  const stale = (lifecycle: string) =>
    (contacts ?? [])
      .filter((c) => c.lifecycle === lifecycle)
      .map((c) => {
        const last = lastVisit.get(c.id) ?? null;
        const ref = last ? new Date(last).getTime() : new Date(c.updated_at).getTime();
        return { c, last, jours: Math.floor((Date.now() - ref) / 86400_000) };
      })
      .filter((x) => (x.last ? new Date(x.last).getTime() : 0) < cutoff && x.jours >= days)
      .sort((a, b) => b.jours - a.jours)
      .slice(0, 15)
      .map((x) => ({
        nom: x.c.name ?? '(sans nom)',
        telephone: x.c.phone,
        derniere_visite: x.last,
        jours_sans_visite: x.jours,
      }));

  return {
    scope: isManager ? 'équipe' : 'mes contacts',
    critere: `sans visite depuis ${days} jours ou plus`,
    clients_delaisses: stale('customer'),
    prospects_delaisses: stale('lead'),
  };
}

async function installCycleStats(db: Db, user: AppUser, args: { period: string }) {
  const since = periodStart(args.period).toISOString();
  let q = db
    .from('installations')
    .select('installer_id, status, created_at, completed_at')
    .limit(5000);
  if (user.role === 'technician') q = q.eq('installer_id', user.id);
  const { data, error } = await q;
  if (error) return { error: error.message };
  const rows = (data ?? []) as {
    installer_id: string | null;
    status: string;
    created_at: string;
    completed_at: string | null;
  }[];

  const done = rows.filter(
    (r) => r.status === 'done' && r.completed_at && r.completed_at >= since,
  );
  const cycleDays = (r: { created_at: string; completed_at: string | null }) =>
    (new Date(r.completed_at as string).getTime() - new Date(r.created_at).getTime()) / 86400_000;
  const avg = done.length
    ? Math.round((done.reduce((s, r) => s + cycleDays(r), 0) / done.length) * 10) / 10
    : null;

  const backlog: Record<string, number> = {};
  for (const r of rows.filter((r) => r.status !== 'done'))
    backlog[r.status] = (backlog[r.status] ?? 0) + 1;

  const techIds = [...new Set(done.map((r) => r.installer_id).filter(Boolean) as string[])];
  const names = await repNames(db, techIds);
  const parTechnicien = techIds
    .map((id) => {
      const mine = done.filter((r) => r.installer_id === id);
      return {
        technicien: names.get(id) ?? '—',
        terminees: mine.length,
        delai_moyen_jours:
          Math.round((mine.reduce((s, r) => s + cycleDays(r), 0) / mine.length) * 10) / 10,
      };
    })
    .sort((a, b) => b.terminees - a.terminees);

  return {
    scope: user.role === 'technician' ? 'mes chantiers' : 'toute l’équipe',
    periode: args.period,
    terminees: done.length,
    delai_moyen_vente_vers_termine_jours: avg,
    backlog_ouvert: backlog,
    taux_revisite_pct: pctOf(
      rows.filter((r) => r.status === 'needs_revisit').length,
      done.length + rows.filter((r) => r.status === 'needs_revisit').length,
    ),
    par_technicien: parTechnicien,
  };
}

async function rdvOverview(db: Db, user: AppUser) {
  const isManager = isManagerRole(user);
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const in7d = new Date(Date.now() + 7 * 86400_000);
  const past30 = new Date(Date.now() - 30 * 86400_000);

  let q = db
    .from('visits')
    .select('rep_id, appointment_date, contacts(name, phone)')
    .not('appointment_date', 'is', null)
    .gte('appointment_date', past30.toISOString())
    .lte('appointment_date', in7d.toISOString())
    .order('appointment_date', { ascending: true })
    .limit(100);
  if (!isManager) q = q.eq('rep_id', user.id);
  const { data, error } = await q;
  if (error) return { error: error.message };

  type Row = {
    rep_id: string;
    appointment_date: string;
    contacts: { name: string | null; phone: string | null } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const names = isManager
    ? await repNames(db, [...new Set(rows.map((r) => r.rep_id))])
    : new Map<string, string>();
  const shape = (r: Row) => ({
    date: r.appointment_date,
    client: r.contacts?.name ?? '—',
    telephone: r.contacts?.phone,
    ...(isManager ? { commercial: names.get(r.rep_id) ?? '—' } : {}),
  });

  return {
    scope: isManager ? 'équipe' : 'mes RDV',
    rdv_en_retard: rows.filter((r) => new Date(r.appointment_date) < startToday).map(shape),
    rdv_a_venir_7j: rows.filter((r) => new Date(r.appointment_date) >= startToday).map(shape),
  };
}

async function lostAnalysis(db: Db, user: AppUser, args: { period: string }) {
  const isManager = isManagerRole(user);
  const since = periodStart(args.period).toISOString();
  let q = db
    .from('deals')
    .select('lost_reason, assigned_rep_id, updated_at')
    .eq('status', 'lost')
    .gte('updated_at', since)
    .limit(5000);
  if (!isManager) q = q.eq('assigned_rep_id', user.id);
  const { data, error } = await q;
  if (error) return { error: error.message };
  const rows = (data ?? []) as { lost_reason: string | null; assigned_rep_id: string | null }[];

  const byReason: Record<string, number> = {};
  for (const r of rows) {
    const reason = r.lost_reason?.trim() || 'non précisé';
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }

  let parCommercial: unknown;
  if (isManager) {
    const ids = [...new Set(rows.map((r) => r.assigned_rep_id).filter(Boolean) as string[])];
    const names = await repNames(db, ids);
    parCommercial = ids
      .map((id) => ({
        commercial: names.get(id) ?? '—',
        perdues: rows.filter((r) => r.assigned_rep_id === id).length,
      }))
      .sort((a, b) => b.perdues - a.perdues);
  }

  return {
    scope: isManager ? 'équipe' : 'mes affaires',
    periode: args.period,
    perdues_total: rows.length,
    par_raison: byReason,
    ...(parCommercial ? { par_commercial: parCommercial } : {}),
  };
}

async function leaderboardStandings(user: AppUser) {
  // The board is public in-app; use the admin client so a rep gets real
  // names (their own RLS can't read colleagues' user rows).
  const admin = createAdminClient();
  const pts = await getPointConfig(admin);
  const { reps, techs } = await computeBoards(admin, startOfWeekIso(), pts);
  return {
    semaine: 'en cours (depuis lundi)',
    commerciaux: reps.slice(0, 5).map((r, i) => ({
      rang: i + 1,
      nom: r.name,
      points: r.points,
      ventes: r.sales,
      c_est_moi: r.id === user.id || undefined,
    })),
    techniciens: techs.slice(0, 5).map((r, i) => ({
      rang: i + 1,
      nom: r.name,
      points: r.points,
      terminees: r.done,
      c_est_moi: r.id === user.id || undefined,
    })),
  };
}

async function monthlyStats(db: Db, user: AppUser, args: { months: number }) {
  const isManager = isManagerRole(user);
  const months = Number.isFinite(args.months) && args.months > 0 ? Math.min(args.months, 12) : 6;
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  start.setMonth(start.getMonth() - (months - 1));
  const sinceIso = start.toISOString();

  let vq = db
    .from('visits')
    .select('rep_id, disposition, visited_at')
    .neq('visit_type', 'installation')
    .gte('visited_at', sinceIso)
    .limit(10000);
  if (!isManager) vq = vq.eq('rep_id', user.id);
  let dq = db
    .from('deals')
    .select('assigned_rep_id, won_at, value_xof')
    .eq('status', 'won')
    .gte('won_at', sinceIso)
    .limit(5000);
  if (!isManager) dq = dq.eq('assigned_rep_id', user.id);
  let cq = db.from('contacts').select('created_by, created_at').gte('created_at', sinceIso).limit(10000);
  if (!isManager) cq = cq.eq('created_by', user.id);
  let iq = db
    .from('installations')
    .select('installer_id, completed_at')
    .eq('status', 'done')
    .gte('completed_at', sinceIso)
    .limit(5000);
  if (user.role === 'technician') iq = iq.eq('installer_id', user.id);

  const [{ data: vs, error }, { data: ds }, { data: cs }, { data: is }] = await Promise.all([
    vq,
    dq,
    cq,
    iq,
  ]);
  if (error) return { error: error.message };

  // One bucket per calendar month, oldest → newest, empty months included.
  const buckets = new Map<
    string,
    { visites: number; engages: number; ventes: number; ca: number; nouveaux_contacts: number; installations_terminees: number }
  >();
  for (let i = 0; i < months; i++) {
    const d = new Date(start);
    d.setMonth(start.getMonth() + i);
    buckets.set(d.toISOString().slice(0, 7), {
      visites: 0,
      engages: 0,
      ventes: 0,
      ca: 0,
      nouveaux_contacts: 0,
      installations_terminees: 0,
    });
  }
  const bucketOf = (iso: string | null) => (iso ? buckets.get(iso.slice(0, 7)) : undefined);

  for (const v of vs ?? []) {
    const b = bucketOf(v.visited_at);
    if (!b) continue;
    b.visites++;
    if (['interested', 'appointment_set', 'sold'].includes(v.disposition ?? '')) b.engages++;
  }
  for (const d of ds ?? []) {
    const b = bucketOf(d.won_at);
    if (!b) continue;
    b.ventes++;
    b.ca += d.value_xof ?? 0;
  }
  for (const c of cs ?? []) {
    const b = bucketOf(c.created_at);
    if (b) b.nouveaux_contacts++;
  }
  for (const j of is ?? []) {
    const b = bucketOf(j.completed_at);
    if (b) b.installations_terminees++;
  }

  return {
    scope: isManager ? 'équipe' : 'moi',
    note: 'Mois calendaires ; le mois en cours est partiel.',
    mois: [...buckets.entries()].map(([mois, b]) => ({
      mois,
      visites: b.visites,
      engages: b.engages,
      taux_engagement_pct: pctOf(b.engages, b.visites),
      ventes: b.ventes,
      ...(isManager ? { ca_fcfa: b.ca } : {}),
      nouveaux_contacts: b.nouveaux_contacts,
      installations_terminees: b.installations_terminees,
    })),
  };
}

async function dailyTrend(db: Db, user: AppUser) {
  const isManager = isManagerRole(user);
  const since = new Date();
  since.setDate(since.getDate() - 30);
  since.setHours(0, 0, 0, 0);

  let vq = db
    .from('visits')
    .select('visited_at, rep_id')
    .neq('visit_type', 'installation')
    .gte('visited_at', since.toISOString())
    .limit(10000);
  if (!isManager) vq = vq.eq('rep_id', user.id);
  let dq = db
    .from('deals')
    .select('won_at, assigned_rep_id')
    .eq('status', 'won')
    .gte('won_at', since.toISOString())
    .limit(5000);
  if (!isManager) dq = dq.eq('assigned_rep_id', user.id);
  const [{ data: vs, error }, { data: ds }] = await Promise.all([vq, dq]);
  if (error) return { error: error.message };

  const byDay = new Map<string, { visites: number; ventes: number }>();
  for (const v of vs ?? []) {
    const day = v.visited_at.slice(0, 10);
    const agg = byDay.get(day) ?? { visites: 0, ventes: 0 };
    agg.visites++;
    byDay.set(day, agg);
  }
  for (const d of ds ?? []) {
    if (!d.won_at) continue;
    const day = d.won_at.slice(0, 10);
    const agg = byDay.get(day) ?? { visites: 0, ventes: 0 };
    agg.ventes++;
    byDay.set(day, agg);
  }
  return {
    scope: isManager ? 'équipe' : 'moi',
    jours: [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, agg]) => ({ date, ...agg })),
  };
}

async function commissionStats(db: Db, user: AppUser, args: { period: string }) {
  const isManager = isManagerRole(user);
  const now = new Date();
  const since = periodStart(args.period, now);
  const prevSince = new Date(since.getTime() - (now.getTime() - since.getTime()));

  let q = db
    .from('commission_entries')
    .select('rep_id, kind, amount_xof, status, period_month, earned_at, paid_at')
    .limit(5000);
  if (!isManager) q = q.eq('rep_id', user.id);
  const { data, error } = await q;
  if (error) return { error: error.message };

  type Row = {
    rep_id: string;
    kind: string | null;
    amount_xof: number;
    status: string;
    period_month: string;
    earned_at: string | null;
    paid_at: string | null;
  };
  const rows = (data ?? []) as Row[];
  const inWin = (iso: string | null, from: Date, to: Date) =>
    !!iso && iso >= from.toISOString() && iso < to.toISOString();

  const summarize = (from: Date, to: Date) => {
    // Earned/paid are dated by when they were EARNED; pending/expired by the
    // month slice they belong to.
    const earnedRows = rows.filter(
      (r) => (r.status === 'earned' || r.status === 'paid') && inWin(r.earned_at, from, to),
    );
    const paidRows = rows.filter((r) => r.status === 'paid' && inWin(r.paid_at, from, to));
    const sum = (rs: Row[]) => rs.reduce((s, r) => s + r.amount_xof, 0);
    return {
      acquises: { nombre: earnedRows.length, fcfa: sum(earnedRows) },
      dont_ventes_fcfa: sum(earnedRows.filter((r) => r.kind !== 'install')),
      dont_installations_fcfa: sum(earnedRows.filter((r) => r.kind === 'install')),
      payees: { nombre: paidRows.length, fcfa: sum(paidRows) },
    };
  };

  const cur = summarize(since, now);
  const prev = summarize(prevSince, since);
  const pendingUpcoming = rows.filter((r) => r.status === 'pending');
  const expired = rows.filter((r) => r.status === 'expired');
  const toPayNow = rows.filter((r) => r.status === 'earned');

  const result: Record<string, unknown> = {
    periode: args.period,
    scope: isManager ? 'équipe' : 'moi',
    periode_actuelle: cur,
    periode_precedente_equivalente: prev,
    variation_acquises_fcfa: cur.acquises.fcfa - prev.acquises.fcfa,
    a_payer_maintenant_fcfa: toPayNow.reduce((s, r) => s + r.amount_xof, 0),
    mensualites_a_venir: {
      nombre: pendingUpcoming.length,
      fcfa: pendingUpcoming.reduce((s, r) => s + r.amount_xof, 0),
      prochaine: pendingUpcoming.map((r) => r.period_month).sort()[0] ?? null,
    },
    expirees_fcfa: expired.reduce((s, r) => s + r.amount_xof, 0),
    note: "acquise = due (client actif), payée = versée ; ventes = commission commerciale, installations = commission technicien",
  };

  if (isManager) {
    const { data: users } = await db.from('users').select('id, full_name, username');
    const nameOf = new Map(
      ((users ?? []) as { id: string; full_name: string | null; username: string | null }[]).map(
        (u) => [u.id, u.full_name || u.username || '—'],
      ),
    );
    const byPerson = new Map<string, { acquises_fcfa: number; a_payer_fcfa: number }>();
    for (const r of rows) {
      const cur2 = byPerson.get(r.rep_id) ?? { acquises_fcfa: 0, a_payer_fcfa: 0 };
      if ((r.status === 'earned' || r.status === 'paid') && inWin(r.earned_at, since, now)) {
        cur2.acquises_fcfa += r.amount_xof;
      }
      if (r.status === 'earned') cur2.a_payer_fcfa += r.amount_xof;
      byPerson.set(r.rep_id, cur2);
    }
    result.par_personne = [...byPerson.entries()]
      .map(([id, v]) => ({ nom: nameOf.get(id) ?? '—', ...v }))
      .filter((p) => p.acquises_fcfa > 0 || p.a_payer_fcfa > 0)
      .sort((a, b) => b.acquises_fcfa - a.acquises_fcfa);
  }

  return result;
}

async function businessTypeStats(db: Db, user: AppUser, args: { period: string }) {
  const isManager = isManagerRole(user);
  const since = periodStart(args.period, new Date());

  let wonQ = db
    .from('deals')
    .select('value_xof, business_type, tags')
    .eq('status', 'won')
    .gte('won_at', since.toISOString())
    .limit(5000);
  let openQ = db
    .from('deals')
    .select('value_xof, business_type, tags')
    .eq('status', 'open')
    .limit(5000);
  if (!isManager) {
    wonQ = wonQ.eq('assigned_rep_id', user.id);
    openQ = openQ.eq('assigned_rep_id', user.id);
  }
  const [{ data: won, error: e1 }, { data: open, error: e2 }] = await Promise.all([wonQ, openQ]);
  if (e1) return { error: e1.message };
  if (e2) return { error: e2.message };

  type Row = { value_xof: number | null; business_type: string | null; tags: string[] | null };
  const agg = (rows: Row[]) => {
    const byType = new Map<string, { affaires: number; ca: number }>();
    let sansType = 0;
    for (const d of rows) {
      const t = d.business_type?.trim();
      if (!t) {
        sansType++;
        continue;
      }
      const a = byType.get(t) ?? { affaires: 0, ca: 0 };
      a.affaires++;
      a.ca += d.value_xof ?? 0;
      byType.set(t, a);
    }
    const list = [...byType.entries()]
      .map(([type, v]) => ({
        type,
        affaires: v.affaires,
        ...(isManager ? { ca_fcfa: v.ca } : {}),
      }))
      .sort((a, b) => b.affaires - a.affaires);
    return { list, sansType };
  };
  const w = agg((won ?? []) as Row[]);
  const o = agg((open ?? []) as Row[]);

  const tagCount = new Map<string, number>();
  for (const d of [...(won ?? []), ...(open ?? [])] as Row[]) {
    for (const tg of d.tags ?? []) tagCount.set(tg, (tagCount.get(tg) ?? 0) + 1);
  }

  return {
    periode: args.period,
    scope: isManager ? 'équipe' : 'moi',
    ventes_par_type: w.list,
    ventes_sans_type: w.sansType,
    pipeline_ouvert_par_type: o.list,
    pipeline_sans_type: o.sansType,
    tags_frequents: [...tagCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([tag, affaires]) => ({ tag, affaires })),
    note: "types issus du champ « Type d'activité » des affaires ; les affaires sans type sont comptées à part",
  };
}

/** Dispatch a tool call. Unknown tool names return an error object. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  db: Db,
  user: AppUser,
): Promise<unknown> {
  try {
    switch (name) {
      case 'search_contacts':
        return await searchContacts(db, args as { query: string });
      case 'pipeline_stats':
        return await pipelineStats(db, user, args as { period: string });
      case 'visit_stats':
        return await visitStats(db, user, args as { period: string });
      case 'my_todo':
        return await myTodo(db, user);
      case 'contact_history':
        return await contactHistory(db, args as { contact_id: string });
      case 'installations_list':
        return await installationsList(db, user, args as { status: string });
      case 'products_list':
        return await productsList(db);
      case 'territories_list':
        return await territoriesList(db);
      case 'photos_summary':
        return await photosSummary(db, user, args as { period: string });
      case 'funnel_stats':
        return await funnelStats(db, user, args as { period: string });
      case 'secteur_stats':
        return await secteurStats(db, user, args as { period: string });
      case 'product_stats':
        return await productStats(db, user, args as { period: string });
      case 'business_type_stats':
        return await businessTypeStats(db, user, args as { period: string });
      case 'commission_stats':
        return await commissionStats(db, user, args as { period: string });
      case 'stale_deals':
        return await staleDeals(db, user, args as { min_days: number });
      case 'neglected_contacts':
        return await neglectedContacts(db, user, args as { min_days: number });
      case 'install_cycle_stats':
        return await installCycleStats(db, user, args as { period: string });
      case 'rdv_overview':
        return await rdvOverview(db, user);
      case 'lost_analysis':
        return await lostAnalysis(db, user, args as { period: string });
      case 'leaderboard_standings':
        return await leaderboardStandings(user);
      case 'monthly_stats':
        return await monthlyStats(db, user, args as { months: number });
      case 'daily_trend':
        return await dailyTrend(db, user);
      case 'flagged_visits_summary':
        return await flaggedVisitsSummary(db, user);
      case 'team_list':
        return await teamList(db, user);
      default:
        return { error: `outil inconnu: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'erreur outil' };
  }
}
