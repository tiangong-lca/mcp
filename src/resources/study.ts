import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { readStudyRequestSchema } from '../_shared/study_codec.js';

const versions = ['v2', 'v3', 'v4', 'v5', 'v6'] as const;
const contract = `LCA calculation uses Study_API_Tool to forward one explicit public Edge Study request.
Read tiangong-study://schema/v2/request, /v3/request, /v4/request, /v5/request or /v6/request for the exact selected owner request JSON schema. These versioned schemas are not interchangeable; runtime owner-codec refinements also apply. Use capability.read in that same family to discover current server operations; discovery grants no authorization. V5/V6 remain independently configured/default-off.
Use V2 for calculation projects, scenarios, model preparation, runs and task status. Optional capabilities use V3 for reporting and initial analysis; V4 for review, finalization and named sharing; V5 for advanced analysis, reports and review; V6 for method evidence, assessment and related reports and review. Method evidence is recorded-unverified; values, unavailable reasons and coverage gaps remain exact. No scientific approval or absent-factor-to-zero/non-applicable inference is supplied. Preserve supplied requestId, idempotencyKey, CAS, content hashes and scientific strings. MCP forwards requests without local calculation, version fallback, key generation or automatic mutation retries.
The caller retains each original mutation request. Any dispatched mutation without confirmed success stays unknown, including bound domain errors. Explicit recovery resends the identical original request/key with priorUncertainRequestSha256 from its receipt. Changed keys/requests are refused and a later denial does not prove no effect. requestSha256 is transport evidence, not a domain hash.
Inner requests:256KiB; authenticated MCP envelope:512KiB; encoded responses:6MiB; decoded artifacts:4MiB; network deadline:25s plus caller cancellation. artifact.read checks exact requested bytes/ref/hash. export.download/share.download require expectedDownload:{contentHash,byteSize} selected from the corresponding authorized export.read/share.read. Transport integrity is separate from signer trust/scientific approval. Raw modelSource packet bytes are unsupported; no credentials, arbitrary URL/RPC/CLI, source/storage locator or direct table operation is exposed.
Authenticated HTTP forwards the verified actor token and reauthorizes each operation. STDIO registration adds no token source; its shipped tokenless executable fails before network access. Local unauthenticated HTTP has no Study tool/resources. No production activation, npm publication or P5 rollout follows from these resources.
`;

export function regStudyResources(server: McpServer): void {
  for (const version of versions) {
    server.registerResource(
      `Study_Request_Schema_${version}`,
      `tiangong-study://schema/${version}/request`,
      {
        title: `LCA calculation: exact ${version.toUpperCase()} request schema`,
        description:
          'Integrity-checked immutable Edge request JSON schema; owner runtime refinements also apply.',
        mimeType: 'application/schema+json',
      },
      (uri) => {
        try {
          const text = readStudyRequestSchema(`lca.study-api.${version}`);
          return { contents: [{ uri: uri.href, mimeType: 'application/schema+json', text }] };
        } catch {
          throw new McpError(ErrorCode.InternalError, 'Study schema unavailable.');
        }
      },
    );
  }
  server.registerResource(
    'Study_Consumer_Contract',
    'tiangong-study://consumer/contract',
    {
      title: 'LCA calculation: capabilities, recovery and limits',
      description:
        'Supported public families, explicit mutation recovery and artifact/authorization boundaries.',
      mimeType: 'text/plain',
    },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/plain', text: contract }] }),
  );
}
