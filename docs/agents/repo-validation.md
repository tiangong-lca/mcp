---
title: mcp Validation Guide
docType: guide
scope: repo
status: active
authoritative: false
owner: mcp
language: en
whenToUse:
  - when a tiangong-lca-mcp change is ready for local validation
  - when deciding the minimum proof required for transport, auth, tool-wrapper, config, or docs changes
  - when writing PR validation notes for tiangong-lca-mcp work
whenToUpdate:
  - when the repo gains a new canonical test wrapper or safer validation path
  - when change categories require different proof
  - when runtime prerequisites or validation caveats change
checkPaths:
  - docs/agents/repo-validation.md
  - .docpact/config.yaml
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
lastReviewedAt: 2026-11-10
lastReviewedCommit: 3478b011958c2a15efc088049550cb212a00214c
lastReviewedNote: 'MCP #109: reviewed calculation discovery and explicit V2–V6 guidance. Stable tool/resource identifiers, exact owner schema bytes, authorization, packaging and hosted admission are unchanged.'
related:
  - ../../AGENTS.md
  - ../../.docpact/config.yaml
  - ./repo-architecture.md
  - ../../README.md
  - ../../README_CN.md
  - ../../DEV_EN.md
  - ../../DEV_CN.md
---

## Default Baseline

Unless the change is doc-only, the current baseline is:

```bash
pnpm install --frozen-lockfile
pnpm prepush:gate
```

The gate is intentionally non-mutating and includes:

- type-aware Oxlint with warnings denied, Prettier check, and TypeScript 7 typecheck
- offline Node assertions for tool, TIDAS, LifecycleModel, CRUD/search, auth, HTTP, error, and cancellation contracts
- packed runtime-consumer validation in a path containing spaces, including a real global-bin `/health` probe through the package-manager shim
- build, exact toolchain assertion, the declared high-severity `pnpm run audit` script, and dry-run pack
- a frozen install plus lint/test/build/toolchain/pack rerun in a clean arbitrary-path worktree

The clean-worktree check resolves the source checkout's store with the verified pnpm executable, then checks that the same explicit `--store-dir` resolves to that exact store in the temporary worktree before installation. It passes the store option only to the fresh `--frozen-lockfile` install; copied inputs, independent `node_modules`, arbitrary paths with spaces, Windows cross-volume placement and all later gates/cleanup remain unchanged. No installed runtime or gate result is reused and no global pnpm configuration is changed. Missing, malformed or inconsistent store discovery fails before installation. pnpm copies packages instead of hardlinking when the explicit store is on another filesystem; compare actual download/import overhead on the same workload rather than assuming a net speedup from fewer downloads.

## Validation Matrix

`test/backend-configuration.test.ts` uses isolated process environments and a fetch replacement to prove that missing/blank/invalid backends cause zero fetches across all three searches, CRUD reads, and ordinary/LifecycleModel commands. It checks the shared guards used by model process lookup, explicit custom/loopback targets, missing database keys, and real STDIO initialization/listing/local guidance with and without a backend. Empty raw query/fragment delimiters (`?`/`#`) are rejected before any fetch, including when the URL parser reports an empty query or fragment. Existing success tests explicitly select a synthetic mocked backend. HTTP OAuth and strict-invalid model zero-fetch tests remain required.

| Change type | Minimum local proof | Additional proof when risk is higher | Notes |
| --- | --- | --- | --- |
| `src/index*.ts`, `src/http_app*.ts`, or transport init helpers | `pnpm test`; `pnpm build` | run the relevant built entrypoint through the intended start script when the task explicitly includes an interactive smoke check | Offline tests cover import side effects, health, method guards, JSON-RPC parsing, discovery, cleanup, cancellation, and repeated authenticated/local factory throws with sentinel leak checks. |
| Supabase JWT verification, protected-resource config, or OAuth flow | `pnpm test`; `pnpm lint` | run authorized Dev PKCE/refresh/revoke proof with exact public clients, then record it separately | Tests cover Supabase authorization-server discovery, no local OAuth endpoints, ES256 `getClaims()` verification, issuer, `aud=authenticated`, expiry, future issued-at, UUID subject/session/client, role, exact client admission, SDK auth context, Origin, provider-error redaction, and complete absence of server-side authorization state. Denials use OAuth-standard 401 and never expose provider details. |
| search wrappers, GLAD dataset tools, DB CRUD wrapper, or lifecyclemodel preprocessing | `pnpm test`; `pnpm lint` | run an authorized remote case only when its external owner and safety boundary are explicit | Offline tests mock search transport, reject malformed CRUD input before network access, prove select uses PostgREST, ordinary writes use the three exact dataset-command URLs, and LifecycleModel writes use save/delete bundle URLs with the prepared parent plan (never raw table DML). They run all declared TIDAS types through SDK `validateEnhanced()` and prove a real strict-invalid LifecycleModel with a structurally valid access JWT plus refresh token returns normalized issues with fetch count zero before any auth/session/REST/write action. |
| local OpenLCA helpers | `pnpm build`; `pnpm lint` | run `pnpm exec tsx scripts/openlca-ipc-smoke.ts` only when the task explicitly includes a local OpenLCA smoke check | The active runtime path is `olca-ipc`, not the commented gRPC scaffold. |
| package, dependency, pnpm, Node, TypeScript, lint, Docker, or client config | `pnpm prepush:gate`; `pnpm outdated --format json`; `pnpm peers check` | inspect `pnpm list --depth Infinity` when compiler, peer, or runtime leakage is in scope; after publishing, compare registry version/integrity and packed direct-JWT files, then run a no-cache no-provenance Linux ARM64 Docker build, inspect patched OS packages plus OCI architecture/PATH/default bin, push an absent immutable-style tag, verify a single scan-compatible manifest, reuse scan-on-push or start only for `ScanNotFoundException`, and wait for COMPLETE with zero HIGH/CRITICAL | Direct packages must be latest stable for Node 24; retain `@types/node` on its latest 24.x release even when a newer runtime major exists. Inspector 2.11's React peer graph is development-only and must be clean while absent from the packed production tree. Preserve every non-`ScanNotFoundException` probe failure. Require `apk upgrade --no-cache`, `--provenance=false`, and a fail-closed COMPLETE/zero-CRITICAL/zero-HIGH assertion before run; Docker's global package pin must equal `package.json.version`. Packed-consumer proof must contain the OAuth runtime, Supabase JWT verifier, and HTTP app, prove stateful and compatibility modules absent, then execute the global HTTP bin through the generated package-manager shim and receive `/health`. |
| release automation under `scripts/ci/**` or `.github/workflows/publish.yml` | inspect the workflow/script diff; `pnpm prepush:gate` | record tag naming, `main` ancestry, and unpublished-version checks | The feature task prepares release-ready artifacts; version/tag/publish remains a separately tracked release action. The release-context decision itself executes against local git fixtures via `test/release-context.test.mjs` (canonical admission, previous-owner/fork rejection, unchanged-version no-release, matching tag release). |
| `public/**` only | `pnpm build`; `pnpm lint` | confirm no authorization code/token display page became reachable | The directory is packaging-compatible only; remote OAuth protocol endpoints are runtime routes and no static demo is served. |
| governed docs only | `scripts/docpact validate-config --root . --strict`; `scripts/docpact lint --root . --staged --mode enforce` | run one focused route check such as `transport-auth`, `mcp-tools`, or `openlca-tidas` when routing changes | Refresh review metadata even when prose-only docs change. |

Dependency proposals reuse this existing gate without a new general check. See [dependency maintenance](dependency-maintenance.md) for grouped monitoring, lock-only governance and the unqualified Docker-monitoring prerequisite.

## Known Caveats

MCP #97 repairs the inherited high-severity audit blockers with Zod `4.6.7`, body-parser `2.4.0`, Vite `8.2.4`, and Undici `8.12.3`. The Vite/Undici resolutions stay on the existing minor branches; Zod/body-parser need the next minor to receive the fixes. No dependency overrides, source package version, SDK, Express, Node, pnpm, or Docker pin change is part of this repair. The baseline audit had four high findings; the reviewed candidate has zero high/critical and retains two low/two moderate findings. Keep the ordinary audit gate and all transport/auth/validation tests.

Facts that matter today:

- `.nvmrc`, `Dockerfile`, package engines, pnpm workspace policy, and maintainer docs must stay aligned on Node `24.19.0` and pnpm `11.24.0`
- the only compiler in the direct or recursive graph is TypeScript `7.0.2`; SDK `0.2.0` must not reintroduce `ts-to-zod` or TypeScript 5/6
- local tests do not contact TianGong production, GLAD, Supabase, or OpenLCA; external proof must be separately authorized and recorded
- local OAuth tests inject verified claim results; they do not prove a live Supabase client registration, PKCE exchange, grant/revoke behavior, ALB route, or ECS configuration
- the four-platform workflow is the authoritative portability proof after PR submission; local macOS proof alone is not four-platform evidence
- `.gitattributes` enforces LF for tracked text so Windows checkout cannot turn a read-only Prettier check into a whole-repository false failure
- `pnpm/setup` native distributions do not guarantee `COREPACK_ROOT`; nested tests must pass with that variable absent, exact native `pnpm`/`pnpm.exe`, paths containing spaces, and `shell: false`

## Minimum PR Note Quality

A good PR note for this repo should say:

1. which commands ran
2. exact test count and whether packed-consumer and clean-worktree proofs passed
3. whether a manual transport, OAuth, or OpenLCA proof was performed or deferred
4. whether any required remote runtime proof belongs in another repo

## Local Docpact Push Gate

Install the versioned local hook once per checkout:

```bash
./scripts/install-git-hooks.sh
```

The `pre-push` hook runs `scripts/docpact-gate.sh`, which delegates CLI lookup to `scripts/docpact` and performs strict config validation plus enforced lint before the push leaves the machine. The wrapper checks `DOCPACT_BIN`, Cargo install locations, Homebrew install locations, and then `PATH`, so local agent shells should not fail only because bare `docpact` is unavailable. The default comparison base is `origin/main`. Override it for unusual stacks with `DOCPACT_BASE_REF=<ref>` or `scripts/docpact-gate.sh --base <ref>`. The gate writes its detailed report to a temporary file so normal pushes do not create `.docpact/runs/` artifacts.

## Study consumer qualification

[The Study contract](study-api-contract.md) defines the mandatory behavior suite in `test/study.test.ts`, producer asset integrity and packed protocol checks. `pnpm prepush:gate` remains the complete gate. Installed non-production MCP actor/client → Edge/Database/Worker/Storage, revocation and explicit same-key mutation recovery require separately bound receipts on MCP #104; offline protocol mocks do not replace them. Producer assets alone do not establish Main eligibility, deployment or scientific qualification.

MCP #104 additionally covers a valid approximately 200 KiB Study request through an actual authenticated SDK HTTP connection, proving that the outer parser accepts it before the independent 256 KiB inner bound. Malformed and oversized outer bodies receive fixed JSON errors without body/stack disclosure. Bound mutation deadline/upstream/reference errors retain uncertainty and support only explicit identical-request recovery.

Study resource discovery/read checks use the real SDK on authenticated, STDIO and local factories. They compare all five request-schema byte hashes to owner files, reject unknown versions, preserve OpenLCA resources and confirm no local HTTP Study registration. The packed consumer repeats schema reads and changes one installed auxiliary schema to prove integrity failure even after an earlier successful codec load, then restores and re-verifies it.

The V2 archive owner-consumer regression rejects active post-state and wrong CAS generations; it was red against the original5b artifact and is qualified against the separately pinned Edge #556 package. Preserve the old failure and exact new producer identity. Packed negative tests detach the owned installed schema hardlink before modifying bytes, avoiding any mutation of the shared pnpm store.

MCP #107 extends the same gate to V6. Exact owner-generated method/evidence fixtures are transport evidence only; their committed source/hash and synthetic classification are retained. Schema discovery, recorded-unverified output, request/response selection, export CAS, method-facts integrity and sticky unknown recovery must pass alongside all historical tests. The packed gate reads all five schemas and rejects tampering in both the historical V2 and V6 files without touching the shared package store. Actual V6 OAuth/native/Storage proof, source CI, Main merge and root #2181 inclusion remain separate acceptance steps.

The final V6 facade correction additionally checks malformed report create/save Unicode before any transport call, alongside legal Unicode positives. Exact request/response schema bytes remain compatible; source artifact identity and prior successful CI remain separately recorded.
