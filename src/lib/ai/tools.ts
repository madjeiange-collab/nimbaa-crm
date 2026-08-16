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
  const [{ data: contact }, { data: visits }, { data: activities }, { data: deals }] =
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
    ]);
  if (!contact) return { error: 'contact introuvable' };
  return { contact, affaires: deals ?? [], visites: visits ?? [], activites: activities ?? [] };
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
      case 'my_todo':
        return await myTodo(db, user);
      case 'contact_history':
        return await contactHistory(db, args as { contact_id: string });
      default:
        return { error: `outil inconnu: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'erreur outil' };
  }
}
