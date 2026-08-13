/** Activity bars (inline SVG, theme-aware). `showLabels` off for dense ranges. */
export function BarDays({
  data,
  showLabels = true,
}: {
  data: { label: string; value: number }[];
  showLabels?: boolean;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const W = 320;
  const H = 90;
  const pad = 12;
  const slot = (W - pad * 2) / data.length;
  const barW = Math.max(2, slot - (data.length > 12 ? 2 : 6));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label="7 jours">
      {data.map((d, i) => {
        const x = pad + i * slot;
        const h = (d.value / max) * (H - 28);
        const y = H - 18 - h;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(h, d.value > 0 ? 2 : 0)}
              rx={2}
              fill="hsl(var(--primary))"
            />
            {showLabels && (
              <text
                x={x + barW / 2}
                y={H - 6}
                textAnchor="middle"
                fontSize="8"
                fill="hsl(var(--muted-foreground))"
              >
                {d.label}
              </text>
            )}
            {showLabels && d.value > 0 && (
              <text
                x={x + barW / 2}
                y={y - 3}
                textAnchor="middle"
                fontSize="8"
                fontWeight="600"
                fill="hsl(var(--foreground))"
              >
                {d.value}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
