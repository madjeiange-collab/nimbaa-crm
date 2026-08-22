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
 * The surface a role unlocks. `core.product_access` is keyed on
 * (org, user, product), so a person holds exactly one role per product.
 */
export function surfaceFor(role: Role) {
  return SURFACES[role];
}

/** Only an owner may create a manager or another owner. */
export function grantableRoles(role: Role): Role[] {
  if (role === 'owner') return [...ROLES];
  if (role === 'manager') return ['waiter', 'kitchen', 'cashier'];
  return [];
}
