/**
 * Tests for package-manager-aware command builders (src/lib/package-manager.ts).
 *
 * These functions decide HOW a project's dev server is spawned. The regression
 * they guard against: hardcoding npm/npx for every project broke bun and pnpm
 * projects — `npm run` parses npm-only manifest fields (an `overrides` block
 * npm rejects aborts the launch with EOVERRIDE) and `npx bash …` dies with
 * "could not determine executable to run" because npx never falls back to PATH
 * (bunx and `pnpm exec` do — verified against npm 12 / bun / pnpm).
 */

import { describe, it, expect } from 'vitest';
import { execScriptCommand, normalizePackageManager, runScriptCommand } from './package-manager';

describe('normalizePackageManager', () => {
  it('passes through known managers', () => {
    expect(normalizePackageManager('npm')).toBe('npm');
    expect(normalizePackageManager('pnpm')).toBe('pnpm');
    expect(normalizePackageManager('yarn')).toBe('yarn');
    expect(normalizePackageManager('bun')).toBe('bun');
  });

  it('defaults unknown, empty, and null detections to npm', () => {
    expect(normalizePackageManager('npm9')).toBe('npm');
    expect(normalizePackageManager('')).toBe('npm');
    expect(normalizePackageManager(null)).toBe('npm');
    expect(normalizePackageManager(undefined)).toBe('npm');
  });
});

describe('runScriptCommand', () => {
  it('uses npm run with the -- separator for npm projects', () => {
    expect(runScriptCommand('npm', 'dev', ['--port', '3000'])).toEqual({
      command: 'npm',
      args: ['run', 'dev', '--', '--port', '3000'],
    });
  });

  it('forwards args directly for bun projects', () => {
    expect(runScriptCommand('bun', 'dev', ['--port', '3000'])).toEqual({
      command: 'bun',
      args: ['run', 'dev', '--port', '3000'],
    });
  });

  it('forwards args directly for pnpm projects', () => {
    expect(runScriptCommand('pnpm', 'dev', ['--port', '3000'])).toEqual({
      command: 'pnpm',
      args: ['run', 'dev', '--port', '3000'],
    });
  });

  it('forwards args directly for yarn projects (yarn 1 passes a literal -- to the script)', () => {
    expect(runScriptCommand('yarn', 'dev', ['--port', '3000'])).toEqual({
      command: 'yarn',
      args: ['run', 'dev', '--port', '3000'],
    });
  });
});

describe('execScriptCommand', () => {
  it('keeps npx for npm projects (local .bin resolution)', () => {
    expect(execScriptCommand('npm', 'next', ['dev', '--port', '3000'])).toEqual({
      command: 'npx',
      args: ['next', 'dev', '--port', '3000'],
    });
  });

  it('uses bunx for bun projects so PATH commands like bash resolve', () => {
    expect(execScriptCommand('bun', 'bash', ['scripts/dev.sh', '--port', '3000'])).toEqual({
      command: 'bunx',
      args: ['bash', 'scripts/dev.sh', '--port', '3000'],
    });
  });

  it('uses pnpm exec for pnpm projects so PATH commands like bash resolve', () => {
    expect(execScriptCommand('pnpm', 'bash', ['scripts/dev.sh', '--port', '3000'])).toEqual({
      command: 'pnpm',
      args: ['exec', 'bash', 'scripts/dev.sh', '--port', '3000'],
    });
  });

  it('keeps npx for yarn projects (no PATH-falling yarn exec equivalent)', () => {
    expect(execScriptCommand('yarn', 'vite', ['dev'])).toEqual({
      command: 'npx',
      args: ['vite', 'dev'],
    });
  });
});
