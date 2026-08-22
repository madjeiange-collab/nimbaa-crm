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
  let a = 0;
  for (let i = 0; i < name.length; i++) a = (a * 31 + name.charCodeAt(i)) >>> 0;

  // Keep clear of the service green (155°). A tile that colour reads as a
  // status rather than as a dish, and status is the one thing colour must mean
  // unambiguously here.
  //
  // Folding the band onto its own edges was worse than not excluding it at all:
  // every name inside the band landed on one of the two boundary hues, so the
  // two commonest tile colours became the two nearest the accent — "Plats" came
  // out green. Remapping into the surviving arc keeps the spread even.
  const BAND = { from: 100, to: 200 };
  const width = BAND.to - BAND.from + 1;
  let h = a % (360 - width);
  if (h >= BAND.from) h += width;

  // Hue alone collides: 259 usable degrees over a hash means two dishes side by
  // side can come out the same colour, which is exactly where the colour was
  // supposed to help. Tone varies with the same hash, so a collision in hue is
  // still two different tiles.
  const s = 28 + ((a >>> 9) % 3) * 9;
  const l = 38 + ((a >>> 17) % 3) * 6;

  return { bg: `hsl(${h} ${s}% ${l}%)`, fg: 'hsl(0 0% 100%)' };
}

/** The two letters shown on the tile. Skips articles so "Le Poulet" gives PO. */
export function tileInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => !/^(le|la|les|un|une|des|du|de|l'|d')$/i.test(w));
  const base = (words[0] ?? name).replace(/[^\p{L}\p{N}]/gu, '');
  return base.slice(0, 2).toUpperCase();
}
