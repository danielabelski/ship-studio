/**
 * Custom hook for managing toast notifications.
 *
 * Extracted from App.tsx to reduce component complexity and improve reusability.
 * This hook is completely self-contained with no external dependencies, making it
 * an ideal candidate for extraction.
 *
 * Provides a simple API for showing and dismissing toast notifications
 * with automatic cleanup after a timeout.
 *
 * @module hooks/useToasts
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { reportError } from '../lib/errorReporting';

/** Toast notification type */
export type ToastType = 'success' | 'error' | 'info';

/** Toast notification data */
/** An optional single action rendered inside a toast. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

/**
 * How to show a toast beyond its type and action.
 *
 * `expected` marks an error toast the app *meant* to show: a by-design
 * refusal the user can act on ("that project already has the maximum number
 * of agent tabs"), not something that went wrong. It still looks and behaves
 * like an error — it is a problem from where the user is sitting, and it
 * should persist until they have read it — but it is not filed as a bug.
 *
 * Without this, every such refusal had to be demoted to an `info` toast to
 * stay out of telemetry, which is why the same class of report kept coming
 * back at each new call site (issues #437, #920).
 */
export interface ToastOptions {
  /** A deliberate refusal, not a malfunction — show it, don't report it. */
  expected?: boolean;
}

/** Return type for useToasts hook */
export interface UseToastsReturn {
  /** Array of active toast notifications */
  toasts: Toast[];
  /** Show a new toast notification */
  showToast: (
    message: string,
    type?: ToastType,
    action?: ToastAction,
    options?: ToastOptions
  ) => void;
  /** Dismiss a toast by ID */
  dismissToast: (id: number) => void;
}

/** Maximum number of toasts to display at once */
const MAX_TOASTS = 5;
/** Time in ms before a success/info toast auto-dismisses. Error toasts never
 *  auto-dismiss — the user needs time to read (and copy) the full detail, so
 *  they persist until manually dismissed via the ✕ button. */
const TOAST_DURATION_MS = 4000;

/**
 * Hook for managing toast notifications.
 *
 * @example
 * ```tsx
 * const { toasts, showToast, dismissToast } = useToasts();
 *
 * // Show a success toast
 * showToast('Operation completed', 'success');
 *
 * // Show an error toast
 * showToast('Something went wrong', 'error');
 *
 * // Dismiss a specific toast
 * dismissToast(toastId);
 * ```
 *
 * @returns Toast state and control functions
 */
export function useToasts(): UseToastsReturn {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const timerMap = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  // Clear all toast timers on unmount
  useEffect(() => {
    const map = timerMap.current;
    return () => {
      map.forEach(clearTimeout);
      map.clear();
    };
  }, []);

  const showToast = useCallback(
    (
      message: string,
      type: ToastType = 'success',
      action?: ToastAction,
      options?: ToastOptions
    ) => {
      // An error toast is, by definition, the user seeing something not work as
      // intended — report it to the admin agent (deduped + throttled; see
      // docs/error-reporting.md). Unless the caller says otherwise: a refusal
      // the app decided on is not a malfunction (see `ToastOptions.expected`).
      if (type === 'error' && !options?.expected) {
        reportError({ message, source: 'toast' });
      }
      const id = ++toastIdRef.current;
      setToasts((prev) => {
        // Keep max toasts, remove oldest if needed
        const updated = [...prev, { id, message, type, action }];
        return updated.slice(-MAX_TOASTS);
      });
      // Auto-dismiss after timeout — except errors, which persist until the
      // user dismisses them (they carry detail worth reading/copying).
      if (type !== 'error') {
        const timer = setTimeout(() => {
          timerMap.current.delete(id);
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, TOAST_DURATION_MS);
        timerMap.current.set(id, timer);
      }
    },
    []
  );

  const dismissToast = useCallback((id: number) => {
    const timer = timerMap.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timerMap.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, showToast, dismissToast };
}
