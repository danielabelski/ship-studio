/**
 * Canvas comment mode, pinned notes, and the explicit batch handoff.
 *
 * Exposed as a layer rather than one component because its two halves mount in
 * different places: the pins belong over the preview frame (and on a breakpoint
 * canvas, over the ACTIVE frame, in the unscaled overlay layer), while the send
 * bar belongs in the workspace. This is the same arrangement `useElementStructure`
 * has with `ElementToolbar`.
 */
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import { CommentPins } from './CommentPins';
import { CommentComposer } from './CommentComposer';
import { useCanvasComments } from '../../hooks/useCanvasComments';
import {
  getUiSnapshot,
  subscribe as subscribeTeam,
  toggleThreadSelected,
} from '../../lib/teamStore';
import { useCommentBridge } from '../../hooks/useCommentBridge';
import { useOptionalToast } from '../../contexts/ToastContext';
import {
  type CanvasComment,
  type CommentTarget,
  type CommentAgent,
} from '../../lib/canvasComments';
import '../../styles/features/canvas-comments.css';

export interface CanvasCommentsProps {
  projectPath: string;
  branch: string | null;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  agents: CommentAgent[];
  activeAgentId?: number;
  currentPage: string;
  navigate: (page: string) => void;
  available: boolean;
  editing: boolean;
  stopEditing: () => void;
  /** Open state is owned by the workspace header, which renders the toggle. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
export function useCanvasCommentsLayer(props: CanvasCommentsProps): {
  /** Pins for one frame: its canvas scale, and its on-screen box. */
  pins: (scale: number, bounds: { w: number; h: number } | null) => ReactNode;
} {
  const { open, onOpenChange } = props;
  const setOpen = onOpenChange;
  const [draft, setDraft] = useState<CommentTarget | null>(null);
  const [editingNote, setEditingNote] = useState<CanvasComment>();
  // A ref, not state: nothing renders from this, and clearing it from the
  // effect that consumes it would be a setState inside an effect for no gain.
  // The counter is what re-runs that effect once the frame reports its page.
  const pendingLocate = useRef<CanvasComment | undefined>(undefined);
  const [locateSeq, setLocateSeq] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const { showToast } = useOptionalToast();
  const store = useCanvasComments(props.projectPath, props.branch ?? '');
  // The tick on a pin and the tick on its row in the Team panel are one
  // decision, so they read one piece of state rather than two that drift.
  const { selectedThreadIds } = useSyncExternalStore(subscribeTeam, getUiSnapshot);
  const enabled = open && props.available && !props.editing;
  const cancelDraft = () => {
    setDraft(null);
    setEditingNote(undefined);
    bridge.post({ type: 'clear' });
  };
  const locate = (note: CanvasComment) => {
    pendingLocate.current = note;
    setLocateSeq((seq) => seq + 1);
    if (props.currentPage !== note.target.page) props.navigate(note.target.page);
    else bridge.post({ type: 'locate', id: note.id, target: note.target });
  };
  const bridge = useCommentBridge({
    iframeRef: props.iframeRef,
    enabled,
    picking: true,
    notes: store.comments,
    onSelect: setDraft,
    onOpen: (id) => {
      const note = store.comments.find((c) => c.id === id);
      if (note && !draft) {
        setEditingNote(note);
        setDraft(note.target);
      }
    },
    onEscape: () => {
      if (!draft) setOpen(false);
      else bridge.post({ type: 'clear' });
    },
  });
  const { ready, post, framePage } = bridge;
  const { editing, stopEditing } = props;
  useEffect(() => {
    if (open && editing) stopEditing();
  }, [open, editing, stopEditing]);
  useEffect(() => {
    const note = pendingLocate.current;
    if (note && ready && note.target.page === framePage) {
      post({ type: 'locate', id: note.id, target: note.target });
      pendingLocate.current = undefined;
    }
  }, [locateSeq, ready, post, framePage]);
  const composer = draft ? (
    <CommentComposer
      key={editingNote?.id ?? 'new'}
      target={draft}
      existing={editingNote}
      onCancel={cancelDraft}
      onSave={async (body) => {
        // No branch gate. A comment is a note about a page, and a project with
        // no repository — or a detached HEAD — is still a project worth
        // annotating. The record carries whatever branch there is, or none.
        const ok = editingNote
          ? await store.update(editingNote.id, {
              body,
              status: 'pending',
              sentAt: undefined,
              sentTo: undefined,
              batchId: undefined,
            })
          : await store.add(draft, body);
        if (ok) {
          cancelDraft();
          bridge.post({ type: 'clear' });
        }
        return ok;
      }}
    />
  ) : null;

  const removeNote = async (c: CanvasComment) => {
    // Nothing closes until the record is actually written. Closing first and
    // reopening on failure loses the person's place in the page, and a note
    // that vanished and came back reads as data loss even when nothing was
    // lost — the store reports the failure on its own.
    if (!(await store.remove(c.id))) return;
    if (pendingLocate.current?.id === c.id) pendingLocate.current = undefined;
    if (openId === c.id) setOpenId(null);
    bridge.post({ type: 'clear' });
    showToast('Comment deleted', 'success');
  };

  const editNote = (c: CanvasComment) => {
    if (draft) {
      showToast('Save or cancel your current draft first.', 'info');
      return;
    }
    setOpenId(null);
    setEditingNote(c);
    setDraft(c.target);
    locate(c);
  };

  return {
    pins: (scale, bounds) =>
      open ? (
        <CommentPins
          comments={store.comments}
          placements={bridge.placements}
          missing={bridge.missing}
          scale={scale}
          bounds={bounds}
          openId={openId}
          onOpen={setOpenId}
          selectedIds={selectedThreadIds}
          toggle={toggleThreadSelected}
          onEdit={editNote}
          onDelete={(comment) => void removeNote(comment)}
          onHover={(c) =>
            c
              ? bridge.post({ type: 'locate', id: c.id, target: c.target, quiet: true })
              : bridge.post({ type: 'clear' })
          }
          composer={composer}
          // The live rect while it is available; the rect captured at click
          // time only covers the first paint before the frame reports again.
          composerAt={draft ? (bridge.selectedAt ?? { x: draft.rect.x, y: draft.rect.y }) : null}
          // Retargeting keeps the same composer and the same draft text, so
          // the layer needs telling that this is a new opening to nudge for.
          composerFor={draft ? `${draft.page}|${draft.selector}` : null}
        />
      ) : null,
  };
}
