import { usePluginContext } from '../context';

/**
 * Returns the cross-platform filesystem proxy, scoped to the project
 * directory: `exists(path)` and `readText(path)`.
 *
 * Prefer this over `useShell().exec('test', ['-f', path])` or
 * `useShell().exec('cat', [path])` for file-existence/read checks — those
 * POSIX binaries aren't on PATH by default on Windows, so a plugin that
 * shells out to them for this fails there outright, no matter what fallback
 * logic wraps the call.
 */
export function useFs() {
  return usePluginContext().fs;
}
