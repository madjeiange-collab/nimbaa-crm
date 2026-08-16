import type OpenAI from 'openai';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppUser } from '@/lib/auth/session';

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
        .select('title, status, value_xof, won_at, pipeline_stages(name)')
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
