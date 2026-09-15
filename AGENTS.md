---
title: mcp AI Working Guide
docType: contract
scope: repo
status: active
authoritative: true
owner: mcp
language: en
whenToUse:
  - when a task may change MCP transports, auth surfaces, tool registration, Supabase JWT verification, or lifecycle-model preprocessing in tiangong-lca-mcp
  - when routing work from the workspace root into tiangong-lca-mcp
  - when deciding whether a change belongs here, in tiangong-lca-edge-functions, in tiangong-lca-next, or in tidas-tools
whenToUpdate:
  - when runtime modes, auth boundaries, or tool registration change
  - when validation or runtime prerequisites change
  - when docpact routing, retained source docs, or repo-local governance rules change
checkPaths:
  - AGENTS.md
  - README.md
  - README_CN.md
  - DEV_EN.md
  - DEV_CN.md
  - .docpact/config.yaml
  - docs/agents/**
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - .nvmrc
  - .gitattributes
  - tsconfig.json
  - tsconfig.build.json
  - .oxlintrc.json
  - Dockerfile
  - .env.example
  - mcp_config.json
  - src/**
  - public/**
  - test/**
  - scripts/ci/**
  - .github/workflows/publish.yml
  - .github/workflows/quality-gate.yml
  - .githooks/**
  - scripts/docpact
  - scripts/docpact-gate.sh
  - scripts/install-git-hooks.sh
lastReviewedAt: 2026-09-15
lastReviewedCommit: 7a6c4797472fe3cebea24db7f79ec834d00bf663
lastReviewedNote: 'Reviewed for MCP #80: clean-worktree verification explicitly reuses only the exact source pnpm store after target-context roundtrip validation. Fresh tracked-only temporary inputs, independent node_modules, frozen lock, arbitrary/cross-volume paths, all gate stages and cleanup are preserved. Primary independent source review and focused real-entrypoint tests pass; complete local canonical gate passed. No package/runtime/lock/release or cloud change. Four-platform CI and measured Windows benefit remain pending.'
related:
  - .docpact/config.yaml
  - docs/agents/repo-validation.md
  - docs/agents/repo-architecture.md
  - README.md
  - README_CN.md
  - DEV_EN.md
  - DEV_CN.md
---

## Repo Contract

`tiangong-lca-mcp` owns TianGong LCA MCP transports and tool exposure: STDIO, authenticated Streamable HTTP, local Streamable HTTP, OAuth helpers, tool registration, and lifecycle-model preprocessing that is intentionally part of the MCP surface. Start here when the task may change how MCP clients connect or what this MCP server exposes.

## Bootstrap Order

Load docs in this order:

1. `AGENTS.md`
2. `.docpact/config.yaml`
3. `scripts/docpact route --root . --intent <intent>` when you need path-specific routing
4. `docs/agents/repo-validation.md` when proof, runtime caveats, or CI behavior matters
5. `docs/agents/repo-architecture.md` when transport, auth, OAuth, or tool ownership is unclear
6. `README.md`, `README_CN.md`, `DEV_EN.md`, or `DEV_CN.md` only when user setup or maintainer runtime details are needed

Do not start by assuming that remote search behavior or product UI truth lives in this repository.

Preferred docpact commands:

- `scripts/docpact route --root . --intent transport-auth`
- `scripts/docpact route --root . --intent mcp-tools`
- `scripts/docpact route --root . --intent remote-search-wrappers`
- `scripts/docpact route --root . --intent openlca-tidas`
- `scripts/docpact route --root . --intent repo-docs`

## Repo Ownership

This repo owns:

- MCP transports under `src/index.ts`, `src/index_server.ts`, and `src/index_server_local.ts`
- Supabase JWT verification, protected-resource metadata, and auth configuration under `src/_shared/**` and `src/http_app.ts`
- MCP tool registration and tool wrappers under `src/tools/**`
- MCP prompts and resources under `src/prompts/**` and `src/resources/**`
- the fixed-client Supabase OAuth 2.1 protected-resource discovery and bearer-verification boundary
- the checked-in client example in `mcp_config.json`

This repo does not own:

- remote search implementation or Edge Function business logic
- Next.js product UI behavior
- standalone TIDAS conversion, export, or batch tooling
- workspace integration state after merge

Route those tasks to:

- `tiangong-lca-edge-functions` for remote hybrid-search or API runtime behavior
- `tiangong-lca-next` for product UI behavior
- `tidas-tools` for standalone conversion, validation, and export tooling
- `lca-workspace` for root integration after merge

## Runtime Facts

- Repo-local documentation governance is encoded in `.docpact/config.yaml` and enforced locally by the pre-push docpact gate; `.github/workflows/ai-doc-lint.yml` is manual-dispatch fallback.
- The only supported package-management path is pnpm `11.24.0`, selected by `packageManager`; installs use the root `pnpm-lock.yaml` with `--frozen-lockfile`.
- Runtime and compiler baselines are Node `24.19.0`, TypeScript `7.0.2`, and `@tiangong-lca/tidas-sdk` `0.2.0`; TypeScript 5/6 and compiler-API formatting plugins are not allowed in the direct or recursive graph.
- `pnpm lint` is read-only: type-aware Oxlint, Prettier check, and TypeScript typecheck run without rewriting source. Use `pnpm format` for explicit formatting writes.
- `pnpm test` runs real Node assertions for tool registration, every declared TIDAS dataset validation boundary, CRUD/search guards, LifecycleModel `validationIssues`, authenticated/local Streamable HTTP envelopes, cancellation, Supabase JWT claims, protected-resource discovery, client admission, Origin rejection, and removed-state absence.
- SDK validation uses `validateEnhanced()` exactly once per entity and consumes normalized `validationIssues`. Insert/update prepares and validates once before transport. Reads use actor-bound PostgREST; ordinary create/save/delete uses `app_dataset_create`, `app_dataset_save_draft`, and `app_dataset_delete` (`DB-CORE-WRITE-01`), while LifecycleModels use `save_lifecycle_model_bundle` and `delete_lifecycle_model_bundle` (`EDGE-BUNDLE-01`). No MCP write uses raw table DML. Strict-invalid LifecycleModels therefore perform zero auth/REST/process-lookup requests and can never reach a write; their stable error envelope exposes normalized code/path/severity without raw Zod parsing.
- `pnpm prepush:gate` is the canonical gate. It also proves the packed runtime consumer, a clean arbitrary-path worktree, build, audit, and pack contract.
- Nested package tests resolve and verify the exact native `pnpm`/`pnpm.exe` executable first with `shell: false`; Corepack JavaScript is only a fallback. Do not assume `COREPACK_ROOT` exists in `pnpm/setup` runners.
- `.github/workflows/quality-gate.yml` runs the canonical gate on Linux x64, Windows x64, macOS arm64, and Linux arm64.
- Published binaries:
  - `tiangong-lca-mcp-stdio`
  - `tiangong-lca-mcp-http`
  - `tiangong-lca-mcp-http-local`
- Direct dependencies must use the latest stable versions compatible with Node `24.19.0` and the reviewed MCP v1 transport. Keep `@types/node` on the latest Node 24 line instead of importing Node 26 types, and require `pnpm peers check` because Inspector 2.4 needs a React 19-compatible development peer graph. Development-only Inspector/React packages must remain absent from the packed production install.
- `@tiangong-lca/tidas-sdk` stays exact at npm latest `0.2.0`; dependency refreshes must still run all declared TIDAS types and the strict-invalid LifecycleModel zero-fetch boundary.
- `Dockerfile` must install the exact version in `package.json`. The packed-consumer gate must find the OAuth runtime, Supabase JWT verifier, and HTTP app in that package, prove every removed stateful-auth module is absent, then execute the globally installed HTTP bin through its package-manager shim and receive `/health` before a registry release or ECS image can claim the reviewed source.
- The Docker runtime must run `corepack enable pnpm` before exact global activation, keep both `/pnpm/bin` and `/pnpm` on OCI `PATH`, and pass a real no-cache Linux ARM64 build; a source-only regex check is not image evidence.
- The same no-cache build must run `apk upgrade --no-cache` before package-manager setup, read back the patched OpenSSL package, and reach a COMPLETE ECR scan with zero CRITICAL/HIGH findings before ECS may use the digest.
- The ECR qualification build must use `--provenance=false` and resolve to one scan-compatible ARM64 image manifest. Probe for an existing scan first so scan-on-push results are reused; start a scan only for an explicit `ScanNotFoundException`, and preserve every other probe failure. The deployment script must exit before `docker run` unless ECR reports COMPLETE with exactly zero CRITICAL and HIGH findings. An OCI index rejected by ECR basic scanning is evidence only and cannot be pushed again, run, or registered in ECS.
- Release tags use `v<package.json version>`; canonical `main` branch pushes whose package version changes create the matching tag when missing, run the release gate, and publish `@tiangong-lca/mcp-server` to npm in the same workflow run
- Manual `v*` tag pushes and `workflow_dispatch` runs for an existing release tag whose target commit is already on `main` remain supported for recovery/backfill releases
- HTTP entry modules are side-effect free when imported. `src/http_app.ts` and `src/http_app_local.ts` own app construction; the executable entry files only listen when they are the process entrypoint.
- Authenticated and local request-scoped MCP server factory failures share the generic JSON-RPC 500 boundary; internal exception messages and stacks must never fall through to Express HTML responses or logs. Failure logs contain only stable redacted code/category fields.
- Remote HTTP accepts only direct Supabase OAuth access JWTs from the configured ES256 issuer and exact public-client allow-list. It verifies signature, issuer, `aud=authenticated`, expiry, issued-at, subject, role, session, and `client_id`, then returns OAuth-standard `401 invalid_token` with the canonical `resource_metadata` challenge. Provider details, tokens, secrets, and stacks never enter responses or logs; Cognito and password-encoded user API keys remain absent.
- The remote service owns no authorization code, access/refresh grant, login session, refresh lock, or revocation store. Clients retain rotating refresh tokens locally; Supabase Auth owns authorization and revocation state.

## Hard Boundaries

- Do not treat the MCP repo as the source of truth for remote Edge search semantics
- Do not move product UI or app workflow behavior into this repo
- Do not add npm/package-lock paths, TypeScript 5/6, or compiler-API formatter plugins back into this repository
- Do not weaken offline behavior assertions to make a dependency upgrade pass; transport and tool contracts must be characterized first
- Do not treat a merged repo PR here as workspace-delivery complete if the root repo still needs a submodule bump

## Workspace Integration

A merged PR in `tiangong-lca-mcp` is repo-complete, not delivery-complete.

If the change must ship through the workspace:

1. merge the child PR into `tiangong-lca-mcp`
2. update the `lca-workspace` submodule pointer deliberately
3. complete any later workspace-level validation that depends on the updated MCP snapshot

## Local Docpact Push Gate

Install the versioned local hook once per checkout:

```bash
./scripts/install-git-hooks.sh
```

The `pre-push` hook runs `scripts/docpact-gate.sh`, which delegates CLI lookup to `scripts/docpact` and performs strict config validation plus enforced lint before the push leaves the machine. The wrapper checks `DOCPACT_BIN`, Cargo install locations, Homebrew install locations, and then `PATH`, so local agent shells should not fail only because bare `docpact` is unavailable. The default comparison base is `origin/main`. Override it for unusual stacks with `DOCPACT_BASE_REF=<ref>` or `scripts/docpact-gate.sh --base <ref>`. The gate writes its detailed report to a temporary file so normal pushes do not create `.docpact/runs/` artifacts.
