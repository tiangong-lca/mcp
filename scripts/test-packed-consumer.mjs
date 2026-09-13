#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runPnpm } from './lib/run-pnpm.mjs';

const repoRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'tiangong mcp packed consumer '));
const packDirectory = join(temporaryRoot, 'package archive');

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function stopChild(child) {
  if (process.platform === 'win32' && child.pid !== undefined) {
    const result = spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      encoding: 'utf8',
      shell: false,
      stdio: 'pipe',
    });
    if (result.status !== 0 && child.exitCode === null && child.signalCode === null) {
      throw new Error(
        `Unable to stop packed HTTP process tree (status=${result.status}, stderr=${result.stderr.trim() || '<empty>'}).`,
      );
    }
    if (child.exitCode === null && child.signalCode === null) {
      await Promise.race([once(child, 'exit'), delay(5_000)]);
    }
    return;
  }
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'exit'),
    delay(5_000).then(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }),
  ]);
}

async function assertPackedHttpBinStarts(globalBinDirectory, globalEnvironment) {
  const port = await reserveLoopbackPort();
  const binPath = join(
    globalBinDirectory,
    process.platform === 'win32' ? 'tiangong-lca-mcp-http.CMD' : 'tiangong-lca-mcp-http',
  );
  assert.equal(existsSync(binPath), true, binPath);
  const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : binPath;
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'call', binPath] : [];
  const child = spawn(command, args, {
    cwd: temporaryRoot,
    env: {
      ...globalEnvironment,
      HOST: '127.0.0.1',
      MCP_OAUTH_ALLOWED_CLIENT_IDS_JSON: JSON.stringify(['11111111-1111-4111-8111-111111111111']),
      MCP_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
      PORT: String(port),
      SUPABASE_BASE_URL: 'https://packed-consumer.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  try {
    const deadline = Date.now() + 10_000;
    let response;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `Packed HTTP bin exited before health check (code=${child.exitCode}, signal=${child.signalCode}, stdout=${stdout.trim() || '<empty>'}, stderr=${stderr.trim() || '<empty>'}).`,
        );
      }
      try {
        const requestTimeout = Math.max(1, Math.min(1_000, deadline - Date.now()));
        response = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(requestTimeout),
        });
        if (response.ok) {
          break;
        }
      } catch {
        // The process may still be binding the loopback socket.
      }
      await delay(100);
    }

    assert.notEqual(response, undefined, 'Packed HTTP bin did not answer /health in time.');
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.status, 'ok');
    assert.equal(typeof health.timestamp, 'string');
    assert.match(health.timestamp, /^\d{4}-\d{2}-\d{2}T/u);
    assert.equal(child.exitCode, null);
  } finally {
    await stopChild(child);
  }
}

try {
  mkdirSync(packDirectory, { recursive: true });
  runPnpm(['pack', '--pack-destination', packDirectory], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'));
  assert.equal(tarballs.length, 1);
  const tarball = join(packDirectory, tarballs[0]);
  const globalPnpmHome = join(temporaryRoot, 'global pnpm home');
  const globalBinDirectory = join(globalPnpmHome, 'bin');
  const globalEnvironment = {
    ...process.env,
    PATH: `${globalBinDirectory}${delimiter}${process.env.PATH ?? ''}`,
    PNPM_HOME: globalPnpmHome,
  };

  writeFileSync(
    join(temporaryRoot, 'package.json'),
    JSON.stringify({ name: 'mcp-packed-consumer-test', private: true, type: 'module' }),
  );
  runPnpm(['add', '--prod', tarball], { cwd: temporaryRoot, stdio: 'pipe' });
  runPnpm(['add', '--global', '--prod', tarball], {
    cwd: temporaryRoot,
    env: globalEnvironment,
    stdio: 'pipe',
  });

  const packageRoot = join(temporaryRoot, 'node_modules', '@tiangong-lca', 'mcp-server');
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.name, '@tiangong-lca/mcp-server');
  assert.equal(packageJson.version, '0.2.1');
  assert.equal(packageJson.dependencies['@tiangong-lca/tidas-sdk'], '0.2.0');
  for (const runtimeFile of [
    'dist/src/_shared/oauth_runtime.js',
    'dist/src/_shared/supabase_jwt_verifier.js',
    'dist/src/http_app.js',
  ]) {
    assert.equal(existsSync(join(packageRoot, runtimeFile)), true, runtimeFile);
  }
  for (const removedRuntimeFile of [
    'dist/src/auth_app.js',
    'dist/src/_shared/oauth_broker_store.js',
    'dist/src/_shared/supabase_oauth_broker.js',
    'dist/src/_shared/supabase_session.js',
    'dist/src/_shared/auth_middleware.js',
    'dist/src/_shared/cognito_auth.js',
    'dist/src/_shared/decode_api_key.js',
  ]) {
    assert.equal(existsSync(join(packageRoot, removedRuntimeFile)), false, removedRuntimeFile);
  }
  for (const tool of [
    'typescript',
    'tsx',
    'oxlint',
    'oxlint-tsgolint',
    '@modelcontextprotocol/inspector',
    'react',
    'react-dom',
  ]) {
    assert.equal(existsSync(join(temporaryRoot, 'node_modules', tool)), false, tool);
  }

  await import(pathToFileURL(join(packageRoot, 'dist', 'src', 'index.js')).href);
  await import(pathToFileURL(join(packageRoot, 'dist', 'src', 'index_server.js')).href);
  await import(pathToFileURL(join(packageRoot, 'dist', 'src', 'index_server_local.js')).href);
  await assertPackedHttpBinStarts(globalBinDirectory, globalEnvironment);
} finally {
  rmSync(temporaryRoot, { force: true, maxRetries: 10, recursive: true, retryDelay: 100 });
}
