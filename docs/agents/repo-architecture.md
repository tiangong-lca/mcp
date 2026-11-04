---
title: mcp Architecture Notes
docType: guide
scope: repo
status: active
authoritative: false
owner: mcp
language: en
whenToUse:
  - when you need a compact mental model of the repo before editing transports, auth, or tool wrappers
  - when deciding which runtime mode or tool family owns a behavior change
  - when auth, OAuth, search-wrapper, or OpenLCA hotspots are mentioned without exact paths
whenToUpdate:
  - when major runtime modes or tool families change
  - when auth flow or external dependency boundaries move
  - when the current map becomes misleading
checkPaths:
  - docs/agents/repo-architecture.md
  - .docpact/config.yaml
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - tsconfig.json
  - tsconfig.build.json
  - .gitattributes
  - scripts/ci/**
  - .github/workflows/publish.yml
  - .github/workflows/quality-gate.yml
  - src/**
  - public/**
  - test/**
  - .githooks/pre-push
  - scripts/docpact
  - scripts/docpact-gate.sh
  - scripts/install-git-hooks.sh
lastReviewedAt: 2026-11-04
lastReviewedCommit: 1d6b50a
lastReviewedNote: 'MCP #104: reviewed explicit actor-authenticated V2-V5 Study consumer, exact Edge artifacts, bounded downloads, source refusal and sticky same-key mutation recovery. Canonical source/packed/clean gates, independent review and installed runtime qualification are recorded separately; no publication or P5 enablement.'
related:
  - ../../AGENTS.md
  - ../../.docpact/config.yaml
  - ./repo-validation.md
  - ../../README.md
  - ../../README_CN.md
  - ../../DEV_EN.md
  - ../../DEV_CN.md
---

## Runtime Mode Matrix

| Mode | Entry file | Main surface | Tool families exposed |
| --- | --- | --- | --- |
| STDIO | `src/index.ts` | `StdioServerTransport` | search wrappers, GLAD dataset tools, OpenLCA tools, prompts, resources, guidance |
| HTTP | `src/index_server.ts` | OAuth-protected Streamable HTTP on `POST /mcp`, `/health`, root discovery, and protected-resource metadata | search wrappers, GLAD dataset tools, and `Database_CRUD_Tool` |
| HTTP local | `src/index_server_local.ts` | local Streamable HTTP on `POST /mcp` plus `/health` | OpenLCA tools, TIDAS validation, prompts, resources |

The executable HTTP entries delegate app construction to `src/http_app.ts` and `src/http_app_local.ts`. Importing an entry does not bind a port; each stateless request receives a request-scoped MCP server and transport, and response closure triggers bounded cleanup. Server construction itself is inside the common JSON-RPC error boundary, so both authenticated and local factory throws return a generic JSON 500 without leaking the exception or Express stack HTML. Authenticator, factory, and transport logs expose only stable redacted code/category fields, never the caught message or stack. This split is the offline test seam for health, method guards, auth errors, JSON-RPC errors, discovery, cancellation, and factory cleanup.

## Auth Decision Tree

The authenticated HTTP path is a stateless Supabase OAuth resource server. `src/_shared/oauth_runtime.ts` configures the production issuer, public client allow-list, protected-resource metadata, and cached `getClaims()` verifier. `src/_shared/supabase_jwt_verifier.ts` validates ES256 signature evidence plus issuer, `aud=authenticated`, expiry, issued-at, subject, role, session, and exact `client_id`, then attaches the SDK `AuthInfo` to the request. Tool wrappers receive the already verified inbound Supabase access token; Edge and PostgREST independently verify it and apply actor/client authorization.

The remote server stores no authorization state or tokens. Supabase Auth owns codes, access/refresh issuance, refresh rotation, grants, and revocation; Claude Code, Codex, Inspector, and other public clients store their own refresh tokens. Cognito and password-encoded user API keys remain absent without fallback I/O.

## OAuth Surface

The authenticated HTTP server publishes:

- `/.well-known/oauth-protected-resource/mcp` for the canonical MCP resource;
- `POST /mcp` with a `WWW-Authenticate` challenge that points to protected-resource metadata.

Protected-resource metadata identifies `https://<project-ref>.supabase.co/auth/v1` as the authorization server. The client discovers Supabase's authorization/token/JWKS endpoints, completes Authorization Code with S256 PKCE, and sends the resulting access JWT on every MCP request. The MCP origin does not expose authorization, token, refresh, revoke, callback, registration, or code-display routes. Supabase Dynamic Client Registration remains disabled; operators register exact public clients and loopback callbacks.

## Tool Families

### Remote search wrappers

These wrappers forward bearer auth and region headers to remote Edge Functions:

- `src/tools/flow_hybrid_search.ts`
- `src/tools/process_hybrid_search.ts`
- `src/tools/life_cycle_model_hybrid_search.ts`

They are wrappers, not the underlying search implementation.

`src/_shared/config.ts` has no default Supabase backend or publishable key. All three search wrappers call the lazy `requireSupabaseBaseUrl()` guard before fetch. CRUD Edge commands and both CRUD/model process-lookup Supabase client factories use that same URL guard plus `requireSupabasePublishableKey()`. Local initialization and tools remain independent of those settings; the authenticated HTTP startup keeps its separate strict OAuth configuration checks. GLAD remains an explicitly separate public API dependency.

### GLAD dataset lookup

The GLAD tools call the public Global LCA Data Access API directly and require `GLAD_API_KEY` in the MCP server environment:

- `src/tools/glad_dataset_search.ts`

These tools are read-only API wrappers for dataset descriptor search and single dataset descriptor retrieval.

### CRUD and lifecyclemodel preprocessing

The MCP-side write and preprocessing logic clusters around:

- `src/tools/db_crud.ts`
- `src/tools/life_cycle_model_file_tools.ts`

This path calls SDK `validateEnhanced()` once before graph construction or Supabase process lookup. Select remains an actor-bound PostgREST read. Ordinary insert/update computes the prepared payload once, then calls `app_dataset_create` or `app_dataset_save_draft`; ordinary delete calls `app_dataset_delete`. LifecycleModel insert/update instead sends the prepared `jsonOrdered`/`jsonTg` parent through `save_lifecycle_model_bundle`, and delete uses `delete_lifecycle_model_bundle`, preserving the existing atomic bundle contract. These Edge commands preserve the downstream Supabase actor/client token and invoke the existing command-cutover RPCs: the MCP client receives `DB-CORE-WRITE-01` for ordinary dataset commands and `EDGE-BUNDLE-01` for LifecycleModels, so raw core-table DML never reopens. Strict-invalid LifecycleModels throw a stable `TIDAS_VALIDATION_FAILED` envelope with normalized code/path/severity, make zero auth/REST/process-lookup requests, and never reach a write. A strict-success result alone may derive `json_tg` and `rule_verification`; insert/update responses echo the exact SDK `validationIssueCount` and `validationIssues` (normally zero/empty in strict success), and those response-evidence fields are not added to the database row.

### Local OpenLCA and TIDAS validation

This cluster lives in:

- `src/tools/openlca_ipc_lcia.ts`
- `src/tools/openlca_ipc_lcia_methods_list.ts`
- `src/tools/openlca_ipc_system_processes_list.ts`
- `src/tools/tidas_data_validation.ts`

The active local OpenLCA integration uses `olca-ipc`. The `openlca_grpc.ts` file is scaffold only.

## External Dependency Boundaries

- `edge-functions` owns remote hybrid-search and API runtime behavior
- `next` owns product UI behavior
- `tidas-tools` owns standalone conversion, export, and batch validation tooling
- this repo owns MCP transports, auth classification, and tool exposure

## Release Architecture

`main` pushes whose `package.json` version changes create the matching `v<version>` tag, install with pnpm's frozen lock, run the canonical pre-push gate, and publish `@tiangong-lca/mcp-server` through pnpm. Manual `v*` tag pushes and workflow-dispatch runs for existing tags remain recovery/backfill paths.

The Docker runtime installs that same exact package version. Packed-consumer proof must import all three entrypoints without side effects, assert that the production archive contains the OAuth runtime, Supabase JWT verifier, and HTTP app while every removed stateful-auth module is absent, then execute the globally installed HTTP bin through the generated package-manager shim and receive `/health`. A registry tarball published before those modules or executable proof existed is not an eligible image input even when the repository Dockerfile itself comes from a newer commit.

On Node Alpine, Corepack activation and pnpm global installation are separate boundaries: `corepack enable pnpm` creates the executable shim, exact global install activates `11.24.0`, and `/pnpm/bin` must remain in the final OCI `PATH` so the packaged MCP bins are the default container command. A real no-cache Linux ARM64 build is the required proof for this path.

The build upgrades Alpine packages before package-manager setup and records the installed OpenSSL version. The ECR qualification command disables provenance so the tag resolves to one scan-compatible ARM64 image manifest instead of an OCI index. The tag is commit-bearing and must be absent before push. Qualification reuses scan-on-push, starts only for `ScanNotFoundException`, preserves every other probe error, and exits before run unless the result is COMPLETE with exactly zero CRITICAL and HIGH findings. A vulnerable or unscannable image remains evidence only and is never an ECS task input.

The MCP `0.2.1` package graph is single-track Node `24.19.0`, pnpm `11.24.0`, TypeScript `7.0.2`, TIDAS SDK `0.2.0`, Supabase JS `2.118.0`, MCP SDK `1.32.1`, and Zod `4.6.7`. Inspector `2.11.0`, React DOM `19.3.1`, and tsx `4.23.13` are development-only; The root React DOM pair supports Inspector's optional development peer graph without entering the production archive. The packed-consumer proof imports all three packaged entry modules from an arbitrary path, verifies that compiler, lint, test, and Inspector/React tooling is absent from the production install, and proves that canonical realpath comparison still treats the generated global shim target as the executable entrypoint.

Inspector's published web assets contain their own prebundled React and React DOM `19.3.0`; those bytes are unchanged by this root peer update. Its TUI retains the matched React `19.2.8`, Ink `6.8.0`, and reconciler `0.33.0` branch. Qualify the root React DOM pair separately rather than treating the prebundled web client as execution proof for it.

Inspector's split v2 client/core/server packages remain development-only. The packed-consumer proof recursively inspects its actual production install, requires SDK `1.32.1`, and rejects Inspector and its split v2 packages throughout the dependency tree.

Nested consumer and clean-worktree commands cannot assume Corepack environment variables: they scan `PATH` for the official native `pnpm` or `pnpm.exe`, verify exact version `11.24.0`, and execute with argv plus `shell: false`. A verified `COREPACK_ROOT/dist/pnpm.js` invocation remains a fallback for local Corepack shells.

## Common Misreads

- this repo is not the source of truth for remote search algorithms
- the MCP server is not an authorization server; Supabase owns OAuth endpoints and Next owns login/consent at `/oauth/consent`
- `pnpm test` is an offline assertion suite; it does not imply live OpenLCA, GLAD, Supabase, or production proof
- a merged child PR does not finish workspace delivery

## Local Docpact Push Gate

This repository has a versioned local `pre-push` hook under `.githooks/pre-push` that delegates to `scripts/docpact-gate.sh`. The gate resolves the CLI through `scripts/docpact`, so local agent shells do not need bare `docpact` on `PATH`. The hook is a local developer guard for docpact config validation and enforced doc-governance linting; ordinary PRs and pushes rely on the local gate; `.github/workflows/ai-doc-lint.yml` is manual-dispatch fallback for remote reproduction.

## Study workflow adapter

`src/tools/study.ts` exposes the public Study workflow with explicit V2–V5 selection and verified contained Edge codecs. `src/_shared/study_codec.ts` checks producer manifests/files before evaluation. Authenticated request-scoped factories forward the same verified bearer. See [the Study contract](study-api-contract.md) for mutation uncertainty, exact download selectors, 256 KiB requests/6 MiB response envelopes/4 MiB decoded artifacts, 25-second deadline and raw source packet refusal. The adapter adds no stateful OAuth, direct database/CLI path, numerical calculation or production enablement.
