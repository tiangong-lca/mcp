#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPnpm } from './lib/run-pnpm.mjs';

const repoRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'tiangong mcp clean worktree '));

function storePath(result) {
  const value = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  const hasControl = Array.from(value).some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
  if (!value || !isAbsolute(value) || hasControl) {
    throw new Error('pnpm store path must return one absolute package-store directory.');
  }
  return normalize(value);
}

function storeIdentity(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

try {
  const tracked = spawnSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'buffer',
  });
  if (tracked.error) {
    throw tracked.error;
  }
  if (tracked.status !== 0) {
    throw new Error(`git ls-files failed with exit code ${tracked.status}.`);
  }

  for (const relativePath of tracked.stdout.toString('utf8').split('\0').filter(Boolean)) {
    const source = join(repoRoot, relativePath);
    const destination = join(temporaryRoot, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) {
      symlinkSync(readlinkSync(source), destination);
    } else {
      copyFileSync(source, destination);
    }
  }

  const sourceStore = storePath(runPnpm(['store', 'path'], { cwd: repoRoot, stdio: 'pipe' }));
  // pnpm 11.24 accepts its versioned store path as --store-dir. Ask that same
  // executable in the target context to prove the path was not versioned twice.
  const targetStore = storePath(
    runPnpm(['--store-dir', sourceStore, 'store', 'path'], {
      cwd: temporaryRoot,
      stdio: 'pipe',
    }),
  );
  if (storeIdentity(sourceStore) !== storeIdentity(targetStore)) {
    throw new Error('The temporary install did not resolve the exact source package store.');
  }
  console.log(`[clean-worktree] shared package store: ${sourceStore}`);
  console.log(`[clean-worktree] fresh install root: ${temporaryRoot}`);
  runPnpm(['install', '--frozen-lockfile', '--store-dir', sourceStore], { cwd: temporaryRoot });
  runPnpm(['lint'], { cwd: temporaryRoot });
  runPnpm(['test'], { cwd: temporaryRoot });
  runPnpm(['build'], { cwd: temporaryRoot });
  runPnpm(['test:toolchain'], { cwd: temporaryRoot });
  runPnpm(['test:pack'], { cwd: temporaryRoot });
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
