/**
 * The frame says nothing is selected any more.
 *
 * Clicking the breakpoint canvas's background drops the element selection — the
 * only way to reach "nothing selected" used to be turning edit mode off, so an
 * outline sat over the design for as long as you were editing it. The frame
 * clears its own boxes and replies with `ss:deselect`; this is how every host
 * hook holding a piece of that selection (the styling panels, the structural
 * toolbar, the element tree) lets go of it at the same moment.
 *
 * The reset each hook runs here is the same one it runs when the editor is
 * moved to a different frame (`useFrameRebind`) — both mean "what I am holding
 * describes a selection that no longer exists".
 *
 * @module hooks/useSelectionCleared
 */

import { useEffect, useRef, type RefObject } from 'react';

export function useSelectionCleared(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  onCleared: () => void
): void {
  // Mirrored so a caller passing an inline function doesn't re-register the
  // listener on every render.
  const onClearedRef = useRef(onCleared);
  useEffect(() => {
    onClearedRef.current = onCleared;
  }, [onCleared]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // SECURITY: only the preview frame this hook is bound to. Other embedded
      // content must not be able to reach into the editor's state.
      if (event.source !== iframeRef.current?.contentWindow) return;
      if ((event.data as { type?: string } | null)?.type !== 'ss:deselect') return;
      onClearedRef.current();
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [iframeRef]);
}
