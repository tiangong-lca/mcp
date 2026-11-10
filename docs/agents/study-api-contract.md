---
title: MCP Study API Consumer Contract
docType: contract
scope: repo
status: active
authoritative: true
owner: mcp
language: en
whenToUse:
  - when using or changing the MCP Study tool, portable codecs, transport or recovery behavior
whenToUpdate:
  - when Study registration, supported API families, contained owner assets or integrity/recovery boundaries change
checkPaths:
  - src/tools/study.ts
  - src/resources/study.ts
  - src/_shared/study_codec.ts
  - src/_shared/study_contract/**
  - src/_shared/init_server.ts
  - src/_shared/init_server_http.ts
  - test/study.test.ts
  - scripts/build.mjs
  - scripts/test-packed-consumer.mjs
lastReviewedAt: 2026-11-05
lastReviewedCommit: dfd82230833c04a82c96a09bdfad642173af87b5
lastReviewedNote: 'MCP #107: reviewed exact V6 owner consumption, async receipt/config identity checks, retained historical protocols, installed package integrity and truthful method qualification boundaries. Actual V6 runtime, CI, Main and root delivery remain pending.'
related:
  - ../../AGENTS.md
  - ./repo-architecture.md
  - ./repo-validation.md
---

## Ownership and registration

`Study_API_Tool` forwards one explicit public Study request to the configured `/functions/v1/app_lca_study` endpoint. Edge owns the full domain schemas and response/resource binding rules. Database and Worker retain persistence, actor/client/source authorization, task and numerical authority. MCP performs no calculation, domain hash generation, engine fallback, source acquisition, direct RPC/table write or CLI invocation.

The display title and resources lead with LCA calculation. The tool name, resource names and URIs remain the stable Study identifiers; the display wording does not change owner schema bytes or current admission.

Authenticated HTTP registers the tool with the same already-verified request-scoped actor bearer. The same factory registration exists on STDIO; the shipped STDIO executable supplies no actor credential and Study calls therefore fail with `STUDY_AUTH_REQUIRED`. This change adds no STDIO login/token environment mechanism. Local unauthenticated HTTP retains its local-only tools and does not register Study. Missing credentials fail before remote I/O. Tool arguments, results and logs contain no transport credentials; all provider errors are reduced to stable codes. Successful authorized user content remains exact public domain data.

`SUPABASE_BASE_URL` and `SUPABASE_PUBLISHABLE_KEY` remain explicit lazy backend configuration. Study allows HTTPS, or HTTP on an exact loopback hostname for owned development. Userinfo, query/fragment (including empty delimiters), redirects and arbitrary operation URLs are rejected. The tool input cannot select an endpoint. The server reauthorizes every call, including same-key retries; MCP registration and capability discovery confer no permission.

## Explicit public families

The tool accepts `{ "request": <exact public request> }`. `request.schemaVersion` must be one of `lca.study-api.v2`, `.v3`, `.v4`, `.v5`, `.v6`; there is no default or fallback. The owner codec validates every field, operation, request ID, CAS, resource/hash selector and response binding. V2 exposes Study/Scenario/model/run/task operations; V3 adds reporting; V4 adds review/finalization/named sharing; V5 is the independent advanced-analysis/report family. All operations in each selected owner codec are dispatched except the explicit source-byte limitation below. V6 adds method evidence/assessment and its report/review/export family. V5/V6 runtime admission remains controlled by their owner and default-off; containing a codec does not establish production enablement or scientific qualification.

Owner files under `src/_shared/study_contract/v2` through `v6` are immutable portable packages. V3/V4/V5 retain Edge source `5b27e2e1fe05e3ff7c3a89f1aa59e8c84f244aff`; V3/V4 were built in a clean detached owner checkout, and V5 is the original producer artifact. V2 deliberately adopts the clean source candidate `439f8112a8f9945479c63ffaa8cfe688e9d20216` from Edge #556, manifest `0cfe9a2d3c957a005a6b8045b3f8df0cea9b3e852af7a49f706e3b35a798b0c1`, correcting archive post-state/CAS response binding without changing wire schema or contract version 2.0.0. Its source review, required CI, Main eligibility and runtime activation are separate qualification facts; a contained committed package alone does not prove them. Each manifest is pinned independently in `study_codec.ts`; every declared file is byte-size/hash checked before evaluating the self-contained module. Original declarations, JSON schemas and licenses ship unchanged. Oxlint and Prettier exclude only those producer directories; MCP source remains linted. Build copies them into the same relative package path, and packed consumers load them outside the source checkout.

The public input envelope lists the schema discriminator and request envelope. Authenticated HTTP and STDIO list five static resources: `tiangong-study://schema/v2/request`, `tiangong-study://schema/v3/request`, `tiangong-study://schema/v4/request` `tiangong-study://schema/v5/request` and `tiangong-study://schema/v6/request`. Each read uses the same full pinned-manifest/file verification as runtime dispatch and returns the exact owner request JSON Schema bytes, bounded to 256 KiB. Unknown resource versions are rejected. The public `tiangong-study://consumer/contract` resource supplies concise operation-family, recovery, artifact-size, authorization and qualification guidance. The tool description points clients to these resources and same-family capability.read. Existing resources remain available and local HTTP registers none of these Study resources. Runtime refinements remain in the selected codec; the package also retains the original owner declarations. MCP does not reconstruct or maintain a parallel domain schema.

## Transport and data integrity

One call sends one POST; no automatic retry or redirect follows. Authenticated HTTP bounds its MCP JSON-RPC envelope to 512 KiB, with fixed JSON errors for malformed, oversized or unsupported-encoding bodies and a generic safe internal-error boundary; local HTTP keeps its existing surface and limit. The inner Study request is independently bounded to 256 KiB of UTF-8 JSON before codec evaluation and transmission. Network execution, body streaming and caller cancellation share a 25-second deadline. Responses are streamed with a 6 MiB encoded JSON bound, accommodating the owner's 4 MiB decoded inline artifact limit. Declared and observed lengths both apply. UTF-8/JSON/media-type/status/schema/resource mismatches fail before disclosure. Error envelopes expose stable codes and retryability, never upstream messages, issues, token-bearing diagnostic text or stacks.

`artifact.read` verifies canonical base64 plus exact requested/ref byte size and SHA-256. `modelSource` raw packet bytes are deliberately unsupported in model-visible output and fail locally with `STUDY_SOURCE_BYTES_UNSUPPORTED`; this is an MCP exposure limit, not a statement about server permission. Authorized `modelInput` and other supported result/report artifacts retain exact values. No silent numerical redaction or source/storage URL is introduced.

For `export.download` and `share.download`, first select `bundleRef` with the corresponding read operation and pass outer `expectedDownload: { contentHash, byteSize }`. The tool requires that selection and checks the returned reference and actual decoded bytes before disclosure. Passing this field on another operation is rejected. Export bytes remain the unchanged signed owner bundle; transport integrity does not independently establish signer trust, current disclosure authorization or scientific approval. The existing CLI offline verifier or another explicitly trusted owner verifier owns that separate signature/trust-anchor step.

## Explicit mutation recovery

The successful result is `{ ok: true, outcome: "confirmed", requestSha256, response }`. `requestSha256` hashes the exact UTF-8 JSON sent by this transport; it is a transport receipt, never the domain canonical config/model/content identity. MCP preserves supplied scientific strings, request IDs, idempotency keys and CAS selectors. It generates no mutation key and stores no server-side recovery journal.

The caller must retain its original request. If dispatch may have happened but no valid bound result is available, return `outcome: "unknown"` and a recovery receipt containing the request digest, schema, operation, request ID and supplied idempotency key. The wrapper never echoes mutation prose/content. The caller may explicitly resend the identical original request with `priorUncertainRequestSha256` copied from that receipt. A changed request/key/digest is rejected before I/O and retains only the original uncertain digest. No instruction authorizes a new key or infers no effect.

A valid successful same-request retry confirms the outcome. A later denial/error, including revoked permissions, preserves `outcome: "unknown"` for the original mutation. Local validation, missing backend, cancellation or missing credentials during recovery also retain that original uncertainty. All dispatched mutation errors preserve `unknown`: even a valid bound deadline, upstream or reference-validation error can follow a committed effect. Query domain errors report `rejected` for that attempt. Missing credentials and local validation before an initial mutation remain `not_dispatched`; a prior uncertain mutation remains unknown through those later failures. New requests never inherit guessed state. The client retains original credentials locally and refreshes/revokes through the established OAuth flow; MCP does not bypass current authorization to settle an uncertain mutation.

## Qualification and delivery

Offline tests must exercise real SDK registration/calls, all five owner families, malformed/binding substitution, exact token forwarding, denial redaction, lost-response/same-key recovery, request mutation rejection, source refusal, size/hash/redirect/deadline/cancellation and a 4 MiB decoded artifact. The packed gate proves contained codecs and real SDK calls from an independently installed production package; the clean-worktree gate repeats without sibling imports.

Actual installed MCP → owned non-production Edge/Database/Worker/Storage qualification, admitted OAuth actor/client proof, denial/revocation and explicit mutation recovery are distinct acceptance work. Historical V2–V5 evidence belongs to MCP #104 and numerical root #2208. New V6 installed execution remains pending under MCP #107; previous-family evidence does not qualify it. Required four-platform CI, independent review, Main merge and exact workspace #2181 integration remain required. Publishing npm, Docker, deploying a service and P5 rollout are separate actions.

W15's current consumer work adds no exported-HTML action host or OpenLCA Study engine. HTML action hosting is conditional on a demonstrated unmet domain action; existing exports are self-contained facts. OpenLCA remains a separately qualified interoperability profile. No MCP result waives P4's real industry positive-case, methodology, scale, source-rights or professional-review boundaries.

## V6 method consumer qualification

The V6 artifact pins clean committed Edge source `c322ec2d018dcd0cbb66549ecbddfbe8b10dc59b`, manifest SHA-256 `003deb096baa38b7ff6cb5474815ea0eb92bb4c6d188bb6c27f81448026d0427`. Its required async `validateResponseContentForRequest` complements synchronous selection: evidence-create receipts bind the original content hash and byte size, and method config identity remains owner-defined. MCP invokes the existing owner config hash helper to reject an inconsistent caller-supplied hash before dispatch; it generates no config field. All successful/denied V6 responses pass the owner async complement before disclosure. No domain canonicalization is implemented in MCP.

V6 is an explicit independent family, with thirty-three owner operations. `method.evidence.create/read` records and selects evidence; `method.assessment.request/read` starts and reads an assessment bound to the original baseline/config/module. Use its typed `methodAssessment` selector for task actions. A completed job is a runtime fact; it does not establish method conformity. Capabilities preserve exact limits and runtime admission.

Method evidence remains `recorded_unverified`, including a record declared as professional evidence. The CLI or other caller retains exact identifiers and uses a separately trusted verifier for export4. MCP preserves the owner's method facts, all unavailable reasons and source/coverage states without recalculation, rounding, truncation or additional approval flags. The present pinned factor set and all-pairs coverage make complete-sixteen normalization/weighting unavailable for every legal nonempty inventory; absent source factors do not become zero or scientifically non-applicable. Complete industry-case and professional acceptance remain in workspace #2181.

The canonical tests include exact synthetic public DTO fixtures extracted from a recorded Edge commit; their source hash and classification accompany the fixture. They exercise evidence and assessment selection, opaque 4MiB method facts, Unicode/byte and extra approval rejection, export review-CAS substitution, and sticky same-request recovery after denial. They do not assert the synthetic artifact metadata or placeholder signatures were registered in a live Study. Installed-package discovery verifies V6 owner schema bytes; auxiliary tampering is rejected even after prior codec import, then the owned installed file is restored.

The corrected V6 owner parser rejects isolated UTF-16 surrogates in report create/save authored content before transport. Valid Unicode remains unchanged. Its request/response schema bytes remain identical to the original a33 candidate; the contained declarations additionally expose the owner’s three artifact readers, which this MCP adapter does not invoke. Earlier candidate packages and their CI evidence remain distinct.
