/**
 * A dish with no photo — or whose photo has not arrived yet — still has to be a
 * distinguishable target. It gets a stable colour derived from its own name and
 * its first two letters, so the same dish is the same tile every service and
 * becomes recognisable in itself.
 *
 * Without this, an image-first interface on a bad connection degrades to a grid
 * of identical grey squares, which is worse than the text it replaced.
 */
export function tileColour(name: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;

  // Skip the band around the service green (~157°). A tile that colour reads as
  // a status rather than as a dish, and status is the one thing colour must
  // mean unambiguously in this interface. Folding the band onto its edges keeps
  // the mapping stable — the same dish is always the same colour.
  const FORBIDDEN = { from: 128, to: 186 };
  if (h >= FORBIDDEN.from && h <= FORBIDDEN.to) {
    h = h < (FORBIDDEN.from + FORBIDDEN.to) / 2 ? FORBIDDEN.from - 1 : FORBIDDEN.to + 1;
  }

  // Mid lightness, modest saturation: readable under both themes.
  return { bg: `hsl(${h} 34% 46%)`, fg: 'hsl(0 0% 100%)' };
}

/** The two letters shown on the tile. Skips articles so "Le Poulet" gives PO. */
export function tileInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => !/^(le|la|les|un|une|des|du|de|l'|d')$/i.test(w));
  const base = (words[0] ?? name).replace(/[^\p{L}\p{N}]/gu, '');
  return base.slice(0, 2).toUpperCase();
}
