import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceStore =
  process.platform === 'win32'
    ? `${path.parse(tmpdir()).root.toLowerCase() === 'd:\\' ? 'C' : 'D'}:\\source package store\\v11`
    : '/source package store/v11';

function traceCleanWorktree(t, settings = {}) {
  const fixture = mkdtempSync(path.join(tmpdir(), 'mcp store trace '));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const tracePath = path.join(fixture, 'trace.json');
  const driver = path.join(fixture, 'driver.mjs');
  writeFileSync(
    driver,
    `
import fs from 'node:fs';
import cp from 'node:child_process';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
const settings = JSON.parse(process.env.MCP_STORE_TEST_SETTINGS);
const records = [];
const originalMkdtemp = fs.mkdtempSync;
const originalRemove = fs.rmSync;
let temporaryRoot;
fs.mkdtempSync = (prefix, ...rest) => {
  const result = originalMkdtemp(prefix, ...rest);
  temporaryRoot = result;
  records.push({ kind: 'temporary-root', path: result });
  return result;
};
fs.rmSync = (target, options) => {
  records.push({ kind: 'cleanup', path: target });
  return originalRemove(target, options);
};
const bin = path.join(path.dirname(process.env.MCP_STORE_TRACE), 'bin');
fs.mkdirSync(bin);
const pnpm = path.join(bin, process.platform === 'win32' ? 'pnpm.exe' : 'pnpm');
fs.writeFileSync(pnpm, Buffer.from(process.platform === 'win32' ? '4d5a0000' : '7f454c46', 'hex'), { mode: 0o755 });
process.env.PATH = bin;
delete process.env.COREPACK_ROOT;
cp.spawnSync = (command, args, options) => {
  if (command === 'git') {
    records.push({ kind: 'git', args, cwd: options.cwd });
    return { status: 0, stdout: Buffer.from('package.json\\0pnpm-lock.yaml\\0pnpm-workspace.yaml\\0'), stderr: '' };
  }
  if (args.length === 1 && args[0] === '--version') {
    return { status: 0, stdout: (settings.version ?? '11.24.0') + '\\n', stderr: '' };
  }
  records.push({ kind: 'pnpm', args, cwd: options.cwd, shell: options.shell,
    hasNodeModules: fs.existsSync(path.join(options.cwd, 'node_modules')),
    lock: fs.readFileSync(path.join(options.cwd, 'pnpm-lock.yaml'), 'utf8') });
  if (args.includes('store') && args.includes('path')) {
    const checkingTarget = args.includes('--store-dir');
    if (settings.failDiscovery === (checkingTarget ? 'target' : 'source')) {
      return { status: 17, stdout: '', stderr: 'store discovery interrupted' };
    }
    return { status: 0, stdout: checkingTarget
      ? (settings.targetStore ?? settings.sourceStore)
      : settings.sourceStore, stderr: '' };
  }
  if (args[0] === settings.failGate) {
    return { status: 23, stdout: '', stderr: 'required gate failed' };
  }
  if (args[0] === 'install') {
    fs.mkdirSync(path.join(options.cwd, 'node_modules'));
  }
  return { status: 0, stdout: '', stderr: '' };
};
syncBuiltinESMExports();
try {
  await import(pathToFileURL(process.env.MCP_STORE_ENTRY));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(process.env.MCP_STORE_TRACE, JSON.stringify({ records,
    temporaryRoot, temporaryRootExists: temporaryRoot && fs.existsSync(temporaryRoot) }));
}
`,
  );
  const result = spawnSync(process.execPath, [driver], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      MCP_STORE_ENTRY: path.join(repoRoot, 'scripts/test-clean-worktree.mjs'),
      MCP_STORE_TRACE: tracePath,
      MCP_STORE_TEST_SETTINGS: JSON.stringify({ sourceStore: `${sourceStore}\n`, ...settings }),
    },
  });
  assert.ifError(result.error);
  const trace = JSON.parse(readFileSync(tracePath, 'utf8'));
  assert.equal(trace.temporaryRootExists, false, 'owned temporary worktree must be removed');
  assert.equal(trace.records.filter((record) => record.kind === 'cleanup').length, 1);
  return { ...result, ...trace, calls: trace.records.filter((record) => record.kind === 'pnpm') };
}

test('real clean-worktree entrypoint shares only the source store and retains a fresh frozen install', (t) => {
  const result = traceCleanWorktree(t);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    result.calls.map((call) => call.args),
    [
      ['store', 'path'],
      ['--store-dir', sourceStore, 'store', 'path'],
      ['install', '--frozen-lockfile', '--store-dir', sourceStore],
      ['lint'],
      ['test'],
      ['build'],
      ['test:toolchain'],
      ['test:pack'],
    ],
  );
  assert.equal(result.calls[0].cwd, repoRoot.replace(/[\\/]$/u, ''));
  const temporaryRoot = result.temporaryRoot;
  assert.ok(temporaryRoot.includes('tiangong mcp clean worktree '));
  assert.notEqual(temporaryRoot, result.calls[0].cwd);
  assert.ok(result.calls.slice(1).every((call) => call.cwd === temporaryRoot));
  assert.equal(result.calls[2].hasNodeModules, false);
  assert.ok(result.calls.slice(3).every((call) => call.hasNodeModules));
  assert.ok(result.calls.every((call) => call.shell === false));
  assert.ok(result.calls.every((call) => call.lock === result.calls[0].lock));
  if (process.platform === 'win32') {
    // GitHub's D: checkout/C: OS-temp qualification must remain cross-volume.
    assert.notEqual(
      path.parse(temporaryRoot).root.toLowerCase(),
      path.parse(sourceStore).root.toLowerCase(),
    );
  }
});

test('missing, malformed, failed or changed store discovery cannot run installation', (t) => {
  for (const settings of [
    { sourceStore: '' },
    { sourceStore: '\n' },
    { sourceStore: 'relative/store\n' },
    { sourceStore: `${sourceStore}\nextra-output\n` },
    { sourceStore: `${sourceStore}\u0000\n` },
    { failDiscovery: 'source' },
    { failDiscovery: 'target' },
    { targetStore: `${sourceStore}${path.sep}v11\n` },
    { targetStore: '' },
    { targetStore: 'relative/store\n' },
    { version: '11.23.0' },
  ]) {
    const result = traceCleanWorktree(t, settings);
    assert.notEqual(result.status, 0, JSON.stringify(settings));
    assert.equal(
      result.calls.some((call) => call.args[0] === 'install'),
      false,
    );
  }
});

test('frozen install and every later original gate still fail and clean up without continuation', (t) => {
  const gates = ['install', 'lint', 'test', 'build', 'test:toolchain', 'test:pack'];
  for (const [index, failGate] of gates.entries()) {
    const result = traceCleanWorktree(t, { failGate });
    assert.notEqual(result.status, 0, failGate);
    assert.match(result.stderr, /required gate failed/u);
    const executed = result.calls.filter((call) => gates.includes(call.args[0]));
    assert.deepEqual(
      executed.map((call) => call.args[0]),
      gates.slice(0, index + 1),
    );
    assert.ok(executed[0].args.includes('--frozen-lockfile'));
  }
});
