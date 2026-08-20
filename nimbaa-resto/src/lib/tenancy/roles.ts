export const ROLES = ['owner', 'manager', 'waiter', 'kitchen', 'cashier'] as const;
export type Role = (typeof ROLES)[number];

/** What each role is called in French. The database keys are never shown. */
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'patron',
  manager: 'gérant',
  waiter: 'serveur',
  kitchen: 'cuisine',
  cashier: 'caisse',
};

/** Where each role works. Owner and manager share the back office. */
const SURFACES: Record<Role, { segment: string; label: string; hint: string }> = {
  waiter: { segment: 'service', label: 'Salle', hint: 'Prendre les commandes, servir' },
  kitchen: { segment: 'station', label: 'Cuisine', hint: 'Les tickets à préparer' },
  cashier: { segment: 'caisse', label: 'Caisse', hint: 'Encaisser et fermer les tables' },
  manager: { segment: 'admin', label: 'Administration', hint: 'Carte, tables, personnel' },
  owner: { segment: 'admin', label: 'Administration', hint: 'Carte, tables, personnel' },
};

/**
 * The surfaces a set of roles unlocks, deduplicated — an owner who is also a
 * waiter gets two entries, not three.
 */
export function surfacesFor(roles: Role[]) {
  const seen = new Set<string>();
  return roles
    .map((r) => SURFACES[r])
    .filter((s) => s && !seen.has(s.segment) && seen.add(s.segment));
}

/** Only an owner may create a manager or another owner — mirrors the rm_grant policy. */
export function grantableRoles(roles: Role[]): Role[] {
  if (roles.includes('owner')) return [...ROLES];
  if (roles.includes('manager')) return ['waiter', 'kitchen', 'cashier'];
  return [];
}
