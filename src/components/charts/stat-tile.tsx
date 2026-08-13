import { Card } from '@/components/ui/card';

/** Compact KPI tile: a big number with a label. */
export function StatTile({
  label,
  value,
  accent = 'primary',
}: {
  label: string;
  value: string | number;
  accent?: 'primary' | 'green' | 'amber' | 'red' | 'muted';
}) {
  const color =
    accent === 'green'
      ? 'text-knock-green'
      : accent === 'amber'
        ? 'text-brand-brown'
        : accent === 'red'
          ? 'text-destructive'
          : accent === 'muted'
            ? 'text-muted-foreground'
            : 'text-primary';
  return (
    <Card className="p-3">
      <p className={`text-2xl font-bold leading-none ${color}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </Card>
  );
}
