/**
 * A destructive submit that takes two gestures: reveal, then confirm.
 *
 * A disclosure and not a button that rewrites itself. The obvious version —
 * one button whose `type` flips from "button" to "submit" on first tap — fires
 * on the FIRST tap: React applies the state change while the click is still
 * being dispatched, so the browser reads the new type when it runs the default
 * action, and the category is gone. That deleted a real menu section in
 * testing before anything asked for confirmation.
 *
 * It is also not a confirm() dialog: a modal box of prose is the one thing a
 * member of staff who reads with difficulty cannot skim, and it appears far
 * from the thing being deleted. Here the question is asked in place.
 *
 * No state, no effect, no JavaScript: <details> does this natively, so it
 * behaves the same before hydration as after — and before hydration it is the
 * safe behaviour, not the destructive one.
 */
export function Confirm({
  label, confirm, title,
}: { label: React.ReactNode; confirm: string; title: string }) {
  return (
    <details className="group" data-confirm={title}>
      <summary title={title}
        className="flex h-9 cursor-pointer list-none items-center justify-center gap-1 rounded-md
                   border border-rule bg-white px-2 text-sm marker:hidden
                   [&::-webkit-details-marker]:hidden">
        {label}
      </summary>
      <button type="submit" title={confirm} aria-label={confirm}
        className="mt-1.5 flex h-9 items-center justify-center gap-1 rounded-md border
                   border-red-800 bg-red-800 px-2 text-sm font-semibold text-white">
        {confirm}
      </button>
    </details>
  );
}
