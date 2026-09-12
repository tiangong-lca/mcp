import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('../scripts/ci/release-context.sh', import.meta.url));

const CANONICAL = 'tiangong-lca/mcp';
const PREVIOUS_OWNER = 'linancn/tiangong-lca-mcp';
const FORK = 'some-fork/tiangong-lca-mcp';

// The release guard runs under GitHub's bash on ubuntu-latest. Execute it for real on
// platforms with bash; skip where bash is unavailable (for example Windows runners of
// quality-gate.yml) so the suite stays platform-honest instead of weakening coverage.
const bashProbe = spawnSync('bash', ['--version'], { encoding: 'utf8' });
const bashAvailable = bashProbe.status === 0;

let fixtureRoot;

before(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'mcp-release-context-'));
});

after(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout.trim();
}

function revExists(cwd, ref) {
  const result = spawnSync('git', ['rev-parse', '--verify', ref], { cwd, encoding: 'utf8' });
  return result.status === 0;
}

/** Local bare "origin" plus a work clone with two package.json commits; no network access. */
function createFixture({ baseVersion, headVersion }) {
  const name = `repo-${Math.random().toString(16).slice(2)}`;
  const origin = join(fixtureRoot, `${name}-origin.git`);
  const work = join(fixtureRoot, name);
  git(fixtureRoot, 'init', '--bare', origin);
  git(fixtureRoot, 'init', '-b', 'main', work);
  git(work, 'config', 'user.email', 'release-context@example.invalid');
  git(work, 'config', 'user.name', 'release-context test');
  git(work, 'config', 'commit.gpgsign', 'false');
  git(work, 'config', 'tag.gpgsign', 'false');
  git(work, 'remote', 'add', 'origin', origin);

  const packageJson = (version) =>
    JSON.stringify({ name: '@tiangong-lca/mcp-server', version }, null, 2) + '\n';
  writeFileSync(join(work, 'package.json'), packageJson(baseVersion));
  git(work, 'add', 'package.json');
  git(work, 'commit', '-m', `base ${baseVersion}`);
  const beforeSha = git(work, 'rev-parse', 'HEAD');
  if (headVersion !== baseVersion) {
    writeFileSync(join(work, 'package.json'), packageJson(headVersion));
    git(work, 'add', 'package.json');
    git(work, 'commit', '-m', `bump ${headVersion}`);
  }
  const headSha = git(work, 'rev-parse', 'HEAD');
  git(work, 'push', 'origin', 'main');
  return { origin, work, beforeSha, headSha, headVersion };
}

function runReleaseContext(
  fixture,
  {
    repository,
    ref = 'refs/heads/main',
    refName = 'main',
    eventName = 'push',
    requestedTag = '',
  } = {},
) {
  const outputPath = join(fixtureRoot, `output-${Math.random().toString(16).slice(2)}`);
  const summaryPath = join(fixtureRoot, `summary-${Math.random().toString(16).slice(2)}`);
  const result = spawnSync('bash', [scriptPath], {
    cwd: fixture.work,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_REPOSITORY: repository,
      GITHUB_EVENT_NAME: eventName,
      GITHUB_REF: ref,
      GITHUB_REF_NAME: refName,
      GITHUB_SHA: fixture.headSha,
      PUSH_BEFORE_SHA: fixture.beforeSha,
      REQUESTED_TAG_NAME: requestedTag,
      GITHUB_OUTPUT: outputPath,
      GITHUB_STEP_SUMMARY: summaryPath,
    },
  });
  const outputs = {};
  if (result.status === 0) {
    const content = readFileSync(outputPath, 'utf8');
    assert.notEqual(content.trim(), '', 'A successful release guard must write its decision.');
    for (const line of content.split('\n')) {
      const match = /^([^=]+)=(.*)$/u.exec(line);
      if (match) outputs[match[1]] = match[2];
    }
  }
  return { result, outputs };
}

describe(
  'release-context canonical guard (executed against real git fixtures)',
  { skip: !bashAvailable && 'bash is unavailable on this platform' },
  () => {
    it('allows the canonical tiangong-lca/mcp repository and creates the missing release tag', () => {
      const fixture = createFixture({ baseVersion: '0.2.0', headVersion: '0.2.1' });
      const { result, outputs } = runReleaseContext(fixture, { repository: CANONICAL });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(outputs.should_release, 'true');
      assert.equal(outputs.tag_created, 'true');
      assert.equal(outputs.tag_name, 'v0.2.1');
      assert.equal(outputs.release_head, fixture.headSha);
      assert.equal(git(fixture.origin, 'rev-parse', 'refs/tags/v0.2.1'), fixture.headSha);
    });

    it('keeps unchanged-version main pushes on the no-release path', () => {
      const fixture = createFixture({ baseVersion: '0.2.0', headVersion: '0.2.0' });
      const { result, outputs } = runReleaseContext(fixture, { repository: CANONICAL });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(outputs.should_release, 'false');
      assert.equal(outputs.tag_created, 'false');
      assert.equal(revExists(fixture.origin, 'refs/tags/v0.2.0'), false);
    });

    it('does not republish an existing version after a metadata-only main commit', () => {
      const fixture = createFixture({ baseVersion: '0.2.0', headVersion: '0.2.0' });
      git(fixture.work, 'tag', 'v0.2.0', fixture.headSha);
      git(fixture.work, 'push', 'origin', 'refs/tags/v0.2.0');
      writeFileSync(join(fixture.work, 'metadata.txt'), 'canonical repository update');
      git(fixture.work, 'add', 'metadata.txt');
      git(fixture.work, 'commit', '-m', 'metadata only');
      fixture.beforeSha = fixture.headSha;
      fixture.headSha = git(fixture.work, 'rev-parse', 'HEAD');
      git(fixture.work, 'push', 'origin', 'main');
      const { result, outputs } = runReleaseContext(fixture, { repository: CANONICAL });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(outputs.should_release, 'false');
      assert.equal(outputs.tag_created, 'false');
      assert.equal(git(fixture.origin, 'rev-parse', 'refs/tags/v0.2.0'), fixture.beforeSha);
    });

    it('refuses to publish a matching release tag outside main ancestry', () => {
      const fixture = createFixture({ baseVersion: '0.2.0', headVersion: '0.2.1' });
      git(fixture.work, 'checkout', '-b', 'off-main');
      writeFileSync(join(fixture.work, 'off-main.txt'), 'not promoted');
      git(fixture.work, 'add', 'off-main.txt');
      git(fixture.work, 'commit', '-m', 'off main');
      git(fixture.work, 'tag', 'v0.2.1');
      git(fixture.work, 'push', 'origin', 'refs/tags/v0.2.1');
      const { result, outputs } = runReleaseContext(fixture, {
        repository: CANONICAL,
        ref: 'refs/tags/v0.2.1',
        refName: 'v0.2.1',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(outputs.should_release, 'false');
    });

    it('uses the current decision script for an existing-tag manual recovery', () => {
      const fixture = createFixture({ baseVersion: '0.2.0', headVersion: '0.2.1' });
      git(fixture.work, 'tag', 'v0.2.1', fixture.headSha);
      git(fixture.work, 'push', 'origin', 'refs/tags/v0.2.1');
      const { result, outputs } = runReleaseContext(fixture, {
        repository: CANONICAL,
        eventName: 'workflow_dispatch',
        requestedTag: 'v0.2.1',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(outputs.should_release, 'true');
      assert.equal(outputs.tag_created, 'false');
    });

    it('rejects a manual tag that does not match its package version', () => {
      const fixture = createFixture({ baseVersion: '0.2.0', headVersion: '0.2.1' });
      git(fixture.work, 'tag', 'v9.9.9', fixture.headSha);
      git(fixture.work, 'push', 'origin', 'refs/tags/v9.9.9');
      const { result } = runReleaseContext(fixture, {
        repository: CANONICAL,
        eventName: 'workflow_dispatch',
        requestedTag: 'v9.9.9',
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /does not match package.json version/);
    });

    it('rejects the previous owner repository linancn/tiangong-lca-mcp', () => {
      const fixture = createFixture({ baseVersion: '0.2.0', headVersion: '0.2.1' });
      const { result, outputs } = runReleaseContext(fixture, { repository: PREVIOUS_OWNER });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(outputs.should_release, 'false');
      assert.equal(outputs.tag_created, 'false');
      assert.equal(revExists(fixture.origin, 'refs/tags/v0.2.1'), false);
    });

    it('rejects non-canonical fork repositories', () => {
      const fixture = createFixture({ baseVersion: '0.2.0', headVersion: '0.2.1' });
      const { result, outputs } = runReleaseContext(fixture, { repository: FORK });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(outputs.should_release, 'false');
      assert.equal(outputs.tag_created, 'false');
      assert.equal(revExists(fixture.origin, 'refs/tags/v0.2.1'), false);
    });

    it('still releases existing matching v* tags pushed to the canonical repository', () => {
      const fixture = createFixture({ baseVersion: '0.2.0', headVersion: '0.2.1' });
      git(fixture.work, 'tag', 'v0.2.1', fixture.headSha);
      git(fixture.work, 'push', 'origin', 'refs/tags/v0.2.1');
      const { result, outputs } = runReleaseContext(fixture, {
        repository: CANONICAL,
        ref: 'refs/tags/v0.2.1',
        refName: 'v0.2.1',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(outputs.should_release, 'true');
      assert.equal(outputs.tag_created, 'false');
      assert.equal(outputs.tag_name, 'v0.2.1');
    });
  },
);
