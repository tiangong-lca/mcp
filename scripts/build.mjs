#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const distDir = fileURLToPath(new URL('../dist', import.meta.url));

rmSync(distDir, { recursive: true, force: true });

if (process.argv.includes('--clean')) {
  process.exit(0);
}

const tscPath = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const compiler = spawnSync(process.execPath, [tscPath, '--project', 'tsconfig.build.json'], {
  cwd: repoRoot,
  encoding: 'utf8',
  stdio: 'inherit',
});

if (compiler.error) {
  throw compiler.error;
}
if (compiler.status !== 0) {
  process.exit(compiler.status ?? 1);
}

cpSync(fileURLToPath(new URL('../public', import.meta.url)), `${distDir}/public`, {
  recursive: true,
});

cpSync(
  fileURLToPath(new URL('../src/_shared/study_contract', import.meta.url)),
  `${distDir}/src/_shared/study_contract`,
  { recursive: true },
);

if (process.platform !== 'win32') {
  for (const entry of ['index.js', 'index_server.js', 'index_server_local.js']) {
    const entryPath = `${distDir}/src/${entry}`;
    if (existsSync(entryPath)) {
      chmodSync(entryPath, 0o755);
    }
  }
}
