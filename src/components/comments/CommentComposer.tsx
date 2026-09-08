/**
 * Backlog composer: adding a note never invokes an agent.
 *
 * Saving is asynchronous — it writes a record — so the button has to be dead
 * while that is in flight. It was not, and the gap was long enough to click
 * through: three clicks left three identical comments on the same element,
 * because each click started its own write and each write got its own id.
 * A guard on the button alone is not enough either, since Cmd+Enter goes down
 * the same path, so the in-flight flag is checked at the one place both reach.
 */
import { useRef, useState } from 'react';
import { Button } from '../primitives/Button';
import { TextArea } from '../primitives/TextField';
import {
  commentTargetLabel,
  type CommentTarget,
  type CanvasComment,
} from '../../lib/canvasComments';

interface Props {
  target: CommentTarget;
  existing?: CanvasComment;
  onSave: (body: string) => boolean | Promise<boolean>;
  onCancel: () => void;
}
export function CommentComposer({ target, existing, onSave, onCancel }: Props) {
  const [body, setBody] = useState(existing?.body ?? '');
  const [saving, setSaving] = useState(false);
  // A ref as well as the state: two clicks in the same tick both read the old
  // state, and the second one would still get through.
  const inFlight = useRef(false);

  const save = async () => {
    if (inFlight.current || !body.trim()) return;
    inFlight.current = true;
    setSaving(true);
    try {
      await onSave(body);
    } finally {
      // The composer usually unmounts on success, so this only matters on the
      // failure path — where the button must come back, not stay dead.
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <form
      className="canvas-comment-composer"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="canvas-comments-context" aria-label="Selected element">
        <div className="canvas-comments-row">
          <code className="canvas-comments-tag">{`<${target.tag}>`}</code>
          <span>
            {target.viewport.width} × {target.viewport.height}
          </span>
        </div>
        <code title={target.selector}>{target.selector}</code>
        <span className="canvas-comments-target-text" title={commentTargetLabel(target)}>
          {target.heading || target.text || target.page}
        </span>
      </div>
      <p className="canvas-comments-hint">Click another element to change the target.</p>
      <TextArea
        aria-label="What should change?"
        autoFocus
        value={body}
        maxLength={8000}
        rows={3}
        placeholder="Please make this 80vh instead of 100vh."
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void save();
          }
        }}
      />
      {existing?.status === 'sent' && (
        <p className="canvas-comments-hint">Changes will be ready to send again.</p>
      )}
      <div className="canvas-comments-row">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!body.trim() || saving}>
          {saving ? 'Saving…' : 'Save comment'}
        </Button>
      </div>
    </form>
  );
}
