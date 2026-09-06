import { isExpectedCommandError, isProjectFolderGoneError } from '../../lib/errors';

/**
 * Classifies a `getProjectThumbnail` failure into the log level it belongs
 * at. A gone project folder and any other backend-recognized environment
 * state (e.g. a macOS Full Disk Access / EPERM denial from
 * `classify_fs_error`) are user-fixable conditions, not bugs — they must log
 * as warnings so they aren't auto-filed as bug reports (issue #887).
 */
export function classifyThumbnailLoadFailure(e: unknown): { level: 'warn' | 'error' } {
  if (isProjectFolderGoneError(e) || isExpectedCommandError(e)) {
    return { level: 'warn' };
  }
  return { level: 'error' };
}
