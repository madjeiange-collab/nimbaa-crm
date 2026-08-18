import type { JournalRow } from '@/lib/checkin/journal';

/**
 * The working day as columns. Field work here starts before seven and rarely
 * runs past eight; anything outside still counts in the row totals, it simply
 * has no column of its own.
 */
export const FIRST_HOUR = 6;
export const LAST_HOUR = 19;

/** Outcomes that mean the customer engaged rather than merely opened the door. */
const ENGAGED = new Set(['interested', 'appointment_set', 'sold']);

export interface HourCell {
  hour: number;
  /** Passages that ENDED in this hour — one passage lands in one cell. */
  count: number;
  /** Minutes on site, credited to the hour the passage ended in. */
  minutes: number;
  /** Sold (commercial) or finished (technical). */
  won: number;
  /** Engaged but not sold, or a chantier left needing a return. */
  warm: number;
  /** A person was there and said no — not the same as an empty doorway. */
  refused: number;
}

export interface HourlyRow {
  personId: string;
  personName: string;
  kind: 'visit' | 'install';
  cells: HourCell[];
  total: number;
  minutes: number;
  won: number;
  warm: number;
  refused: number;
  /** Minutes per passage. Descriptive, and meaningless below a few passages. */
  avgMin: number | null;
  /** Engaged ÷ passages — the leaderboard's engagementPct. */
  engagementPct: number | null;
  /** Sold ÷ engaged — the leaderboard's conversionPct, NOT sold ÷ passages. */
  conversionPct: number | null;
  /** Last passage received, so a manager can tell working from silent. */
  lastAt: string | null;
  lastContact: string | null;
}

const HOURS = LAST_HOUR - FIRST_HOUR + 1;

/**
 * Which Abidjan hour a timestamp falls in.
 *
 * Not fr-FR: it formats an hour-only value as "08 h", and Number("08 h") is
 * NaN — which indexed every cell to undefined and left the whole grid empty
 * while the row totals stayed correct. en-GB gives a bare "08"; the digit
 * match makes it locale-proof anyway.
 */
export const abidjanHour = (iso: string): number => {
  const s = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hour12: false,
    timeZone: 'Africa/Abidjan',
  }).format(new Date(iso));
  const m = s.match(/\d{1,2}/);
  return m ? Number(m[0]) : -1;
};

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/**
 * Fold passages into a person × hour grid.
 *
 * A passage is credited to the hour it ENDED in, not the one it started in.
 * Splitting a 90-minute negotiation across two columns would make both look
 * like half-visits, and the count would stop being a count.
 *
 * Rows are split by trade because the units are not comparable: four passages
 * in an hour is a good hour for a commercial and a sign of trouble for a
 * technician, who is meant to stay on one site.
 */
export function buildHourly(rows: JournalRow[]): {
  commercial: HourlyRow[];
  technical: HourlyRow[];
} {
  const byPerson = new Map<string, HourlyRow>();

  for (const r of rows) {
    const key = `${r.personId}:${r.kind}`;
    let row = byPerson.get(key);
    if (!row) {
      row = {
        personId: r.personId,
        personName: r.personName,
        kind: r.kind,
        cells: Array.from({ length: HOURS }, (_, i) => ({
          hour: FIRST_HOUR + i,
          count: 0,
          minutes: 0,
          won: 0,
          warm: 0,
          refused: 0,
        })),
        total: 0,
        minutes: 0,
        won: 0,
        warm: 0,
        refused: 0,
        avgMin: null,
        engagementPct: null,
        conversionPct: null,
        lastAt: null,
        lastContact: null,
      };
      byPerson.set(key, row);
    }

    const h = abidjanHour(r.outAt);
    const cell = row.cells[h - FIRST_HOUR];
    const mins = r.durationMin ?? 0;

    row.total++;
    row.minutes += mins;
    if (cell) {
      cell.count++;
      cell.minutes += mins;
    }

    // The three words mean different things per trade, deliberately: the group
    // header says which, and one number spanning both would be a lie.
    const d = r.disposition ?? '';
    const isWon = r.kind === 'install' ? d === 'done' : d === 'sold';
    const isWarm =
      r.kind === 'install' ? d === 'needs_revisit' : ENGAGED.has(d) && d !== 'sold';
    const isRefused = r.kind === 'visit' && d === 'refused';

    if (isWon) {
      row.won++;
      if (cell) cell.won++;
    } else if (isWarm) {
      row.warm++;
      if (cell) cell.warm++;
    } else if (isRefused) {
      row.refused++;
      if (cell) cell.refused++;
    }

    if (!row.lastAt || r.outAt > row.lastAt) {
      row.lastAt = r.outAt;
      row.lastContact = r.contactName;
    }
  }

  for (const row of byPerson.values()) {
    row.avgMin = row.total > 0 ? Math.round(row.minutes / row.total) : null;
    const engaged = row.won + row.warm;
    row.engagementPct = pct(engaged, row.total);
    // Sold over ENGAGED, matching the leaderboard: a rep who opens two doors
    // out of ten and closes one converts at 50 %, not 10 %.
    row.conversionPct = engaged > 0 ? pct(row.won, engaged) : null;
  }

  const all = [...byPerson.values()].sort((a, b) => b.total - a.total);
  return {
    commercial: all.filter((r) => r.kind === 'visit'),
    technical: all.filter((r) => r.kind === 'install'),
  };
}

/** One footer line per trade — never a figure spanning commercials and technicians. */
export function totalsOf(rows: HourlyRow[]) {
  const cells = Array.from({ length: HOURS }, (_, i) =>
    rows.reduce((n, r) => n + (r.cells[i]?.count ?? 0), 0),
  );
  const total = rows.reduce((n, r) => n + r.total, 0);
  const minutes = rows.reduce((n, r) => n + r.minutes, 0);
  const won = rows.reduce((n, r) => n + r.won, 0);
  const warm = rows.reduce((n, r) => n + r.warm, 0);
  const refused = rows.reduce((n, r) => n + r.refused, 0);
  const engaged = won + warm;
  return {
    cells,
    total,
    minutes,
    won,
    warm,
    refused,
    avgMin: total > 0 ? Math.round(minutes / total) : null,
    engagementPct: pct(engaged, total),
    conversionPct: engaged > 0 ? pct(won, engaged) : null,
  };
}

/** Minutes since the last passage was received — null when nothing today. */
export function silentFor(row: HourlyRow, nowMs: number): number | null {
  if (!row.lastAt) return null;
  return Math.round((nowMs - new Date(row.lastAt).getTime()) / 60_000);
}

/** "3 h 10" — hours are easier to judge than 190 minutes. */
export function hm(min: number | null): string {
  if (min == null || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
