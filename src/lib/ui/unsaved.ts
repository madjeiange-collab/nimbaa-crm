'use client';

/**
 * Guard for work that only lives in the browser until it is saved — above all
 * the visit and installation photos, which exist as blobs in a component and
 * are gone the moment the screen unmounts.
 *
 * A form calls markUnsaved(message) while it holds such work, and the header's
 * navigation controls call confirmDiscard() before leaving. Deliberately a
 * module-level flag rather than context: the header is rendered by a server
 * component, far from the form in the tree, and both only need one bit.
 */

let pendingMessage: string | null = null;
let beforeUnloadBound = false;

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!pendingMessage) return;
  // Browsers show their own wording; setting returnValue is what triggers it.
  e.preventDefault();
  e.returnValue = '';
}

/** Flag (or clear, with null) work that would be lost by navigating away. */
export function markUnsaved(message: string | null): void {
  pendingMessage = message;
  if (typeof window === 'undefined') return;
  if (message && !beforeUnloadBound) {
    window.addEventListener('beforeunload', onBeforeUnload);
    beforeUnloadBound = true;
  } else if (!message && beforeUnloadBound) {
    window.removeEventListener('beforeunload', onBeforeUnload);
    beforeUnloadBound = false;
  }
}

/**
 * True when it is safe to navigate: either nothing is pending, or the user
 * accepted losing it. Accepting clears the flag, since the work is gone.
 */
export function confirmDiscard(): boolean {
  if (!pendingMessage || typeof window === 'undefined') return true;
  if (!window.confirm(pendingMessage)) return false;
  markUnsaved(null);
  return true;
}

/** Whether unsaved work is currently flagged (for tests and debugging). */
export function hasUnsaved(): boolean {
  return pendingMessage !== null;
}
