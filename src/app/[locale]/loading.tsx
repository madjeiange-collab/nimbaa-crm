/**
 * Instant navigation feedback: shown the moment a link is tapped, while the
 * server renders the next page. Without this the app appears frozen for the
 * whole server round trip.
 */
export default function Loading() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center" role="status" aria-label="Chargement">
      <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-primary/25 border-t-primary" />
    </div>
  );
}
