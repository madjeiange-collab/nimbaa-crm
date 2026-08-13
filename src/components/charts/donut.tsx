/** SVG donut with % labels around the ring + a count legend (no chart lib). */
export function Donut({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const size = 180;
  const c = size / 2;
  const stroke = 20;
  const r = 56;
  const circ = 2 * Math.PI * r;
  const labelR = r + stroke / 2 + 12;

  // Build visible arcs with their cumulative fractions (for arc + label angle).
  let acc = 0;
  const visible = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const frac = s.value / total;
      const startFrac = acc;
      acc += frac;
      return { ...s, frac, startFrac, pct: Math.round(frac * 100) };
    });

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <circle cx={c} cy={c} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
        {total > 0 &&
          visible.map((s) => (
            <circle
              key={`arc-${s.label}`}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={`${s.frac * circ} ${circ - s.frac * circ}`}
              strokeDashoffset={-s.startFrac * circ}
              transform={`rotate(-90 ${c} ${c})`}
            />
          ))}
        {/* % labels positioned at each segment's mid-angle, outside the ring */}
        {total > 0 &&
          visible.map((s) => {
            const mid = s.startFrac + s.frac / 2;
            const theta = ((-90 + mid * 360) * Math.PI) / 180;
            const x = c + labelR * Math.cos(theta);
            const y = c + labelR * Math.sin(theta);
            return (
              <text
                key={`lbl-${s.label}`}
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="12"
                fontWeight="700"
                fill="hsl(var(--foreground))"
              >
                {s.pct}%
              </text>
            );
          })}
        <text x={c} y={c} textAnchor="middle" dominantBaseline="central" fontSize="24" fontWeight="700" fill="hsl(var(--foreground))">
          {total}
        </text>
      </svg>
      <ul className="space-y-1 text-xs">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="ml-auto font-semibold tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
