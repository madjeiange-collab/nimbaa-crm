/**
 * One affaire's life, as a single ordered fil.
 *
 * Trials already keep their own periods (0032) and record changes live in
 * deal_events (0034). Telling the two stories in two places would make the
 * reader join them by eye, so they are folded together here — the panel just
 * renders what comes out.
 */
import type { DealEvent, DealEventKind } from '@/lib/deals/events';
import type { TrialRow } from '@/lib/deals/trial';

export type JournalKind = DealEventKind | 'trial_opened' | 'trial_extended' | 'trial_ended';

export interface JournalLine {
  key: string;
  at: string;
  kind: JournalKind;
  from: string | null;
  to: string | null;
  actorId: string | null;
  /** Days the affaire spent in the stage it just left. Stage lines only. */
  satDays?: number;
  note?: string | null;
}

const days = (a: string, b: string) =>
  Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 864e5));

/**
 * Build the fil, newest first, with each stage move carrying how long the
 * affaire sat in the stage it left.
 *
 * That figure is the whole point of keeping the log: an étape has no duration
 * anywhere else in the system, so "where do affaires get stuck" has never been
 * answerable. It is computed from the previous stage line — or, for the first
 * move, from the creation.
 */
export function buildJournal(events: DealEvent[], trials: TrialRow[]): JournalLine[] {
  const lines: JournalLine[] = events.map((e) => ({
    key: e.id,
    at: e.at,
    kind: e.kind as JournalKind,
    from: e.from_label,
    to: e.to_label,
    actorId: e.actor_id,
  }));

  for (const t of trials) {
    lines.push({
      key: `t${t.id}-open`,
      // Dates, not timestamps: a period is a calendar thing. Midday keeps it
      // from drifting either side of a day boundary.
      at: `${t.started_on}T12:00:00.000Z`,
      kind: 'trial_opened',
      from: null,
      to: t.ends_on,
      actorId: null,
    });
    for (const [i, x] of (t.extensions ?? []).entries()) {
      lines.push({
        key: `t${t.id}-x${i}`,
        at: `${x.at}T12:00:00.000Z`,
        kind: 'trial_extended',
        from: null,
        to: x.to,
        actorId: x.by,
        note: x.note,
      });
    }
    if (t.ended_on && t.outcome) {
      lines.push({
        key: `t${t.id}-end`,
        at: `${t.ended_on}T12:00:00.000Z`,
        kind: 'trial_ended',
        from: null,
        to: t.outcome,
        actorId: null,
      });
    }
  }

  lines.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  // Oldest first for the maths: a stage line's dwell time is the gap back to
  // whatever put the affaire in that stage.
  const asc = [...lines].reverse();
  let since: string | null = null;
  for (const l of asc) {
    if (l.kind === 'created') since = l.at;
    else if (l.kind === 'stage') {
      if (since) l.satDays = days(since, l.at);
      since = l.at;
    }
  }
  return lines;
}

/** Time spent in each stage, oldest first — what the bars read from. */
export function stageDwell(
  lines: JournalLine[],
  currentStage: string | null,
  now: string = new Date().toISOString(),
): { stage: string; days: number; current: boolean }[] {
  const asc = [...lines].reverse().filter((l) => l.kind === 'stage' || l.kind === 'created');
  const out: { stage: string; days: number; current: boolean }[] = [];
  let openStage: string | null = null;
  let openAt: string | null = null;

  for (const l of asc) {
    if (l.kind === 'created') {
      openAt = l.at;
      continue;
    }
    if (openStage && openAt) out.push({ stage: openStage, days: days(openAt, l.at), current: false });
    else if (l.from && openAt) out.push({ stage: l.from, days: days(openAt, l.at), current: false });
    openStage = l.to;
    openAt = l.at;
  }
  if (openStage && openAt) out.push({ stage: openStage, days: days(openAt, now), current: true });
  else if (currentStage && openAt) out.push({ stage: currentStage, days: days(openAt, now), current: true });

  // A stage entered twice is one bar: "12 days in Négociation" is the question,
  // not "7 days then 5 days".
  const merged = new Map<string, { stage: string; days: number; current: boolean }>();
  for (const r of out) {
    const cur = merged.get(r.stage);
    if (cur) merged.set(r.stage, { ...cur, days: cur.days + r.days, current: cur.current || r.current });
    else merged.set(r.stage, r);
  }
  return [...merged.values()];
}
