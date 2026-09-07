/**
 * Plugin context for providing host app data and actions to plugins.
 *
 * Plugins render inside a PluginContext.Provider and access data through
 * SDK hooks that read from this context. Plugins never get direct `invoke`
 * access -- all backend operations go through proxy functions.
 *
 * @module contexts/PluginContext
 */

import { createContext } from 'react';

/** Project data exposed to plugins */
export interface PluginProjectData {
  name: string;
  path: string;
  currentBranch: string;
  hasUncommittedChanges: boolean;
  devServerUrl?: string;
  gitRemoteUrl?: string;
}

/** App actions plugins can trigger */
export interface PluginAppActions {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  refreshGitStatus: () => void;
  refreshBranches: () => void;
  focusTerminal: () => void;
  openUrl: (url: string) => void;
  /** Open a terminal modal running an interactive command. Resolves with the exit code when the process finishes or null if cancelled. */
  openTerminal: (
    command: string,
    args: string[],
    options?: { title?: string }
  ) => Promise<number | null>;
}

/** Shell command proxy for plugins */
export interface PluginShellProxy {
  exec: (
    command: string,
    args: string[]
  ) => Promise<{
    stdout: string;
    stderr: string;
    exit_code: number;
  }>;
}

/** Storage proxy for plugins */
export interface PluginStorageProxy {
  read: () => Promise<Record<string, unknown>>;
  write: (data: Record<string, unknown>) => Promise<void>;
}

/**
 * Cross-platform filesystem proxy for plugins, scoped to the project
 * directory. Exists so plugins never need to shell out to POSIX-only `test`
 * or `cat` to check for or read a file (issues #840, #816, #777, #751, #693)
 * — those fail outright on Windows, where `test`/`cat` aren't on PATH.
 */
export interface PluginFsProxy {
  /** Whether `path` (relative to the project root) exists. */
  exists: (path: string) => Promise<boolean>;
  /** UTF-8 contents of `path` (relative to the project root), or `null` if it doesn't exist. */
  readText: (path: string) => Promise<string | null>;
}

/** Invoke proxy for plugins to call Tauri commands */
export interface PluginInvokeProxy {
  call: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
}

/** Theme data for consistent styling */
export interface PluginThemeData {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  accent: string;
  accentHover: string;
  action: string;
  actionHover: string;
  actionText: string;
  error: string;
  success: string;
}

/** Full context value provided to each plugin */
export interface PluginContextValue {
  pluginId: string;
  project: PluginProjectData | null;
  actions: PluginAppActions;
  shell: PluginShellProxy;
  storage: PluginStorageProxy;
  fs: PluginFsProxy;
  invoke: PluginInvokeProxy;
  theme: PluginThemeData;
}

export const PluginContext = createContext<PluginContextValue | null>(null);

/**
 * Expose the PluginContext React context object on window so the SDK
 * can call React.useContext(ref) and get the correct per-plugin value.
 * Must be called once at startup (in main.tsx).
 */
export function exposePluginContextRef(): void {
  (window as unknown as Record<string, unknown>).__SHIPSTUDIO_PLUGIN_CONTEXT_REF__ = PluginContext;
}

/**
 * @deprecated Use exposePluginContextRef() + PluginContext.Provider instead.
 * Kept for backward compat with raw-JS plugins that read the single global.
 */
export function exposePluginContext(value: PluginContextValue | null): void {
  (window as unknown as Record<string, unknown>).__SHIPSTUDIO_PLUGIN_CONTEXT__ = value;
}
