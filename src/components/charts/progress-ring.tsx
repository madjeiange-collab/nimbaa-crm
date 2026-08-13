/** Circular progress ring for a goal (e.g. daily knocks / target). */
export function ProgressRing({
  value,
  goal,
  label,
}: {
  value: number;
  goal: number;
  label: string;
}) {
  const size = 120;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = goal > 0 ? Math.min(1, value / goal) : 0;
  const reached = value >= goal && goal > 0;

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={reached ? 'hsl(var(--knock-green))' : 'hsl(var(--primary))'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="47%"
          textAnchor="middle"
          fontSize="26"
          fontWeight="700"
          fill="hsl(var(--foreground))"
        >
          {value}
        </text>
        <text x="50%" y="63%" textAnchor="middle" fontSize="12" fill="hsl(var(--muted-foreground))">
          / {goal}
        </text>
      </svg>
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-1 text-2xl font-bold text-primary">{Math.round(pct * 100)}%</p>
      </div>
    </div>
  );
}
