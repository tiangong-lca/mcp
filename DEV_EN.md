---
title: TianGong LCA MCP Maintainer Notes EN
docType: guide
scope: repo
status: active
authoritative: false
owner: mcp
language: en
whenToUse:
  - when you need maintainer-facing MCP development, formatting, testing, publish, or deployment commands in English
whenToUpdate:
  - when maintainer-facing runtime prerequisites, development commands, publish steps, or deployment notes change
checkPaths:
  - DEV_EN.md
  - DEV_CN.md
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - Dockerfile
  - .nvmrc
  - .gitattributes
  - src/**
  - test/**
  - scripts/**
lastReviewedAt: 2026-09-14
lastReviewedCommit: b7a27cda880e0638589e8264c4cef6bbc22d552d
lastReviewedNote: 'Reviewed for MCP #78 / release 0.2.1: exact helper-confirmed version projection advances 0.2.0 to 0.2.1 across package.json, the Dockerfile global pin, both live consumer/toolchain bindings and the four active Docker run examples, which now describe a local build only because no public Docker Hub prebuilt tag is verified. SDK stays exact 0.2.0; lock bytes, dependencies, Node 24.19.0, pnpm 11.24.0, TypeScript 7.0.2, runtime/auth behavior, workflow logic and every historical release fixture remain unchanged.'
related:
  - AGENTS.md
  - .docpact/config.yaml
  - docs/agents/repo-validation.md
  - docs/agents/repo-architecture.md
  - DEV_CN.md
---

# TianGong-AI-MCP

[中文](https://github.com/tiangong-lca/mcp/blob/main/DEV_CN.md) | [English](https://github.com/tiangong-lca/mcp/blob/main/DEV_EN.md)

TianGong AI Model Context Protocol (MCP) Server supports STDIO and StreamableHttp protocols.

## Starting MCP Server

### Client STDIO Server

```bash
corepack install --global pnpm@11.24.0
pnpm add --global @tiangong-lca/mcp-server

pnpm dlx dotenv-cli -e .env -- tiangong-lca-mcp-stdio
```

### Using Docker

```bash
# Build MCP server image using Dockerfile (optional)
docker build -t linancn/tiangong-lca-mcp-server:0.2.1 .

# Start MCP server using Docker
docker run -d \
    --name tiangong-lca-mcp-server \
    --publish 9278:9278 \
    --env-file .env \
    linancn/tiangong-lca-mcp-server:0.2.1
```

## Development

### Environment Setup

```bash
# Install Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
nvm install 24.19.0
nvm use 24.19.0

# Install the exact package manager and frozen dependency graph
corepack install --global pnpm@11.24.0
pnpm install --frozen-lockfile
```

### Supabase OAuth Resource Server Setup

The remote HTTP entry is configured from `.env.example`. It needs only the MCP public origin, Supabase project origin/publishable key, exact admitted public OAuth client IDs, optional browser origins, and GLAD configuration. It has no OAuth datastore, confidential client secret, or session-encryption input.

Dev requires these exact control-plane facts:

1. Supabase OAuth Server enabled with Dynamic Client Registration disabled and authorization path `/oauth/consent`.
2. Exact public Supabase OAuth clients for the intended hosts. Claude Code supports an explicit client ID and fixed callback port; Codex supports an explicit client ID plus per-server callback URL/port; Inspector uses its exact loopback callback.
3. Every OAuth client UUID present in `MCP_OAUTH_ALLOWED_CLIENT_IDS_JSON` and configured through the database capability facade with only the required read/write capabilities.
4. Production Supabase uses ES256, publishes the matching JWKS, and issues access tokens containing `aud=authenticated`, `role=authenticated`, UUID `sub`/`session_id`, and the admitted `client_id`.

Dynamic Client Registration remains disabled. Refresh tokens stay in the MCP client; the server validates only the access JWT presented on each request. API-key and Cognito fallback modes do not exist.

The MCP origin exposes only protected-resource metadata; Supabase exposes authorization, token, JWKS, grant, and revocation operations. Verify discovery before a live flow:

```bash
curl --fail http://localhost:9278/.well-known/oauth-protected-resource/mcp
curl --fail https://your-project-ref.supabase.co/.well-known/oauth-authorization-server/auth/v1
```

The live Dev proof must record PKCE, client-local refresh rotation, replay failure, logout/revoke, exact JWT claims, database actor/client behavior, and Edge/PostgREST re-verification without printing any token or secret. Offline tests inject claims and do not replace that proof.

`Database_CRUD_Tool` keeps selects on actor-bound PostgREST. Ordinary create/save/delete calls the three `app_dataset_*` Edge commands and requires `DB-CORE-WRITE-01`; LifecycleModel create/save/delete calls the existing save/delete bundle endpoints and requires `EDGE-BUNDLE-01`. The fixed MCP OAuth client also needs `DB-CORE-READ-01`. Do not grant direct table DML or replace these commands with service-role writes.

### Code Formatting

```bash
# Read-only lint, format check, and TypeScript 7 typecheck
pnpm lint

# Explicit formatting write
pnpm format
```

### Local Testing

#### STDIO Server

```bash
# Launch the STDIO Server using MCP Inspector
pnpm start
```

#### Launch MCP Inspector

Use `pnpm start:server` or `pnpm start:server-local`. The cross-platform launcher starts the matching HTTP server and Inspector without POSIX-only environment syntax.

### Canonical Validation

```bash
pnpm prepush:gate
```

This runs read-only lint/typecheck, offline behavior tests, packed-consumer validation, build, exact toolchain checks, audit, dry-run pack, and a frozen clean-worktree rerun. Production, GLAD, Supabase, and OpenLCA calls are not part of this offline gate.

### Publishing

Publishing is handled by the tracked direct-OAuth task after the change merges. The trusted-publishing workflow installs with pnpm's frozen lock, runs the canonical gate, and keeps the existing single-package tag format `v<package.version>`; release `0.2.1` maps to `v0.2.1`. Before building the ECS image, read back registry integrity and verify that the archive contains the OAuth runtime, Supabase JWT verifier, and HTTP app while every removed stateful-auth module is absent. The same gate must execute the globally installed HTTP bin and receive `/health`; import-only proof is insufficient.

### scaffold

```bash
pnpm exec tsx scripts/openlca-ipc-smoke.ts
```

### Deployment

```bash
set -euo pipefail

image_tag="direct-oauth-$(git rev-parse --short=12 HEAD)-v0.2.1"
image_uri="339712838008.dkr.ecr.us-east-1.amazonaws.com/tiangong-lca-mcp"

docker build --no-cache --provenance=false --platform linux/arm64 -t "${image_uri}:${image_tag}" .

aws ecr get-login-password --region us-east-1  | docker login --username AWS --password-stdin 339712838008.dkr.ecr.us-east-1.amazonaws.com

docker push "${image_uri}:${image_tag}"

aws ecr describe-images --region us-east-1 --repository-name tiangong-lca-mcp --image-ids "imageTag=${image_tag}" --query 'imageDetails[0].imageManifestMediaType' --output text

scan_probe_status=0
scan_status="$(aws ecr describe-image-scan-findings --region us-east-1 --repository-name tiangong-lca-mcp --image-id "imageTag=${image_tag}" --query 'imageScanStatus.status' --output text 2>&1)" || scan_probe_status=$?
if [ "${scan_probe_status}" -ne 0 ]; then
  case "${scan_status}" in
    *ScanNotFoundException*) aws ecr start-image-scan --region us-east-1 --repository-name tiangong-lca-mcp --image-id "imageTag=${image_tag}" ;;
    *)
      printf 'ECR scan probe failed: %s\n' "${scan_status}" >&2
      exit "${scan_probe_status}"
      ;;
  esac
fi

aws ecr wait image-scan-complete --region us-east-1 --repository-name tiangong-lca-mcp --image-id "imageTag=${image_tag}"

scan_gate="$(aws ecr describe-image-scan-findings --region us-east-1 --repository-name tiangong-lca-mcp --image-id "imageTag=${image_tag}" --query '[imageScanStatus.status, imageScanFindings.findingSeverityCounts.CRITICAL || `0`, imageScanFindings.findingSeverityCounts.HIGH || `0`]' --output text)"
expected_scan_gate="$(printf 'COMPLETE\t0\t0')"
if [ "${scan_gate}" != "${expected_scan_gate}" ]; then
  printf 'ECR scan gate failed: %s\n' "${scan_gate}" >&2
  exit 1
fi

docker run -d -p 9278:9278 --env-file .env "${image_uri}:${image_tag}"
```

The checked-in Dockerfile enables the pnpm Corepack shim before activating exact pnpm `11.24.0`, and retains `/pnpm/bin` in the final OCI `PATH`. Before ECR push, run a no-cache `linux/arm64` build and verify the image architecture plus the default `tiangong-lca-mcp-http` executable; regex-only Dockerfile proof is insufficient.

That build first runs `apk upgrade --no-cache`. Read back the installed OpenSSL packages and use a previously absent commit-bearing ECR tag. Keep `--provenance=false`: Amazon ECR basic scanning rejects an OCI index, so the pushed artifact must resolve to a single image manifest. Reuse an existing scan-on-push result and start a scan only for an explicit `ScanNotFoundException`; every other probe failure remains fatal. Wait for scan status COMPLETE with zero CRITICAL/HIGH findings before running it or registering an ECS task revision.
