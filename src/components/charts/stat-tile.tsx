import { ChevronRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Card } from '@/components/ui/card';

/** Compact KPI tile: a big number with a label. Optionally a drill-down link. */
export function StatTile({
  label,
  value,
  accent = 'primary',
  href,
}: {
  label: string;
  value: string | number;
  accent?: 'primary' | 'green' | 'amber' | 'red' | 'muted';
  /** When set, the tile becomes a link to a detail view. */
  href?: string;
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

  const inner = (
    <Card className={`relative h-full p-3 ${href ? 'transition-colors hover:bg-accent' : ''}`}>
      {href && (
        <ChevronRight
          className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-muted-foreground"
          aria-hidden
        />
      )}
      <p className={`text-2xl font-bold leading-none ${color}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </Card>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {inner}
    </Link>
  ) : (
    inner
  );
}
