import { tileColour, tileInitials } from '@/lib/ui/tile';
import { formatMoney } from '@/lib/ui/money';

/**
 * The one card used everywhere a dish is shown — the carte, and later
 * order-taking. Two columns, never three: the photo has to be recognisable at
 * arm's length in a badly lit room.
 *
 * Name and price sit ON the photo so the eye never leaves the tile. The corner
 * always means "more about this item" — a pencil for the patron, an i for the
 * waiter — and tapping the photo itself is the action.
 */
export function DishCard({
  name, price, currency, decimals, photoUrl, available, corner, badge,
}: {
  name: string;
  price: number;
  currency: string;
  decimals: number;
  photoUrl?: string | null;
  available: boolean;
  corner?: React.ReactNode;
  badge?: number;
}) {
  const { bg, fg } = tileColour(name);

  return (
    <div
      data-dish={name}
      data-available={available}
      className="relative aspect-[3/4] overflow-hidden rounded-xl border border-rule bg-surface-2"
      style={photoUrl ? undefined : { background: bg }}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt={name}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center text-3xl font-bold"
          style={{ color: fg }}
        >
          {tileInitials(name)}
        </span>
      )}

      <span className="absolute left-2 top-2 max-w-[76%] rounded-md bg-black/70 px-2 py-1
                       text-xs font-semibold leading-tight text-white">
        {name}
      </span>

      <span className="absolute bottom-2 left-2 rounded-md bg-white/90 px-2 py-1
                       font-mono text-xs font-bold tabular-nums text-ink">
        {formatMoney(price, currency, decimals)}
      </span>

      {/* The 86 switch: a veil, not a struck-through name. Seen, not read. */}
      {!available && (
        <span data-sold-out className="absolute inset-0 flex items-center justify-center bg-black/55">
          <span className="flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5
                           text-sm font-bold text-red-800">
            <span aria-hidden>⃠</span> Épuisé
          </span>
        </span>
      )}

      {badge !== undefined && badge > 0 && (
        <span className="absolute right-1.5 top-1.5 flex h-7 min-w-7 items-center justify-center
                         rounded-full border-2 border-white bg-service px-1.5
                         font-mono text-sm font-bold text-white">
          {badge}
        </span>
      )}
      {corner && <span className="absolute right-1.5 top-1.5">{corner}</span>}
    </div>
  );
}
