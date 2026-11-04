import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  requireSupabaseBaseUrl,
  requireSupabasePublishableKey,
  x_region,
} from '../_shared/config.js';
import {
  loadStudyCodec,
  studyDigest,
  studyObject,
  type StudyObject,
  type StudyRequest,
  type StudyResponse,
} from '../_shared/study_codec.js';

export const STUDY_REQUEST_MAX_BYTES = 256 * 1024;
export const STUDY_ARTIFACT_MAX_BYTES = 4 * 1024 * 1024;
// The owner permits 4MiB decoded inline artifacts: base64 plus envelope needs more.
export const STUDY_RESPONSE_MAX_BYTES = 6 * 1024 * 1024;
export const STUDY_DEADLINE_MS = 25_000;

type Dependencies = {
  fetch?: typeof fetch;
  endpoint?: string;
  publishableKey?: string;
  deadlineMs?: number;
};
type Recovery = {
  requestSha256: string;
  requestId: string;
  schemaVersion: string;
  operation: string;
  idempotencyKey?: string;
  instruction: string;
};
class StudyBoundaryError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function fail(code: string): never {
  throw new StudyBoundaryError(code);
}
const inputSchema = z
  .object({
    request: z
      .object({
        schemaVersion: z.enum([
          'lca.study-api.v2',
          'lca.study-api.v3',
          'lca.study-api.v4',
          'lca.study-api.v5',
        ]),
        requestId: z.string().min(1).max(128),
        operation: z.string().min(1).max(128),
      })
      .catchall(z.unknown())
      .describe('Exact public Edge Study request; the selected owner codec validates every field.'),
    priorUncertainRequestSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional()
      .describe(
        'On explicit recovery, copy the uncertain request receipt and resend the identical original request/key.',
      ),
    expectedDownload: z
      .object({
        contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
        byteSize: z.number().int().min(1).max(STUDY_ARTIFACT_MAX_BYTES),
      })
      .strict()
      .optional()
      .describe(
        'Required for export.download/share.download: exact bundle hash/size from the selected export.read/share.read.',
      ),
  })
  .strict();

async function readBounded(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > STUDY_RESPONSE_MAX_BYTES)) {
    await response.body?.cancel();
    fail('STUDY_RESPONSE_TOO_LARGE');
  }
  const body = response.body;
  if (!body) throw new StudyBoundaryError('STUDY_INVALID_RESPONSE');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > STUDY_RESPONSE_MAX_BYTES) fail('STUDY_RESPONSE_TOO_LARGE');
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function verifyInlineBytes(
  response: StudyResponse,
  expectedDownload?: { contentHash: string; byteSize: number },
): void {
  const data = response.data;
  if (!data || !['artifact', 'exportDownload', 'download'].includes(String(data.type))) return;
  const record =
    data.type === 'artifact'
      ? data.artifactRef
      : data.type === 'download'
        ? data.share
        : data.export;
  const ref = studyObject(record) && (data.type === 'artifact' ? record : record.bundleRef);
  if (!studyObject(ref) || typeof data.bytes !== 'string')
    throw new StudyBoundaryError('STUDY_ARTIFACT_INTEGRITY');
  if (
    expectedDownload &&
    (ref.contentHash !== expectedDownload.contentHash || ref.byteSize !== expectedDownload.byteSize)
  )
    fail('STUDY_ARTIFACT_INTEGRITY');
  const bytes = Buffer.from(data.bytes, 'base64');
  if (
    bytes.length > STUDY_ARTIFACT_MAX_BYTES ||
    bytes.length !== ref.byteSize ||
    bytes.toString('base64') !== data.bytes ||
    studyDigest(bytes) !== ref.contentHash
  )
    fail('STUDY_ARTIFACT_INTEGRITY');
}

function endpointUrl(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) ||
    url.username ||
    url.password ||
    value.includes('?') ||
    value.includes('#') ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith('/functions/v1/app_lca_study')
  )
    fail('STUDY_ENDPOINT_INVALID');
  return url.href;
}

export async function callStudy(
  input: z.infer<typeof inputSchema>,
  bearer: string | undefined,
  signal: AbortSignal,
  dependencies: Dependencies = {},
): Promise<StudyObject> {
  let request: StudyRequest;
  let mutation = false;
  let dispatched = false;
  let recovery: Recovery | undefined;
  let deadline: NodeJS.Timeout | undefined;
  try {
    if (Buffer.byteLength(JSON.stringify(input.request)) > STUDY_REQUEST_MAX_BYTES)
      fail('STUDY_REQUEST_TOO_LARGE');
    const codec = await loadStudyCodec(input.request.schemaVersion);
    try {
      request = codec.parseRequest(input.request);
    } catch {
      return {
        ok: false,
        code: 'STUDY_INVALID_REQUEST',
        outcome: input.priorUncertainRequestSha256 ? 'unknown' : 'not_dispatched',
        ...(input.priorUncertainRequestSha256
          ? { priorUncertainRequestSha256: input.priorUncertainRequestSha256 }
          : {}),
      };
    }
    mutation = codec.operationMetadata[request.operation]?.kind === 'mutation';
    const body = JSON.stringify(request);
    const requestSha256 = studyDigest(body);
    recovery = {
      requestSha256,
      requestId: request.requestId,
      schemaVersion: request.schemaVersion,
      operation: request.operation,
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      instruction:
        'Retain the original request. Retry only explicitly with that identical request/key and this priorUncertainRequestSha256; do not generate a new key or infer no effect from a later denial.',
    };
    if (
      input.priorUncertainRequestSha256 &&
      (!mutation || input.priorUncertainRequestSha256 !== requestSha256)
    ) {
      recovery = undefined;
      fail('STUDY_RECOVERY_REQUEST_MISMATCH');
    }
    if (Buffer.byteLength(body) > STUDY_REQUEST_MAX_BYTES) fail('STUDY_REQUEST_TOO_LARGE');
    if (
      request.operation === 'artifact.read' &&
      studyObject(request.artifactRef) &&
      request.artifactRef.type === 'modelSource'
    )
      fail('STUDY_SOURCE_BYTES_UNSUPPORTED');
    if (['export.download', 'share.download'].includes(request.operation)) {
      if (!input.expectedDownload) fail('STUDY_DOWNLOAD_SELECTION_REQUIRED');
    } else if (input.expectedDownload) fail('STUDY_DOWNLOAD_SELECTION_INVALID');
    if (!bearer || /\s/u.test(bearer)) fail('STUDY_AUTH_REQUIRED');
    const endpoint = endpointUrl(
      dependencies.endpoint ?? `${requireSupabaseBaseUrl()}/functions/v1/app_lca_study`,
    );
    const publishableKey = dependencies.publishableKey ?? requireSupabasePublishableKey();
    const controller = new AbortController();
    deadline = setTimeout(() => controller.abort(), dependencies.deadlineMs ?? STUDY_DEADLINE_MS);
    const combined = AbortSignal.any([signal, controller.signal]);
    combined.throwIfAborted();
    dispatched = true;
    const response = await (dependencies.fetch ?? fetch)(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        apikey: publishableKey,
        'content-type': 'application/json',
        'x-region': x_region,
      },
      body,
      redirect: 'error',
      signal: combined,
    });
    if (response.redirected || (response.status >= 300 && response.status < 400))
      fail('STUDY_REDIRECT_REJECTED');
    if (
      response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
      'application/json'
    ) {
      await response.body?.cancel();
      throw new StudyBoundaryError('STUDY_INVALID_RESPONSE');
    }
    const bytes = await readBounded(response, combined);
    let decoded: StudyResponse;
    try {
      decoded = codec.parseResponse(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      );
      codec.validateResponseForRequest(request, decoded);
    } catch {
      fail('STUDY_INVALID_RESPONSE');
    }
    if (response.ok !== decoded.ok) fail('STUDY_INVALID_RESPONSE');
    if (!decoded.ok) {
      return {
        ok: false,
        code: decoded.code,
        retryable: decoded.retryable,
        // A domain error can be emitted after dispatch/commit (including codec
        // checks and deadlines). It does not prove that this mutation had no effect.
        outcome: mutation || input.priorUncertainRequestSha256 ? 'unknown' : 'rejected',
        ...(mutation ? { recovery } : {}),
      };
    }
    verifyInlineBytes(decoded, input.expectedDownload);
    return { ok: true, outcome: 'confirmed', requestSha256, response: decoded };
  } catch (error) {
    const unknown = (mutation && dispatched) || Boolean(input.priorUncertainRequestSha256);
    const code = error instanceof StudyBoundaryError ? error.code : 'STUDY_TRANSPORT_UNAVAILABLE';
    return {
      ok: false,
      code,
      outcome: unknown ? 'unknown' : dispatched ? 'unavailable' : 'not_dispatched',
      ...(unknown && recovery ? { recovery } : {}),
      ...(unknown && !recovery && input.priorUncertainRequestSha256
        ? { priorUncertainRequestSha256: input.priorUncertainRequestSha256 }
        : {}),
    };
  } finally {
    if (deadline) clearTimeout(deadline);
  }
}

export function regStudyTool(server: McpServer, bearer?: string): void {
  server.registerTool(
    'Study_API_Tool',
    {
      title: 'LCA Study API',
      description:
        'Execute one explicit Edge Study V2/V3/V4/V5 request. First read tiangong-study://schema/v2/request (or v3/v4/v5) and tiangong-study://consumer/contract; then call capability.read in the selected family. Covers Study/Scenario/model preparation, run/task, analyses, report authoring, review/finalization and named sharing/export. May mutate data. Exact owner codecs validate all fields; discovery is not authorization. V5 remains independently configured/default-off. No automatic retry, version fallback, key generation or raw source packet bytes. Retain the original request for explicit same-key recovery; requestSha256 is a transport receipt, never a domain/config identity.',
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input, extra) => {
      const output = await callStudy(input, bearer, extra.signal);
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
        ...(output.ok === false ? { isError: true } : {}),
      };
    },
  );
}
