---
title: TianGong LCA MCP README EN
docType: guide
scope: repo
status: active
authoritative: false
owner: mcp
language: en
whenToUse:
  - when you need English user-facing MCP package setup, Docker usage, local startup, or inspector examples
whenToUpdate:
  - when English startup commands, Docker usage, package invocation, or user-facing MCP examples change
checkPaths:
  - README.md
  - README_CN.md
  - package.json
  - Dockerfile
  - mcp_config.json
  - src/index.ts
  - src/index_server.ts
  - src/index_server_local.ts
  - src/http_app.ts
  - src/http_app_local.ts
lastReviewedAt: 2026-09-13
lastReviewedCommit: 26688e8c155f0bb78c6df6cf92cab4b80478e6f0
lastReviewedNote: 'Reviewed for #76 / workspace #1107: canonical repository identity, the exact release guard, and active source links move to tiangong-lca/mcp; package name, bin names, version 0.2.0, the Docker Hub registry namespace, historical tags and signed artifacts are unchanged; the release-context decision now lives in scripts/ci/release-context.sh and is regression-tested against real git fixtures.'
related:
  - AGENTS.md
  - .docpact/config.yaml
  - DEV_EN.md
  - README_CN.md
---

# TianGong-LCA-MCP

[中文](https://github.com/tiangong-lca/mcp/blob/main/README_CN.md) | [English](https://github.com/tiangong-lca/mcp/blob/main/README.md)

TianGong LCA Model Context Protocol (MCP) Server supports STDIO and Streamable Http protocols.

## Environment

Copy `.env.example` and populate its Supabase issuer, publishable key, exact admitted public OAuth client IDs, and allowed browser origins. OAuth authentication requires no Redis, confidential client secret, or server-side session encryption key.

GLAD dataset search tools additionally require a GLAD API key:

```bash
GLAD_API_KEY=your-glad-api-key
GLAD_API_BASE_URL=https://www.globallcadataaccess.org/api/v1
```

## Remote OAuth

Remote Streamable HTTP is an OAuth 2.1 protected resource. A compatible MCP host discovers `/.well-known/oauth-protected-resource/mcp`, follows its Supabase Auth authorization server, opens the user's browser, and completes Authorization Code with S256 PKCE. The user signs in and consents in Next; usernames and passwords are never entered into the AI or MCP host.

Supabase issues the access and rotating refresh tokens directly to the public MCP client. The client stores its refresh token locally and sends the short-lived Supabase ES256 access JWT on every MCP request. The server verifies signature, issuer, audience, expiry, role/session, and exact `client_id`; Edge/PostgREST then re-verify the same user/client context and enforce RLS capabilities.

Dynamic Client Registration remains disabled. Operators register exact public clients and loopback callbacks in Supabase, then list those UUID client IDs in `MCP_OAUTH_ALLOWED_CLIENT_IDS_JSON`. Unknown, malformed, expired, Cognito, and password/API-key bearers fail the canonical OAuth challenge without fallback I/O.

The MCP origin exposes no authorization, token, refresh, revoke, callback, registration, demo, or authorization-code display endpoint. Supabase Auth owns those protocol operations and Next owns `/oauth/consent`.

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
docker build -t linancn/tiangong-lca-mcp-server:0.2.0 .

# Pull MCP server image
docker pull linancn/tiangong-lca-mcp-server:0.2.0

# Start MCP server using Docker
docker run -d \
    --name tiangong-lca-mcp-server \
    --publish 9278:9278 \
    --env-file .env \
    linancn/tiangong-lca-mcp-server:0.2.0
```

## Local Testing

### STDIO Server

```bash
# Launch the STDIO Server using MCP Inspector
pnpm start
```

### Streamable Http Server

```bash
pnpm start:server
```

#### Streamable Http Local Server

```bash
pnpm start:server-local
```

The HTTP start commands launch MCP Inspector through a cross-platform Node argv wrapper and inject the development-only Inspector environment without POSIX shell syntax.
