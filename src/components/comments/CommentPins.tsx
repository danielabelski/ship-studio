/**
 * The comments layer that sits over the preview frame.
 *
 * A note belongs on the thing it is about, so this is where a comment is read
 * and written — a numbered pin on its element, which opens into the note itself
 * anchored beside it. Host-side rather than drawn inside the iframe (the same
 * arrangement as `ElementToolbar`), so a card is real React with house
 * primitives instead of imperative DOM in the injected script.
 *
 * The frame reports every note's rect in its OWN pixels on each scroll, resize
 * and mutation; on a breakpoint canvas those pixels are then scaled to the
 * screen, exactly as the structural toolbar scales its selection box.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../primitives/Button';
import { IconButton } from '../primitives/IconButton';
import { TrashIcon, CloseIcon } from '@/components/icons';
import {
  commentElementName,
  commentViewportLabel,
  type CanvasComment,
  type CommentPlacement,
} from '../../lib/canvasComments';

/** Half the pin, so a pin on an element's corner sits centred on it. */
const PIN_RADIUS = 11;
const CARD_WIDTH = 260;
const GAP = 10;

interface Props {
  comments: CanvasComment[];
  placements: CommentPlacement[];
  missing: string[];
  /** Canvas scale; 1 for the ordinary single-frame preview. */
  scale: number;
  /** The frame's on-screen box, used to keep pins and cards inside it. */
  bounds: { w: number; h: number } | null;
  openId: string | null;
  onOpen: (id: string | null) => void;
  /** Threads ticked for the next handoff, from the shared team store. */
  selectedIds: string[];
  toggle: (id: string) => void;
  onEdit: (comment: CanvasComment) => void;
  onDelete: (comment: CanvasComment) => void;
  onHover: (comment: CanvasComment | null) => void;
  /** The composer, rendered anchored to the element being commented on. */
  composer?: ReactNode;
  composerAt?: { x: number; y: number } | null;
  /** Identifies the element being commented on, so picking a new one re-nudges. */
  composerFor?: string | null;
}

/**
 * An open note sits beside its pin and stays there.
 *
 * It is deliberately NOT clamped into the frame's viewport: a card is anchored
 * to a place on the page, so when the page scrolls it leaves with its element,
 * the way the pin does. Clamping made it stick to the top of the frame while
 * its pin scrolled away, which reads as a floating panel rather than a note on
 * a thing. The only adjustment is horizontal — flipping to the other side of
 * the pin when the card would otherwise run off the right edge.
 */
function place(x: number, y: number, bounds: { w: number; h: number } | null) {
  const w = bounds?.w ?? Infinity;
  const flip = x + GAP + CARD_WIDTH > w;
  return { left: flip ? x - GAP - CARD_WIDTH : x + GAP, top: y - PIN_RADIUS };
}

/**
 * How far the composer has to move, once, to be fully on screen.
 *
 * The composer obeys the same rule as a note card — it is anchored to its
 * element and scrolls away with it — with one difference: at the moment it
 * opens it has to be readable, because it is a form somebody is about to type
 * into, and the frame clips whatever falls outside it. So the offset is
 * measured when it opens and then held. Afterwards the anchor moves and the
 * offset does not, which is what makes it travel with the page instead of
 * sticking to an edge.
 */
function nudgeIntoView(
  at: { left: number; top: number },
  bounds: { w: number; h: number },
  size: { w: number; h: number }
) {
  // A card larger than the frame cannot fit; pinning its top-left is the most
  // useful failure, since that is the end with the context and the field.
  const shift = (v: number, extent: number, limit: number) =>
    extent + GAP * 2 >= limit ? GAP - v : Math.min(Math.max(v, GAP), limit - extent - GAP) - v;
  return { dx: shift(at.left, size.w, bounds.w), dy: shift(at.top, size.h, bounds.h) };
}

export function CommentPins(props: Props) {
  const { comments, placements, scale, bounds, openId } = props;
  const { composerAt, composerFor } = props;
  const [composerEl, setComposerEl] = useState<HTMLDivElement | null>(null);
  // null until measured. Held from then on, so scrolling moves the composer
  // with its element rather than pinning it to the frame.
  const [nudge, setNudge] = useState<{ dx: number; dy: number } | null>(null);
  const anchored =
    composerAt && props.composer ? place(composerAt.x * scale, composerAt.y * scale, bounds) : null;
  // Read by the measuring effect, which must not re-run when these change —
  // re-running is precisely how the composer would start following the page.
  const latest = useRef({ anchored, bounds });
  // Declared before the measuring effect so it is up to date when that runs.
  useLayoutEffect(() => {
    latest.current = { anchored, bounds };
  });
  // A new target is a new opening, so it earns a fresh measurement. Adjusted
  // during render rather than in an effect, so no frame is ever painted with
  // the previous element's offset applied to this one's anchor.
  const [nudgedFor, setNudgedFor] = useState(composerFor);
  if (nudgedFor !== composerFor) {
    setNudgedFor(composerFor);
    setNudge(null);
  }
  useLayoutEffect(() => {
    if (!composerEl) return;
    const measure = () => {
      const { anchored: at, bounds: box } = latest.current;
      if (!at || !box) return;
      const size = { w: composerEl.offsetWidth, h: composerEl.offsetHeight };
      // Height arrives a frame late in some browsers; an unmeasured card would
      // otherwise freeze a nudge computed against zero and never correct it.
      if (!size.h) return;
      setNudge((prev) => (prev ? prev : nudgeIntoView(at, box, size)));
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(composerEl);
    return () => observer?.disconnect();
  }, [composerEl, composerFor]);
  const byId = new Map(comments.map((c) => [c.id, c]));
  const open = openId ? comments.find((c) => c.id === openId) : undefined;
  const openAt = openId ? placements.find((p) => p.id === openId) : undefined;

  return (
    <div className="canvas-comment-layer">
      {placements.map((p) => {
        const note = byId.get(p.id);
        if (!note) return null;
        const x = p.x * scale;
        const y = p.y * scale;
        const isOpen = note.id === openId;
        return (
          <button
            key={note.id}
            type="button"
            className="canvas-comment-pin-marker"
            data-status={note.status}
            data-open={isOpen || undefined}
            style={{ left: x, top: y }}
            title={`Comment ${note.number} — ${commentElementName(note.target)}`}
            aria-label={`Comment ${note.number}: ${note.body}`}
            aria-expanded={isOpen}
            onClick={() => props.onOpen(isOpen ? null : note.id)}
            onPointerEnter={() => props.onHover(note)}
            onPointerLeave={() => props.onHover(null)}
          >
            {note.number}
          </button>
        );
      })}

      {open && openAt && (
        <div
          className="canvas-comment-bubble"
          data-status={open.status}
          style={{ width: CARD_WIDTH, ...place(openAt.x * scale, openAt.y * scale, bounds) }}
        >
          <div className="canvas-comment-bubble__head">
            {open.status === 'pending' && (
              <input
                type="checkbox"
                aria-label={`Include comment: ${open.body}`}
                checked={props.selectedIds.includes(open.id)}
                onChange={() => props.toggle(open.id)}
              />
            )}
            <span className="canvas-comment-bubble__target">{commentElementName(open.target)}</span>
            <IconButton
              variant="ghost"
              size="compact"
              icon={<CloseIcon size={12} />}
              title="Close comment"
              aria-label="Close comment"
              onClick={() => props.onOpen(null)}
            />
          </div>
          <p className="canvas-comment-body">{open.body}</p>
          <span className="canvas-comments-hint">Seen at {commentViewportLabel(open.target)}</span>
          {open.status === 'sent' && (
            <span className="canvas-comments-sent">Sent to {open.sentTo}</span>
          )}
          {props.missing.includes(open.id) && (
            <span className="canvas-comments-error">
              Element not found. Choose Edit, then click a new element.
            </span>
          )}
          <div className="canvas-comments-actions">
            <Button size="compact" variant="ghost" onClick={() => props.onEdit(open)}>
              Edit
            </Button>
            <IconButton
              size="compact"
              variant="ghost"
              icon={<TrashIcon />}
              aria-label={`Delete comment: ${open.body}`}
              title="Delete comment"
              onClick={() => props.onDelete(open)}
            />
          </div>
        </div>
      )}

      {props.composer && anchored && (
        <div
          ref={setComposerEl}
          className="canvas-comment-bubble canvas-comment-bubble--composing"
          style={{
            width: CARD_WIDTH,
            left: anchored.left + (nudge?.dx ?? 0),
            top: anchored.top + (nudge?.dy ?? 0),
          }}
        >
          {props.composer}
        </div>
      )}
    </div>
  );
}
