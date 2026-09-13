import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = new URL('../', import.meta.url);
const readText = (path) => readFileSync(new URL(path, repoRoot), 'utf8');
const pathExists = (path) => existsSync(fileURLToPath(new URL(path, repoRoot)));
const packageJson = JSON.parse(readText('package.json'));
const expectedPnpmVersion = '11.24.0';
const expectedPackageVersion = '0.2.1';

describe('pnpm and TypeScript 7 toolchain contract', () => {
  it('pins the workspace runtime and package manager', () => {
    assert.equal(packageJson.packageManager, `pnpm@${expectedPnpmVersion}`);
    assert.deepEqual(packageJson.engines, {
      node: '>=24.19.0 <25',
      pnpm: expectedPnpmVersion,
    });
    assert.equal(readText('.nvmrc').trim(), '24.19.0');
  });

  it('has one pnpm workspace lock and no npm lock', () => {
    assert.equal(pathExists('package-lock.json'), false);
    assert.equal(pathExists('pnpm-lock.yaml'), true);
    assert.equal(pathExists('pnpm-workspace.yaml'), true);
    const workspace = readText('pnpm-workspace.yaml');
    assert.match(workspace, /^packages:\s*\[\]\s*$/mu);
    assert.match(workspace, /^minimumReleaseAge:\s*1440\s*$/mu);
    assert.match(workspace, /^minimumReleaseAgeStrict:\s*true\s*$/mu);
    assert.doesNotMatch(workspace, /^\s*-\s*['"]?@oxlint\/binding-darwin-x64@/mu);
    assert.equal(readText('.gitattributes').trim(), '* text=auto eol=lf');
  });

  it('pins the latest compatible dependency graph and runtime-clean TIDAS SDK', () => {
    assert.equal(packageJson.devDependencies?.typescript, '7.0.2');
    assert.equal(packageJson.dependencies?.['@tiangong-lca/tidas-sdk'], '0.2.0');
    assert.equal(packageJson.dependencies?.['@upstash/redis'], undefined);
    assert.equal(packageJson.dependencies?.zod, '4.5.4');
    assert.equal(packageJson.devDependencies?.['@modelcontextprotocol/inspector'], '2.4.0');
    assert.equal(packageJson.devDependencies?.['@types/node'], '24.13.3');
    assert.equal(packageJson.devDependencies?.['react-dom'], '19.2.8');
    assert.equal(packageJson.devDependencies?.tsx, '4.23.13');
    assert.equal(packageJson.devDependencies?.oxlint, '1.80.0');
    assert.equal(packageJson.devDependencies?.['oxlint-tsgolint'], '7.0.2001');
    assert.equal(packageJson.devDependencies?.['prettier-plugin-organize-imports'], undefined);

    const lockfile = readText('pnpm-lock.yaml');
    assert.doesNotMatch(lockfile, /@upstash\/redis/u);
    assert.doesNotMatch(lockfile, /(?:^|\s)typescript@(?:5|6)\./mu);
    assert.doesNotMatch(lockfile, /(?:^|\s)ts-to-zod@/mu);
    const compilerVersions = new Set(
      [...lockfile.matchAll(/(?:^|\s)typescript@(\d+\.\d+\.\d+)/gmu)].map((match) => match[1]),
    );
    assert.deepEqual([...compilerVersions], ['7.0.2']);
  });

  it('keeps package scripts on pnpm and separates checks from writes', () => {
    const scripts = Object.values(packageJson.scripts ?? {}).join('\n');
    assert.doesNotMatch(scripts, /(?:^|\s)(?:npm|npx)(?:\s|$)/mu);
    assert.match(packageJson.scripts?.lint ?? '', /lint:oxlint/u);
    assert.match(packageJson.scripts?.lint ?? '', /lint:prettier/u);
    assert.equal(packageJson.scripts?.['peers:check'], 'pnpm peers check');
    assert.match(packageJson.scripts?.['prepush:gate'] ?? '', /pnpm peers:check/u);
    assert.match(packageJson.scripts?.['prepush:gate'] ?? '', /pnpm run audit(?:\s|$)/u);
    assert.equal(packageJson.scripts?.audit, 'pnpm audit --audit-level high');
    assert.doesNotMatch(packageJson.scripts?.lint ?? '', /--write/u);
    assert.match(packageJson.scripts?.format ?? '', /prettier --write/u);
    assert.doesNotMatch(packageJson.scripts?.['test:pack'] ?? '', />\s*\/dev\/null/u);
    assert.doesNotMatch(packageJson.scripts?.['start:server'] ?? '', /DANGEROUSLY_OMIT_AUTH=/u);
  });

  it('has no active npm package-management commands and defines four-platform CI', () => {
    const packageManagementSurfaces = [
      'README.md',
      'README_CN.md',
      'DEV_EN.md',
      'DEV_CN.md',
      'Dockerfile',
      '.github/workflows/publish.yml',
      '.github/workflows/quality-gate.yml',
    ];
    const forbiddenCommand =
      /(?:^|[\s"'`])(?:npm|npx)\s+(?:ci|install|run|test|start|pack|publish|version|exec)(?:\s|$)/mu;
    for (const path of packageManagementSurfaces) {
      assert.doesNotMatch(readText(path), forbiddenCommand, path);
    }

    const qualityGate = readText('.github/workflows/quality-gate.yml');
    for (const runner of ['ubuntu-latest', 'windows-latest', 'macos-latest', 'ubuntu-24.04-arm']) {
      assert.match(qualityGate, new RegExp(`os: ${runner}`, 'u'));
    }
    assert.match(qualityGate, /pnpm install --frozen-lockfile/u);
    assert.match(qualityGate, /pnpm run prepush:gate/u);

    for (const workflow of [qualityGate, readText('.github/workflows/publish.yml')]) {
      assert.match(workflow, /uses: pnpm\/setup@/u);
      assert.doesNotMatch(workflow, /^\s+version:\s*/mu);
    }

    assert.match(
      readText('Dockerfile'),
      new RegExp(
        `corepack install --global pnpm@${expectedPnpmVersion.replaceAll('.', '\\.')}\\b`,
        'u',
      ),
    );
  });

  it('creates the Corepack pnpm shim before activating and using the exact version', () => {
    const dockerfile = readText('Dockerfile');
    const osUpgradeIndex = dockerfile.indexOf('apk upgrade --no-cache');
    const osReadbackIndex = dockerfile.indexOf('apk list --installed libssl3 libcrypto3');
    const enableIndex = dockerfile.indexOf('corepack enable pnpm');
    const installIndex = dockerfile.indexOf(
      `corepack install --global pnpm@${expectedPnpmVersion}`,
    );
    const versionIndex = dockerfile.indexOf('pnpm --version');
    const addIndex = dockerfile.indexOf(
      `pnpm add --global @tiangong-lca/mcp-server@${expectedPackageVersion}`,
    );

    assert.match(dockerfile, /ENV PATH="\$PNPM_HOME\/bin:\$PNPM_HOME:\$PATH"/u);
    assert.ok(osUpgradeIndex >= 0);
    assert.ok(osReadbackIndex > osUpgradeIndex);
    assert.ok(enableIndex > osReadbackIndex);
    assert.ok(installIndex > enableIndex);
    assert.ok(versionIndex > installIndex);
    assert.ok(addIndex > versionIndex);
  });

  it('binds the 0.2.1 release across package, Docker, and active docs', () => {
    assert.equal(packageJson.version, expectedPackageVersion);
    const surfaces = ['Dockerfile', 'README.md', 'README_CN.md', 'DEV_EN.md', 'DEV_CN.md'];
    for (const surface of surfaces) {
      const text = readText(surface);
      assert.match(text, /0\.2\.1/u, surface);
      assert.doesNotMatch(
        text,
        /(?:mcp-server|tiangong-lca-mcp):(?!(?:0\.2\.1)\b)\d+\.\d+\.\d+/u,
        surface,
      );
    }
    assert.match(readText('Dockerfile'), /pnpm add --global @tiangong-lca\/mcp-server@0\.2\.1/u);
    for (const maintainerDoc of ['DEV_EN.md', 'DEV_CN.md']) {
      const text = readText(maintainerDoc);
      const scanGateIndex = text.indexOf('if [ "${scan_gate}" != "${expected_scan_gate}" ]; then');
      const dockerRunIndex = text.indexOf(
        'docker run -d -p 9278:9278 --env-file .env "${image_uri}:${image_tag}"',
      );
      const existingScanIndex = text.indexOf('scan_status="$(aws ecr describe-image-scan-findings');
      const startScanIndex = text.indexOf('aws ecr start-image-scan');
      const waitScanIndex = text.indexOf('aws ecr wait image-scan-complete');
      const scanNotFoundIndex = text.indexOf('*ScanNotFoundException*)');
      const probeFailureIndex = text.indexOf('ECR scan probe failed: %s');
      assert.match(text, /image_tag="direct-oauth-\$\(git rev-parse --short=12 HEAD\)-v0\.2\.1"/u);
      assert.match(text, /docker build --no-cache --provenance=false --platform linux\/arm64/u);
      assert.match(text, /imageManifestMediaType/u);
      assert.match(text, /aws ecr start-image-scan/u);
      assert.match(text, /aws ecr wait image-scan-complete/u);
      assert.match(text, /aws ecr describe-image-scan-findings/u);
      assert.match(text, /set -euo pipefail/u);
      assert.match(text, /exit 1/u);
      assert.ok(scanGateIndex >= 0);
      assert.ok(dockerRunIndex > scanGateIndex);
      assert.ok(existingScanIndex >= 0);
      assert.ok(scanNotFoundIndex > existingScanIndex);
      assert.ok(startScanIndex > existingScanIndex);
      assert.ok(startScanIndex > scanNotFoundIndex);
      assert.ok(probeFailureIndex > startScanIndex);
      assert.ok(waitScanIndex > startScanIndex);
      assert.match(text, /exit "\$\{scan_probe_status\}"/u);
      assert.doesNotMatch(text, /docker build --no-cache --platform linux\/arm64/u);
      assert.equal(text.match(/"\$\{image_uri\}:\$\{image_tag\}"/gu)?.length, 3);
      assert.equal(text.match(/"imageTag=\$\{image_tag\}"/gu)?.length, 5);
      assert.doesNotMatch(
        text,
        /339712838008\.dkr\.ecr\.us-east-1\.amazonaws\.com\/tiangong-lca-mcp:0\.1\.2/u,
      );
    }
  });
});
