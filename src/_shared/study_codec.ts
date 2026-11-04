import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** Structural bridge only. Exact domain schemas/declarations belong to Edge. */
export type StudyObject = Record<string, unknown>;
export type StudyRequest = StudyObject & {
  schemaVersion: string;
  requestId: string;
  operation: string;
  idempotencyKey?: string;
};
export type StudyResponse = StudyObject & {
  schemaVersion: string;
  requestId: string;
  ok: boolean;
  data?: StudyObject;
  code?: string;
  retryable?: boolean;
};
export type StudyCodec = {
  API_SCHEMA: string;
  parseRequest(input: unknown): StudyRequest;
  parseResponse(input: unknown): StudyResponse;
  validateResponseForRequest(request: StudyRequest, response: StudyResponse): void;
  operationMetadata: Record<string, { kind: 'query' | 'mutation' }>;
};

const pins: Readonly<Record<string, string>> = Object.freeze({
  'lca.study-api.v2': 'a02a3895b7d16e0e91b0590801844abe9d09299592ba0e1428d0f1d8169e9bb8',
  'lca.study-api.v3': 'a3ac80bb7f16f474f9ef0d017c69121d3a11050e24fa9d8c16b344bb26a3f40b',
  'lca.study-api.v4': '33fe29178eadb23b968ed0bbb0af0f99fc929cfbdc847d24939ad033e5b9719b',
  'lca.study-api.v5': '3eea620ab4041f1a6fcfab34bd2afd275f8cbd3cbcf56ba6a187076e9bb3cf94',
});
export const studyDigest = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');
export const studyObject = (value: unknown): value is StudyObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The same verification boundary serves runtime dispatch and schema discovery. */
function verifiedOwnerFiles(schema: string): Map<string, Buffer> {
  const expected = pins[schema];
  if (!expected) throw new Error('STUDY_UNSUPPORTED_SCHEMA');
  const version = schema.slice(-2);
  const root = new URL(`./study_contract/${version}/`, import.meta.url);
  const manifestBytes = readFileSync(new URL('manifest.json', root));
  if (studyDigest(manifestBytes) !== expected) throw new Error('STUDY_CONTRACT_INTEGRITY');
  const manifest: unknown = JSON.parse(manifestBytes.toString('utf8'));
  if (
    !studyObject(manifest) ||
    manifest.apiSchema !== schema ||
    manifest.sourceRepository !== 'tiangong-lca/edge-functions' ||
    manifest.sourceCommit !== '5b27e2e1fe05e3ff7c3a89f1aa59e8c84f244aff' ||
    manifest.sourceStatus !== 'committed' ||
    !Array.isArray(manifest.files)
  )
    throw new Error('STUDY_CONTRACT_INTEGRITY');
  const files = new Map<string, Buffer>();
  for (const file of manifest.files) {
    if (
      !studyObject(file) ||
      typeof file.path !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(file.path)
    )
      throw new Error('STUDY_CONTRACT_INTEGRITY');
    const bytes = readFileSync(new URL(file.path, root));
    if (bytes.length !== file.bytes || studyDigest(bytes) !== file.sha256)
      throw new Error('STUDY_CONTRACT_INTEGRITY');
    files.set(file.path, bytes);
  }
  return files;
}

/** Exact owner bytes only: no reconstructed or parallel request schema. */
export function readStudyRequestSchema(schema: string): string {
  const bytes = verifiedOwnerFiles(schema).get('request.schema.json');
  if (!bytes || bytes.length > 256 * 1024) throw new Error('STUDY_CONTRACT_INTEGRITY');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Verify every contained file before evaluating the self-contained owner module. */
export async function loadStudyCodec(schema: string): Promise<StudyCodec> {
  const code = verifiedOwnerFiles(schema).get('index.mjs');
  if (!code) throw new Error('STUDY_CONTRACT_INTEGRITY');
  const codec: unknown = await import(`data:text/javascript;base64,${code.toString('base64')}`);
  if (
    !studyObject(codec) ||
    codec.API_SCHEMA !== schema ||
    typeof codec.parseRequest !== 'function' ||
    typeof codec.parseResponse !== 'function' ||
    typeof codec.validateResponseForRequest !== 'function' ||
    !studyObject(codec.operationMetadata)
  )
    throw new Error('STUDY_CONTRACT_INTEGRITY');
  return codec as StudyCodec;
}
