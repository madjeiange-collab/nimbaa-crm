/**
 * User avatar: the photo when one is set, otherwise initials on a colour
 * derived from the name (stable per person). Pure component — renders on
 * server and client alike.
 */

const PALETTE = [
  'hsl(96 58% 33%)', // brand green
  'hsl(27 87% 45%)', // terracotta
  'hsl(217 71% 45%)', // blue
  'hsl(291 47% 42%)', // purple
  'hsl(174 62% 30%)', // teal
  'hsl(340 65% 45%)', // raspberry
];

function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase();
}

function colorFor(name: string | null | undefined): string {
  const s = name ?? '?';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function Avatar({
  url,
  name,
  size = 32,
}: {
  url: string | null;
  name: string | null;
  size?: number;
}) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name ?? ''}
        width={size}
        height={size}
        className="shrink-0 rounded-full border border-white/60 object-cover shadow-sm"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: colorFor(name), fontSize: size * 0.42 }}
    >
      {initials(name)}
    </span>
  );
}
