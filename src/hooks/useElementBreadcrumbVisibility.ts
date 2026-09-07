import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ELEMENT_BREADCRUMB_ENABLED_CHANGED_EVENT,
  getElementBreadcrumbEnabled,
  setElementBreadcrumbEnabled,
} from '../lib/settings';

/** Mirrors the persisted element breadcrumb preference into React state. */
export function useElementBreadcrumbVisibility(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState(true);
  /** Set once anything newer than the initial read has arrived — a toggle from
   *  Settings, or a local update. The read is fired on mount and the user can
   *  toggle before it lands; without this, the older answer wins and the
   *  setting visibly flips back. `cancelled` only covers unmount, not being
   *  superseded while still mounted. */
  const supersededRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getElementBreadcrumbEnabled().then((value) => {
      if (!cancelled && !supersededRef.current) setEnabled(value);
    });
    const handleChanged = (event: Event) => {
      const value = (event as CustomEvent<boolean>).detail;
      if (typeof value === 'boolean') {
        supersededRef.current = true;
        setEnabled(value);
      }
    };
    window.addEventListener(ELEMENT_BREADCRUMB_ENABLED_CHANGED_EVENT, handleChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(ELEMENT_BREADCRUMB_ENABLED_CHANGED_EVENT, handleChanged);
    };
  }, []);

  const update = useCallback((value: boolean) => {
    supersededRef.current = true;
    setEnabled(value);
    void setElementBreadcrumbEnabled(value);
  }, []);

  return [enabled, update];
}
