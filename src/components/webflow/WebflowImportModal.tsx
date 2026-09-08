/**
 * Bringing a Webflow site in — and being straight about what each way costs.
 *
 * There are three ways to read a Webflow site and they are not equivalent. The
 * old plugin supported only the middle one, silently, which meant every user
 * who picked it discovered on the far side of an afternoon that their CMS
 * content had not come with them.
 *
 * So the choice is the screen. Each option states what it brings and what it
 * cannot, before it is chosen rather than after — the same reason the Hosting
 * section prints the provider's own status word instead of a word we made up.
 */

import { useState } from 'react';
import { ModalFrame } from '../primitives/ModalFrame';
import { Button } from '../primitives/Button';
import { CheckIcon, CloseIcon } from '@/components/icons';
import { WEBFLOW_SOURCE_TIERS, type WebflowSourceKind } from '@/lib/webflow';

interface WebflowImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (kind: WebflowSourceKind) => void;
}

export function WebflowImportModal({ isOpen, onClose, onConfirm }: WebflowImportModalProps) {
  const [chosen, setChosen] = useState<WebflowSourceKind>('account');
  const tier = WEBFLOW_SOURCE_TIERS.find((t) => t.kind === chosen);

  return (
    <ModalFrame isOpen={isOpen} onClose={onClose} title="Bring in a Webflow site">
      <div className="wf-import">
        <div
          className="wf-import__tiers"
          role="radiogroup"
          aria-label="Where to read the site from"
        >
          {WEBFLOW_SOURCE_TIERS.map((option) => (
            <button
              key={option.kind}
              type="button"
              role="radio"
              aria-checked={chosen === option.kind}
              className={`wf-tier${chosen === option.kind ? ' wf-tier--chosen' : ''}`}
              onClick={() => setChosen(option.kind)}
            >
              <span className="wf-tier__label">{option.label}</span>
              <span className="wf-tier__detail">{option.detail}</span>
              {option.requirement && (
                <span className="wf-tier__requirement">{option.requirement}</span>
              )}
            </button>
          ))}
        </div>

        {tier && (
          <div className="wf-import__consequences">
            <ul className="wf-import__list wf-import__list--brings">
              {tier.brings.map((item) => (
                <li key={item}>
                  <CheckIcon size={14} />
                  {item}
                </li>
              ))}
            </ul>
            <ul className="wf-import__list wf-import__list--misses">
              {tier.misses.map((item) => (
                <li key={item}>
                  <CloseIcon size={14} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        <footer className="wf-import__footer">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onConfirm(chosen)}>
            {tier?.kind === 'account' ? 'Connect Webflow' : 'Continue'}
          </Button>
        </footer>
      </div>
    </ModalFrame>
  );
}
