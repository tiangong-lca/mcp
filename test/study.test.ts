import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, it, mock } from 'node:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadStudyCodec } from '../src/_shared/study_codec.js';
import {
  callStudy,
  regStudyTool,
  STUDY_ARTIFACT_MAX_BYTES,
  STUDY_REQUEST_MAX_BYTES,
  STUDY_RESPONSE_MAX_BYTES,
} from '../src/tools/study.js';
import { connectInMemory } from './helpers/mcp-client.js';
import { createHttpApp, MCP_HTTP_REQUEST_MAX_BYTES } from '../src/http_app.js';
import { withHttpServer } from './helpers/http-server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import methodFixture from './fixtures/study-method.json' with { type: 'json' };
import { readFileSync } from 'node:fs';
import { initializeServer as initializeHttpServer } from '../src/_shared/init_server_http.js';
import { initializeServer as initializeStdioServer } from '../src/_shared/init_server.js';
import { initializeServer as initializeLocalServer } from '../src/_shared/init_server_http_local.js';

type Request = Parameters<typeof callStudy>[0]['request'];
type Output = Record<string, unknown>;
const actor = 'sentinel-actor-access-token';
const publishableKey = 'sb_publishable_fixture';
const endpoint = 'http://127.0.0.1:9191/functions/v1/app_lca_study';
const signal = () => new AbortController().signal;
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const request = (version: 2 | 3 | 4 | 5 | 6 = 2): Request => ({
  schemaVersion: `lca.study-api.v${version}`,
  requestId: `request-${version}`,
  operation: 'capability.read',
});
const capabilities = (version = 2) => ({
  schemaVersion: `lca.study-api.v${version}`,
  requestId: `request-${version}`,
  ok: true,
  data: {
    type: 'capabilities',
    contractVersion: `${version}.0.0`,
    runtimeEnabled: false,
    operations: ['capability.read'],
    ...(version === 2 ? { profiles: [] } : {}),
    ...(version === 3 || version === 5 ? { analysisProfiles: [], reportTemplates: [] } : {}),
    ...(version === 6
      ? {
          methodProfiles: [],
          reportTemplates: [],
          limits: {
            maxEvidenceRefs: 0,
            maxSelectedFactorRecords: 0,
            maxFactsBytes: 4194304,
            maxProjectionBytes: 2000000,
          },
        }
      : {}),
    ...(version >= 4
      ? { finalizationProfiles: [], reviewClasses: [], disclosurePolicies: [] }
      : {}),
  },
});
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const answer =
  (value: unknown, status = 200): typeof fetch =>
  async () =>
    json(value, status);
const invoke = (
  value: Request,
  fetcher: typeof fetch,
  extra: Partial<Parameters<typeof callStudy>[0]> = {},
) =>
  callStudy({ request: value, ...extra }, actor, signal(), {
    fetch: fetcher,
    endpoint,
    publishableKey,
  });
const mutation = (): Request => ({
  ...request(),
  operation: 'study.create',
  idempotencyKey: 'stable-original-key',
  scope: { kind: 'personal' },
  title: 'An immutable workflow study',
});
const denial = (value: Request) => ({
  schemaVersion: value.schemaVersion,
  requestId: value.requestId,
  ok: false,
  code: 'FORBIDDEN',
  message: 'provider sentinel-secret-token https://private-provider.invalid/stack',
  retryable: false,
  issues: [{ code: 'FORBIDDEN', path: '/sentinel-private-path', ruleId: 'sentinel-rule' }],
});
const mutationSuccess = () => ({
  schemaVersion: 'lca.study-api.v2',
  requestId: 'request-2',
  ok: true,
  data: {
    type: 'study',
    value: {
      studyId: 'study-new',
      revision: 1,
      scope: { kind: 'user', id: 'actor-id' },
      title: 'An immutable workflow study',
      status: 'active',
      currentRevisionId: null,
    },
  },
});

async function assertOwnerPair(value: Request, response: unknown): Promise<void> {
  const codec = await loadStudyCodec(value.schemaVersion);
  const parsed = codec.parseRequest(value);
  codec.validateResponseForRequest(parsed, codec.parseResponse(response));
}

function artifact(size: number, type = 'modelInput') {
  const bytes = Buffer.alloc(size, 97);
  const artifactRef = {
    type,
    id: 'artifact-1',
    contentHash: sha(bytes),
    digestScope: 'artifact_bytes_sha256',
    byteSize: bytes.length,
    mediaType: 'application/json',
    schemaVersion: 'lca.study-prepared-input.v1',
  };
  const value: Request = {
    ...request(),
    operation: 'artifact.read',
    studyId: 'study-1',
    artifactRef,
  };
  return {
    bytes,
    request: value,
    response: {
      schemaVersion: value.schemaVersion,
      requestId: value.requestId,
      ok: true,
      data: {
        type: 'artifact',
        studyId: 'study-1',
        artifactRef,
        encoding: 'base64',
        bytes: bytes.toString('base64'),
      },
    },
  };
}

describe('Study owner protocol adapter', () => {
  it('discovers exact bounded owner schemas through SDK resources and preserves existing resource surfaces', async () => {
    for (const [server, hasStudy, hasOpenLca] of [
      [initializeHttpServer(actor), true, false],
      [initializeStdioServer(actor), true, true],
      [initializeLocalServer(), false, true],
    ] as const) {
      const connection = await connectInMemory(server);
      try {
        const resources = await connection.client.listResources();
        assert.equal(
          resources.resources.some((r) => r.uri === 'resource://openlca'),
          hasOpenLca,
        );
        const schemas = resources.resources.filter((r) =>
          r.uri.startsWith('tiangong-study://schema/'),
        );
        assert.equal(schemas.length, hasStudy ? 5 : 0);
        if (!hasStudy) continue;
        for (const version of ['v2', 'v3', 'v4', 'v5', 'v6']) {
          const uri = `tiangong-study://schema/${version}/request`;
          const resource = schemas.find((item) => item.uri === uri);
          assert.equal(resource?.name, `Study_Request_Schema_${version}`);
          assert.match(resource?.title ?? '', /^LCA calculation:/u);
          const result = await connection.client.readResource({ uri });
          assert.equal(result.contents.length, 1);
          const content = result.contents[0];
          assert.equal(content.uri, uri);
          assert.equal(content.mimeType, 'application/schema+json');
          assert.ok('text' in content);
          const original = readFileSync(
            new URL(
              `../src/_shared/study_contract/${version}/request.schema.json`,
              import.meta.url,
            ),
          );
          assert.ok(original.length < 256 * 1024);
          assert.equal(sha(content.text), sha(original));
          assert.equal(JSON.parse(content.text).$schema, 'http://json-schema.org/draft-07/schema#');
        }
        const contractUri = 'tiangong-study://consumer/contract';
        const contractResource = resources.resources.find((item) => item.uri === contractUri);
        assert.equal(contractResource?.name, 'Study_Consumer_Contract');
        assert.match(contractResource?.title ?? '', /^LCA calculation:/u);
        const contract = await connection.client.readResource({ uri: contractUri });
        assert.ok('text' in contract.contents[0]);
        assert.match(contract.contents[0].text, /priorUncertainRequestSha256/u);
        assert.match(contract.contents[0].text, /4MiB/u);
        await assert.rejects(
          connection.client.readResource({ uri: 'tiangong-study://schema/v999/request' }),
        );
      } finally {
        await connection.close();
      }
    }
  });

  for (const version of [2, 3, 4, 5, 6] as const) {
    it(`round-trips exact V${version} capability and preserves disabled runtime state`, async () => {
      const value = request(version);
      const response = capabilities(version);
      await assertOwnerPair(value, response);
      let calls = 0;
      const output = await invoke(value, async (url, options) => {
        calls++;
        assert.equal(url, endpoint);
        assert.equal(options?.method, 'POST');
        assert.equal(options?.redirect, 'error');
        assert.equal(new Headers(options?.headers).get('authorization'), `Bearer ${actor}`);
        assert.equal(typeof options?.body, 'string');
        assert.deepEqual(JSON.parse(options?.body as string), value);
        return json(response);
      });
      assert.equal(calls, 1);
      assert.equal(output.ok, true);
      assert.deepEqual(output.response, response);
      assert.equal(output.requestSha256, sha(JSON.stringify(value)));
    });
  }

  it('forwards exact V6 assessment/evidence and read selections without upgrading their qualification', async () => {
    const pairs: Array<[Request, unknown]> = [
      [methodFixture.assessmentRequest as Request, methodFixture.assessmentData],
      [methodFixture.evidenceRequest as Request, methodFixture.evidenceData],
      [
        {
          ...request(6),
          operation: 'method.assessment.read',
          assessmentId: methodFixture.assessmentData.value.assessmentId,
        },
        methodFixture.assessmentData,
      ],
      [
        {
          ...request(6),
          operation: 'method.evidence.read',
          evidenceId: methodFixture.evidenceData.value.evidenceId,
        },
        methodFixture.evidenceData,
      ],
      [
        {
          ...request(6),
          operation: 'report.read',
          reportRevisionId: methodFixture.reportData.value.reportRevisionId,
        },
        methodFixture.reportData,
      ],
    ];
    for (const [value, data] of pairs) {
      const response = {
        schemaVersion: value.schemaVersion,
        requestId: value.requestId,
        ok: true,
        data,
      };
      await assertOwnerPair(value, response);
      const output = await invoke(value, async (_url, options) => {
        assert.equal(typeof options?.body, 'string');
        assert.deepEqual(JSON.parse(options?.body as string), value);
        assert.equal(new Headers(options?.headers).get('authorization'), `Bearer ${actor}`);
        return json(response);
      });
      assert.equal(output.outcome, 'confirmed');
      assert.deepEqual(output.response, response);
    }
    assert.equal(methodFixture.evidenceData.value.status, 'recorded_unverified');
    assert.equal(
      methodFixture.assessmentRequest.config.declarations.categoryRule.kind,
      'noneEstablished',
    );
  });

  it('preserves V6 evidence Unicode and rejects unknown approval, byte overflow and cross-family fields before I/O', async () => {
    const value = {
      ...methodFixture.evidenceRequest,
      content: {
        ...methodFixture.evidenceRequest.content,
        title: '原始声明🌏',
        statement: 'Recorded statement — not scientific approval.',
      },
    } as Request;
    let calls = 0;
    assert.equal(
      (
        await invoke(value, async (_url, options) => {
          calls++;
          assert.equal(typeof options?.body, 'string');
          assert.deepEqual(JSON.parse(options?.body as string), value);
          return json(denial(value), 403);
        })
      ).code,
      'FORBIDDEN',
    );
    const bad = [
      { ...value, schemaVersion: 'lca.study-api.v5' },
      { ...value, content: { ...methodFixture.evidenceRequest.content, scientificApproval: true } },
      { ...value, content: { ...methodFixture.evidenceRequest.content, title: '\ud800' } },
      {
        ...value,
        content: { ...methodFixture.evidenceRequest.content, statement: 'x'.repeat(65537) },
      },
      {
        ...methodFixture.assessmentRequest,
        config: { ...methodFixture.assessmentRequest.config, absenceMeansZero: true },
      },
      { ...methodFixture.assessmentRequest, operation: 'analysis.request' },
    ] as Request[];
    for (const invalid of bad) {
      const output = await invoke(invalid, async () => {
        calls++;
        throw new Error('unexpected fetch');
      });
      assert.equal(output.code, 'STUDY_INVALID_REQUEST');
      assert.equal(output.outcome, 'not_dispatched');
    }
    assert.equal(calls, 1);
  });

  it('rejects V6 method selection and export review-CAS substitutions without returning mismatched content', async () => {
    const assessment = methodFixture.assessmentRequest as Request;
    const response = {
      schemaVersion: assessment.schemaVersion,
      requestId: assessment.requestId,
      ok: true,
      data: methodFixture.assessmentData,
    };
    for (const field of ['studyId', 'configHash'] as const) {
      const wrong = structuredClone(response);
      wrong.data.value[field] =
        field === 'studyId' ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : 'a'.repeat(64);
      const output = await invoke(assessment, answer(wrong));
      assert.equal(output.code, 'STUDY_INVALID_RESPONSE');
      assert.equal(output.outcome, 'unknown');
      assert.equal('response' in output, false);
    }
    const value = methodFixture.exportRequest as Request;
    const exported = {
      schemaVersion: value.schemaVersion,
      requestId: value.requestId,
      ok: true,
      data: methodFixture.exportData,
    };
    await assertOwnerPair(value, exported);
    assert.equal((await invoke(value, answer(exported))).ok, true);
    const output = await invoke(
      { ...value, expectedReviewStateHash: 'f'.repeat(64) },
      answer(exported),
    );
    assert.equal(output.code, 'STUDY_INVALID_RESPONSE');
    assert.equal(output.outcome, 'unknown');
    assert.equal('response' in output, false);
  });

  it('uses owner async identities for exact evidence receipt bytes and rejects an inconsistent method config before dispatch', async () => {
    const value = methodFixture.evidenceRequest as Request;
    const response = {
      schemaVersion: value.schemaVersion,
      requestId: value.requestId,
      ok: true,
      data: methodFixture.evidenceData,
    };
    assert.equal((await invoke(value, answer(response))).ok, true);
    for (const patch of [
      { contentHash: 'f'.repeat(64) },
      { byteSize: methodFixture.evidenceData.value.artifactRef.byteSize + 1 },
    ]) {
      const bad = structuredClone(response);
      Object.assign(bad.data.value.artifactRef, patch);
      const output = await invoke(value, answer(bad));
      assert.equal(output.code, 'STUDY_INVALID_RESPONSE');
      assert.equal(output.outcome, 'unknown');
      assert.equal('response' in output, false);
    }
    let calls = 0;
    const invalid = { ...methodFixture.assessmentRequest, configHash: 'f'.repeat(64) } as Request;
    const rejected = await invoke(invalid, async () => {
      calls++;
      throw new Error('must not dispatch');
    });
    assert.equal(rejected.code, 'STUDY_INVALID_REQUEST');
    assert.equal(rejected.outcome, 'not_dispatched');
    assert.equal(calls, 0);
  });

  it('rejects malformed Unicode in V6 report authoring through owner validation before any dispatch', async () => {
    const codec = await loadStudyCodec('lca.study-api.v6');
    const create = methodFixture.reportCreateRequest as Request;
    const save = {
      ...request(6),
      operation: 'report.save',
      idempotencyKey: 'save-unicode',
      target: {
        type: 'reportRevision',
        id: methodFixture.reportData.value.reportRevisionId,
        expectedRevision: 2,
      },
      content: structuredClone(methodFixture.reportCreateRequest.content),
    } as Request;
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      throw new Error('invalid content dispatched');
    };
    for (const original of [create, save]) {
      codec.parseRequest(original);
      const positive = structuredClone(original);
      const content = positive.content as typeof methodFixture.reportCreateRequest.content;
      content.title = '🌏'.repeat(256);
      codec.parseRequest(positive);
      for (const value of ['\ud800', '\udfff']) {
        for (const field of ['title', 'paragraph', 'unit']) {
          const invalid = structuredClone(original);
          const c = invalid.content as typeof methodFixture.reportCreateRequest.content;
          if (field === 'title') c.title = value;
          else if (field === 'paragraph') c.sections[0].paragraphs[0] = value;
          else c.claims[0].unit = value;
          const result = await invoke(invalid, fetcher);
          assert.equal(result.code, 'STUDY_INVALID_REQUEST');
          assert.equal(result.outcome, 'not_dispatched');
        }
      }
    }
    assert.equal(calls, 0);
  });

  it('keeps an uncertain V6 method mutation bound to its exact family and original request across denial', async () => {
    const value = methodFixture.assessmentRequest as Request;
    const first = await invoke(value, async () => {
      throw new Error('lost response after possible commit');
    });
    assert.equal(first.outcome, 'unknown');
    const recovery = first.recovery as Output;
    assert.equal(recovery.schemaVersion, 'lca.study-api.v6');
    const prior = { priorUncertainRequestSha256: String(recovery.requestSha256) };
    const denied = await invoke(value, answer(denial(value), 403), prior);
    assert.equal(denied.outcome, 'unknown');
    assert.deepEqual(denied.recovery, recovery);
    assert.equal(JSON.stringify(denied).includes('sentinel-secret'), false);
    let changedCalls = 0;
    const changed = await invoke(
      { ...value, idempotencyKey: 'new-key' },
      async () => {
        changedCalls++;
        throw new Error('must not dispatch');
      },
      prior,
    );
    assert.equal(changed.code, 'STUDY_RECOVERY_REQUEST_MISMATCH');
    assert.equal(changed.outcome, 'unknown');
    assert.equal(changedCalls, 0);
    const success = {
      schemaVersion: value.schemaVersion,
      requestId: value.requestId,
      ok: true,
      data: methodFixture.assessmentData,
    };
    const replay = await invoke(value, answer(success), prior);
    assert.equal(replay.outcome, 'confirmed');
    assert.deepEqual(replay.response, success);
  });

  it('verifies exact opaque V6 method-facts bytes at the original 4MiB transport bound', async () => {
    const fixture = artifact(STUDY_ARTIFACT_MAX_BYTES, 'methodAssessmentFacts');
    fixture.request.schemaVersion = 'lca.study-api.v6';
    fixture.request.studyId = methodFixture.assessmentRequest.studyId;
    fixture.response.schemaVersion = 'lca.study-api.v6';
    fixture.response.data.studyId = methodFixture.assessmentRequest.studyId;
    fixture.response.data.artifactRef.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    fixture.response.data.artifactRef.schemaVersion = 'lca.study-method-assessment-facts.v1';
    await assertOwnerPair(fixture.request, fixture.response);
    assert.equal((await invoke(fixture.request, answer(fixture.response))).ok, true);
    const substituted = structuredClone(fixture.response);
    substituted.data.bytes = Buffer.alloc(STUDY_ARTIFACT_MAX_BYTES, 98).toString('base64');
    const rejected = await invoke(fixture.request, answer(substituted));
    assert.equal(rejected.code, 'STUDY_ARTIFACT_INTEGRITY');
    assert.equal('response' in rejected, false);
  });

  it('exposes real SDK input validation and structured error output without dispatch', async () => {
    const server = new McpServer({ name: 'study-protocol-test', version: '1' });
    regStudyTool(server, actor);
    const connection = await connectInMemory(server);
    let calls = 0;
    const patched = mock.method(globalThis, 'fetch', async () => {
      calls++;
      throw new Error('unexpected fetch');
    });
    try {
      const tools = await connection.client.listTools();
      const tool = tools.tools.find((item) => item.name === 'Study_API_Tool');
      assert.ok(tool);
      assert.equal(tool.title, 'LCA Calculation');
      assert.equal(tool.annotations?.readOnlyHint, false);
      assert.equal(tool.annotations?.destructiveHint, true);
      for (const args of [
        { request: { ...request(), schemaVersion: 'lca.study-api.v999' } },
        { request: request(), bearer: actor },
        { request: { ...request(), operation: 'arbitrary.rpc' } },
        { request: { ...request(), extra: 'field' } },
      ]) {
        const result = await connection.client.callTool({
          name: 'Study_API_Tool',
          arguments: args,
        });
        assert.equal(result.isError, true);
      }
      assert.equal(calls, 0);
    } finally {
      patched.mock.restore();
      await connection.close();
    }
  });

  it('rejects invalid owner fields, operations and version-operation mixing before network', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      throw new Error('unexpected fetch');
    };
    for (const value of [
      { ...request(), extra: true },
      { ...mutation(), scope: { kind: 'admin' } },
      { ...mutation(), idempotencyKey: undefined },
      {
        ...request(5),
        operation: 'study.create',
        scope: { kind: 'personal' },
        title: 'Unsupported family',
        idempotencyKey: 'key',
      },
      { ...request(), operation: 'rpc.execute' },
    ]) {
      const output = await invoke(value, fetcher);
      assert.equal(output.ok, false);
      assert.equal(output.code, 'STUDY_INVALID_REQUEST');
      assert.equal(output.outcome, 'not_dispatched');
    }
    assert.equal(calls, 0);
  });

  it('fails closed on wrong response family, correlation, resource, HTTP and extra fields', async () => {
    const value: Request = { ...request(), operation: 'study.read', studyId: 'study-selected' };
    const valid = mutationSuccess();
    valid.data.value.studyId = 'study-selected';
    await assertOwnerPair(value, valid);
    for (const bad of [
      { ...valid, schemaVersion: 'lca.study-api.v3' },
      { ...valid, requestId: 'another-request' },
      { ...valid, extra: 'sentinel-provider-detail' },
      {
        ...valid,
        data: { ...valid.data, value: { ...valid.data.value, studyId: 'another-study' } },
      },
    ]) {
      const output = await invoke(value, answer(bad));
      assert.equal(output.ok, false);
      assert.equal(output.code, 'STUDY_INVALID_RESPONSE');
      assert.equal(JSON.stringify(output).includes('sentinel-provider-detail'), false);
    }
    assert.equal((await invoke(value, answer(valid, 403))).ok, false);
  });

  it('requires exact archived post-state and CAS generation from the owner V2 archive codec', async () => {
    const value: Request = {
      ...request(),
      operation: 'study.archive',
      idempotencyKey: 'archive-request',
      target: { type: 'study', id: 'study-new', expectedRevision: 7 },
    };
    const valid = mutationSuccess();
    valid.data.value.status = 'archived';
    valid.data.value.revision = 8;
    await assertOwnerPair(value, valid);
    assert.equal((await invoke(value, answer(valid))).outcome, 'confirmed');
    for (const state of [
      { status: 'active', revision: 8 },
      { status: 'archived', revision: 7 },
      { status: 'archived', revision: 9 },
    ]) {
      const response = {
        ...valid,
        data: { ...valid.data, value: { ...valid.data.value, ...state } },
      };
      const rejected = await invoke(value, answer(response));
      assert.equal(rejected.code, 'STUDY_INVALID_RESPONSE');
      assert.equal(rejected.outcome, 'unknown');
      assert.equal('response' in rejected, false);
    }
  });

  it('returns stable domain denial without provider messages, paths or bearer', async () => {
    const value = mutation();
    await assertOwnerPair(value, denial(value));
    const output = await invoke(value, answer(denial(value), 403));
    assert.equal(output.ok, false);
    assert.equal(output.code, 'FORBIDDEN');
    assert.equal(output.outcome, 'unknown');
    for (const secret of [
      actor,
      'sentinel-secret-token',
      'private-provider',
      'sentinel-private-path',
      'sentinel-rule',
    ])
      assert.equal(JSON.stringify(output).includes(secret), false, secret);
  });

  it('keeps an uncertain mutation sticky through denial and resolves only confirmed same-request success', async () => {
    const value = mutation();
    let calls = 0;
    let body = '';
    const lost = await invoke(value, async (_url, options) => {
      calls++;
      assert.equal(typeof options?.body, 'string');
      body = options?.body as string;
      throw new Error('sentinel-transport-secret');
    });
    assert.equal(calls, 1);
    assert.equal(lost.outcome, 'unknown');
    assert.equal(JSON.stringify(lost).includes('sentinel-transport-secret'), false);
    const recovery = lost.recovery as Output;
    const digest = String(recovery.requestSha256);
    assert.equal(digest, sha(body));
    assert.equal(recovery.idempotencyKey, value.idempotencyKey);
    const denied = await invoke(
      value,
      async (_url, options) => {
        calls++;
        assert.equal(options?.body, body);
        return json(denial(value), 403);
      },
      { priorUncertainRequestSha256: digest },
    );
    assert.equal(calls, 2);
    assert.equal(denied.outcome, 'unknown');
    assert.equal((denied.recovery as Output).requestSha256, digest);
    const mismatch = await invoke(
      { ...value, idempotencyKey: 'new-key' },
      async () => {
        calls++;
        return json(mutationSuccess());
      },
      { priorUncertainRequestSha256: digest },
    );
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.code, 'STUDY_RECOVERY_REQUEST_MISMATCH');
    assert.equal(mismatch.priorUncertainRequestSha256, digest);
    assert.equal('recovery' in mismatch, false);
    assert.equal(calls, 2);
    await assertOwnerPair(value, mutationSuccess());
    const confirmed = await invoke(value, answer(mutationSuccess()), {
      priorUncertainRequestSha256: digest,
    });
    assert.equal(confirmed.outcome, 'confirmed');
  });

  it('retains uncertainty for first bound errors that may follow mutation commit', async () => {
    const value = mutation();
    for (const [code, status, retryable] of [
      ['DEADLINE_EXCEEDED', 504, true],
      ['UPSTREAM_UNAVAILABLE', 502, true],
      ['REFERENCE_MISMATCH', 502, false],
    ] as const) {
      const error = { ...denial(value), code, retryable, issues: [] };
      await assertOwnerPair(value, error);
      const output = await invoke(value, answer(error, status));
      assert.equal(output.outcome, 'unknown');
      assert.equal((output.recovery as Output).idempotencyKey, value.idempotencyKey);
      const resolved = await invoke(value, answer(mutationSuccess()), {
        priorUncertainRequestSha256: String((output.recovery as Output).requestSha256),
      });
      assert.equal(resolved.outcome, 'confirmed');
    }
  });

  it('does not dispatch without actor token or after caller cancellation', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      return json(capabilities());
    };
    for (const bearer of [undefined, '', 'Bearer accidental-token', 'bad\nheader']) {
      const output = await callStudy({ request: request() }, bearer, signal(), {
        endpoint,
        fetch: fetcher,
        publishableKey,
      });
      assert.equal(output.code, 'STUDY_AUTH_REQUIRED');
    }
    const controller = new AbortController();
    controller.abort();
    const output = await callStudy({ request: mutation() }, actor, controller.signal, {
      endpoint,
      fetch: fetcher,
      publishableKey,
    });
    assert.equal(output.outcome, 'not_dispatched');
    assert.equal(calls, 0);
  });

  it('refuses raw source bytes before network without claiming server authorization', async () => {
    const fixture = artifact(8, 'modelSource');
    const codec = await loadStudyCodec(fixture.request.schemaVersion);
    codec.parseRequest(fixture.request);
    let calls = 0;
    const output = await invoke(fixture.request, async () => {
      calls++;
      return json(fixture.response);
    });
    assert.equal(output.code, 'STUDY_SOURCE_BYTES_UNSUPPORTED');
    assert.equal(calls, 0);
  });

  it('allows the owner 4MiB decoded artifact with base64 envelope and exact digest', async () => {
    const fixture = artifact(STUDY_ARTIFACT_MAX_BYTES);
    const serialized = JSON.stringify(fixture.response);
    assert.ok(Buffer.byteLength(serialized) > STUDY_ARTIFACT_MAX_BYTES);
    assert.ok(Buffer.byteLength(serialized) < STUDY_RESPONSE_MAX_BYTES);
    await assertOwnerPair(fixture.request, fixture.response);
    const output = await invoke(fixture.request, answer(fixture.response));
    assert.equal(output.ok, true);
    assert.deepEqual(output.response, fixture.response);
    const overLimit = artifact(STUDY_ARTIFACT_MAX_BYTES + 1);
    await assertOwnerPair(overLimit.request, overLimit.response);
    assert.equal(
      (await invoke(overLimit.request, answer(overLimit.response))).code,
      'STUDY_ARTIFACT_INTEGRITY',
    );
  });

  for (const version of [4, 5, 6] as const) {
    it(`binds V${version} named-share download to an independently selected bundle hash and size`, async () => {
      const bytes = Buffer.from('Opaque transport fixture; no signature qualification claimed.');
      const ref = (type: string, schemaVersion: string) => ({
        type,
        id: 'bundle-ref',
        contentHash: sha(bytes),
        digestScope: 'artifact_bytes_sha256',
        byteSize: bytes.length,
        mediaType: 'application/json',
        schemaVersion,
      });
      const share = {
        studyId: 'study-1',
        reportRevisionId: 'report-1',
        reportContentHash: 'a'.repeat(64),
        shareId: 'share-1',
        exportId: 'export-1',
        finalizationId: 'finalization-1',
        issuerId: '11111111-1111-4111-8111-111111111111',
        recipientId: '22222222-2222-4222-8222-222222222222',
        disclosurePolicyId: 'lca.study-report-summary-share.v1',
        disclosureContextHash: 'b'.repeat(64),
        grantEpoch: 1,
        projectionRef: ref('reportProjection', `lca.study-report-view.v${version - 3}`),
        bundleRef: ref('reportExportBundle', `lca.study-export-bundle.v${version - 2}`),
        createdAt: '2026-11-04T00:00:00Z',
        expiresAt: '2026-11-05T00:00:00Z',
        revokedAt: null,
        status: 'active',
      };
      const value: Request = {
        ...request(version),
        operation: 'share.download',
        shareId: share.shareId,
      };
      const response = {
        schemaVersion: value.schemaVersion,
        requestId: value.requestId,
        ok: true,
        data: { type: 'download', share, encoding: 'base64', bytes: bytes.toString('base64') },
      };
      await assertOwnerPair(value, response);
      const expectedDownload = {
        contentHash: share.bundleRef.contentHash,
        byteSize: share.bundleRef.byteSize,
      };
      const output = await invoke(value, answer(response), { expectedDownload });
      assert.equal(output.ok, true);
      assert.deepEqual(output.response, response);
      for (const expected of [
        { ...expectedDownload, contentHash: 'c'.repeat(64) },
        { ...expectedDownload, byteSize: bytes.length + 1 },
      ]) {
        const rejected = await invoke(value, answer(response), { expectedDownload: expected });
        assert.equal(rejected.ok, false);
        assert.equal('response' in rejected, false);
      }
      const corrupt = {
        ...response,
        data: { ...response.data, bytes: Buffer.alloc(bytes.length).toString('base64') },
      };
      assert.equal((await invoke(value, answer(corrupt), { expectedDownload })).ok, false);
      let calls = 0;
      const unselected = await invoke(value, async () => {
        calls++;
        return json(response);
      });
      assert.equal(unselected.ok, false);
      assert.equal(calls, 0);
      const substituted = {
        ...response,
        data: { ...response.data, share: { ...share, shareId: 'another-share' } },
      };
      assert.equal((await invoke(value, answer(substituted), { expectedDownload })).ok, false);
    });
  }

  it('executes a successful SDK tool call in an isolated configured runtime', () => {
    const program = `
      import assert from 'node:assert/strict';
      import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
      import { regStudyTool } from './src/tools/study.ts';
      import { connectInMemory } from './test/helpers/mcp-client.ts';
      const request=${JSON.stringify(request())};
      const response=${JSON.stringify(capabilities())};
      let calls=0;
      globalThis.fetch=async(url,options)=>{
        calls++;
        assert.equal(String(url), ${JSON.stringify(endpoint)});
        assert.equal(new Headers(options.headers).get('authorization'), 'Bearer actor-fixture');
        assert.deepEqual(JSON.parse(options.body),request);
        return new Response(JSON.stringify(response),{headers:{'content-type':'application/json'}});
      };
      const server=new McpServer({name:'isolated-study-protocol',version:'1'});
      regStudyTool(server,'actor-fixture');
      const connection=await connectInMemory(server);
      try {
        const result=await connection.client.callTool({name:'Study_API_Tool',arguments:{request}});
        assert.equal(result.isError,undefined);
        assert.deepEqual(result.structuredContent.response,response);
        assert.equal(calls,1);
      }finally{await connection.close();}
    `;
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', program],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SUPABASE_BASE_URL: 'http://127.0.0.1:9191',
          SUPABASE_PUBLISHABLE_KEY: publishableKey,
        },
        encoding: 'utf8',
        timeout: 10_000,
      },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  });

  it('rejects artifact hash, size, base64 and selected-reference substitutions before disclosure', async () => {
    const fixture = artifact(32);
    for (const response of [
      {
        ...fixture.response,
        data: { ...fixture.response.data, bytes: Buffer.alloc(32, 98).toString('base64') },
      },
      {
        ...fixture.response,
        data: { ...fixture.response.data, bytes: Buffer.alloc(31, 97).toString('base64') },
      },
      { ...fixture.response, data: { ...fixture.response.data, bytes: 'YR==' } },
      {
        ...fixture.response,
        data: {
          ...fixture.response.data,
          artifactRef: { ...fixture.response.data.artifactRef, id: 'other-artifact' },
        },
      },
    ]) {
      const output = await invoke(fixture.request, answer(response));
      assert.equal(output.ok, false);
      assert.equal('response' in output, false);
      assert.equal(JSON.stringify(output).includes(fixture.response.data.bytes), false);
    }
  });

  it('rejects oversized response headers and streamed bytes and cancels the reader', async () => {
    let cancelled = 0;
    const body = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(STUDY_RESPONSE_MAX_BYTES + 1));
        },
        cancel() {
          cancelled++;
        },
      });
    for (const response of [
      new Response(body(), {
        headers: {
          'content-type': 'application/json',
          'content-length': String(STUDY_RESPONSE_MAX_BYTES + 1),
        },
      }),
      new Response(body(), { headers: { 'content-type': 'application/json' } }),
    ]) {
      const output = await invoke(request(), async () => response);
      assert.equal(output.code, 'STUDY_RESPONSE_TOO_LARGE');
    }
    assert.equal(cancelled, 2);
  });

  it('rejects a structurally valid owner request over the transport cap before dispatch', async () => {
    const ref = {
      type: 'analysisFacts',
      id: 'facts',
      contentHash: 'a'.repeat(64),
      digestScope: 'artifact_bytes_sha256',
      byteSize: 100,
      mediaType: 'application/json',
      schemaVersion: 'lca.study-analysis-facts.v2',
    };
    const value: Request = {
      ...request(5),
      operation: 'report.create',
      idempotencyKey: 'large-report-key',
      studyId: '11111111-1111-4111-8111-111111111111',
      parentReportRevisionId: null,
      runIds: ['22222222-2222-4222-8222-222222222222'],
      analysisIds: ['33333333-3333-4333-8333-333333333333'],
      templateId: 'lca.study-report.v2',
      content: {
        schemaVersion: 'lca.study-report-draft.v2',
        title: 'Large valid draft',
        claims: [
          {
            claimId: 'claim',
            bundleRef: ref,
            factId: 'fact',
            canonicalValue: '1',
            unit: 'kg',
            display: { style: 'exact' },
          },
        ],
        sections: Array.from({ length: 5 }, (_, i) => ({
          sectionId: `section-${i}`,
          title: 'Section',
          paragraphs: Array.from({ length: 32 }, () => 'a'.repeat(2048)),
          claimIds: ['claim'],
        })),
        tables: [],
        charts: [],
        additionalLimitations: [],
      },
    };
    const codec = await loadStudyCodec(value.schemaVersion);
    codec.parseRequest(value);
    assert.ok(Buffer.byteLength(JSON.stringify(value)) > STUDY_REQUEST_MAX_BYTES);
    let calls = 0;
    const output = await invoke(value, async () => {
      calls++;
      throw new Error('unexpected');
    });
    assert.equal(output.code, 'STUDY_REQUEST_TOO_LARGE');
    assert.equal(calls, 0);
  });

  it('carries a large valid Study request through real authenticated HTTP and bounds/redacts the outer envelope', async () => {
    // The prior Express default was 100KiB, smaller than valid public report requests.
    const value: Request = {
      ...request(5),
      operation: 'report.create',
      idempotencyKey: 'large-http-report',
      studyId: '11111111-1111-4111-8111-111111111111',
      parentReportRevisionId: null,
      runIds: ['22222222-2222-4222-8222-222222222222'],
      analysisIds: ['33333333-3333-4333-8333-333333333333'],
      templateId: 'lca.study-report.v2',
      content: {
        schemaVersion: 'lca.study-report-draft.v2',
        title: 'Large HTTP report',
        claims: [
          {
            claimId: 'claim',
            bundleRef: {
              type: 'analysisFacts',
              id: 'facts',
              contentHash: 'a'.repeat(64),
              digestScope: 'artifact_bytes_sha256',
              byteSize: 8,
              mediaType: 'application/json',
              schemaVersion: 'lca.study-analysis-facts.v2',
            },
            factId: 'fact',
            canonicalValue: '1',
            unit: 'kg',
            display: { style: 'exact' },
          },
        ],
        sections: Array.from({ length: 3 }, (_, i) => ({
          sectionId: `s-${i}`,
          title: 'Section',
          paragraphs: Array.from({ length: 32 }, () => 'a'.repeat(2048)),
          claimIds: ['claim'],
        })),
        tables: [],
        charts: [],
        additionalLimitations: [],
      },
    };
    (await loadStudyCodec(value.schemaVersion)).parseRequest(value);
    const bytes = Buffer.byteLength(JSON.stringify(value));
    assert.ok(bytes > 100 * 1024 && bytes < STUDY_REQUEST_MAX_BYTES);
    let received = false;
    const app = createHttpApp({
      tokenVerifier: {
        verifyAccessToken: async (token) => ({
          token,
          clientId: 'http-fixture',
          scopes: [],
          expiresAt: Math.floor(Date.now() / 1000) + 60,
        }),
      },
      serverFactory: (bearer) => {
        assert.equal(bearer, actor);
        const server = new McpServer({ name: 'large-http', version: '1' });
        server.registerTool(
          'Study_API_Tool',
          { inputSchema: { request: z.record(z.string(), z.unknown()) } },
          async ({ request: actual }) => {
            assert.deepEqual(actual, value);
            received = true;
            const output = await invoke(value, answer(denial(value), 403));
            return {
              content: [{ type: 'text', text: JSON.stringify(output) }],
              structuredContent: output,
              isError: true,
            };
          },
        );
        return server;
      },
    });
    await withHttpServer(app, async (baseUrl) => {
      const client = new Client({ name: 'large-http-client', version: '1' });
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
            requestInit: { headers: { authorization: `Bearer ${actor}` } },
          }),
        );
        const result = await client.callTool({
          name: 'Study_API_Tool',
          arguments: { request: value },
        });
        assert.equal(result.isError, true);
        assert.equal(received, true);
        assert.equal((result.structuredContent as Output)?.code, 'FORBIDDEN');
        assert.equal((result.structuredContent as Output)?.outcome, 'unknown');
        for (const [body, status] of [
          [
            JSON.stringify({
              sentinel: 'secret-body',
              padding: 'x'.repeat(MCP_HTTP_REQUEST_MAX_BYTES),
            }),
            413,
          ],
          ['{"sentinel":"secret-body",', 400],
        ] as const) {
          const response = await fetch(`${baseUrl}/mcp`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${actor}` },
            body,
          });
          assert.equal(response.status, status);
          const text = await response.text();
          assert.equal(text.includes('secret-body'), false);
          assert.equal(text.includes('stack'), false);
          assert.match(response.headers.get('content-type') ?? '', /^application\/json/u);
        }
        const unsupportedHeaders: Array<Record<string, string>> = [
          { 'content-type': 'application/json;charset=sentinel-charset' },
          { 'content-type': 'application/json', 'content-encoding': 'sentinel-encoding' },
        ];
        for (const headers of unsupportedHeaders) {
          const response = await fetch(`${baseUrl}/mcp`, {
            method: 'POST',
            headers: { ...headers, authorization: `Bearer ${actor}` },
            body: '{}',
          });
          assert.equal(response.status, 415);
          const text = await response.text();
          assert.equal(text.includes('sentinel'), false);
          assert.equal(text.includes('node_modules'), false);
          assert.match(response.headers.get('content-type') ?? '', /^application\/json/u);
        }
      } finally {
        await client.close();
      }
    });
  });

  it('rejects redirects and unsafe endpoint selection with no forwarded follow-up', async () => {
    let calls = 0;
    const redirected = await invoke(mutation(), async (_url, options) => {
      calls++;
      assert.equal(options?.redirect, 'error');
      return new Response(null, {
        status: 302,
        headers: { location: 'https://sentinel-private.invalid' },
      });
    });
    assert.equal(redirected.code, 'STUDY_REDIRECT_REJECTED');
    assert.equal(redirected.outcome, 'unknown');
    for (const bad of [
      'http://example.invalid/functions/v1/app_lca_study',
      `${endpoint}?token=secret`,
      'https://user:secret@example.invalid/functions/v1/app_lca_study',
      'https://example.invalid/arbitrary-rpc',
    ]) {
      const output = await callStudy({ request: request() }, actor, signal(), {
        endpoint: bad,
        publishableKey,
        fetch: async () => {
          calls++;
          return json(capabilities());
        },
      });
      assert.equal(output.code, 'STUDY_ENDPOINT_INVALID');
    }
    assert.equal(calls, 1);
  });

  it('aborts an in-flight mutation on the deadline and preserves uncertainty', async () => {
    let calls = 0;
    let observedAbort = false;
    const fetcher: typeof fetch = async (_url, options) => {
      calls++;
      return new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener(
          'abort',
          () => {
            observedAbort = true;
            reject(new Error('sentinel-deadline-provider-error'));
          },
          { once: true },
        );
      });
    };
    const output = await callStudy({ request: mutation() }, actor, signal(), {
      fetch: fetcher,
      endpoint,
      publishableKey,
      deadlineMs: 10,
    });
    assert.equal(calls, 1);
    assert.equal(observedAbort, true);
    assert.equal(output.outcome, 'unknown');
    assert.equal(JSON.stringify(output).includes('sentinel-deadline-provider-error'), false);
  });

  it('cancels a stalled streaming response using the MCP cancellation signal', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(Buffer.from('{'));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
    const promise = callStudy({ request: mutation() }, actor, controller.signal, {
      endpoint,
      publishableKey,
      fetch: async () => response,
    });
    setTimeout(() => controller.abort(), 10);
    const output = await promise;
    assert.equal(cancelled, true);
    assert.equal(output.outcome, 'unknown');
  });
});
