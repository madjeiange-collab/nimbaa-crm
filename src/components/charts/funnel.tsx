/** Simple horizontal conversion funnel (CSS bars, no chart library). */
export function Funnel({
  steps,
}: {
  steps: { label: string; value: number; color: string }[];
}) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div className="space-y-2">
      {steps.map((s) => {
        const pct = Math.round((s.value / max) * 100);
        return (
          <div key={s.label}>
            <div className="mb-0.5 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{s.label}</span>
              <span className="font-semibold">{s.value}</span>
            </div>
            <div className="h-6 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full rounded"
                style={{ width: `${Math.max(pct, s.value > 0 ? 6 : 0)}%`, backgroundColor: s.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
