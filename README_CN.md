---
title: TianGong LCA MCP README CN
docType: guide
scope: repo
status: active
authoritative: false
owner: mcp
language: zh-CN
whenToUse:
  - when you need Chinese user-facing MCP package setup, Docker usage, local startup, or inspector examples
whenToUpdate:
  - when Chinese startup commands, Docker usage, package invocation, or user-facing MCP examples change
checkPaths:
  - README_CN.md
  - README.md
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
lastReviewedNote: '针对 Issue #76 / workspace #1107 完成复核：canonical 仓库身份、精确发布门与活跃源码链接迁移至 tiangong-lca/mcp；包名、bin 名、版本 0.2.0、Docker Hub 命名空间、历史 tag 与签名产物不变；发布上下文判定已收敛至 scripts/ci/release-context.sh 并以真实 git fixture 回归覆盖。'
related:
  - AGENTS.md
  - .docpact/config.yaml
  - DEV_CN.md
  - README.md
---

# TianGong-LCA-MCP

[中文](https://github.com/tiangong-lca/mcp/blob/main/README_CN.md) | [English](https://github.com/tiangong-lca/mcp/blob/main/README.md)

TianGong LCA Model Context Protocol (MCP) Server 支持 STDIO 和 Streamable Http 两种协议。

## 环境变量

复制 `.env.example` 并填写 Supabase issuer、publishable key、精确允许的 public OAuth client ID 和浏览器 Origin。OAuth 认证不再需要 Redis、confidential client secret 或服务端 session encryption key。

GLAD 数据集查询工具还需要配置 GLAD API key：

```bash
GLAD_API_KEY=your-glad-api-key
GLAD_API_BASE_URL=https://www.globallcadataaccess.org/api/v1
```

## 远程 OAuth

远程 Streamable HTTP 是 OAuth 2.1 protected resource。兼容的 MCP host 会发现 `/.well-known/oauth-protected-resource/mcp`，转到其中声明的 Supabase Auth authorization server，打开用户浏览器，并通过 Authorization Code + S256 PKCE 完成授权。用户在 Next 中登录和确认授权；用户名、密码不会交给 AI 或 MCP host。

Supabase 直接向 public MCP client 签发 access token 和轮换 refresh token。client 在本机保存 refresh token，并在每个 MCP 请求上发送短期 Supabase ES256 access JWT。服务验证签名、issuer、audience、expiry、role/session 和精确 `client_id`；Edge/PostgREST 随后再次验证同一 user/client 上下文并执行 RLS capability。

Dynamic Client Registration 保持关闭。运维在 Supabase 注册精确的 public client 与 loopback callback，并把这些 UUID client ID 写入 `MCP_OAUTH_ALLOWED_CLIENT_IDS_JSON`。未知、畸形、过期、Cognito 和密码/API-key bearer 都会收到标准 OAuth challenge，且不会触发 fallback I/O。

MCP origin 不暴露 authorization、token、refresh、revoke、callback、registration、demo 或显示 authorization code 的 endpoint。Supabase Auth 负责这些协议操作，Next 负责 `/oauth/consent`。

## 启动 MCP 服务器

### 客户端 STDIO 服务器

```bash
corepack install --global pnpm@11.24.0
pnpm add --global @tiangong-lca/mcp-server

pnpm dlx dotenv-cli -e .env -- tiangong-lca-mcp-stdio
```

### 使用 Docker

```bash
# 使用 Dockerfile 构建 MCP 服务器镜像（可选）
docker build -t linancn/tiangong-lca-mcp-server:0.2.0 .

# 拉取 MCP 服务器镜像
docker pull linancn/tiangong-lca-mcp-server:0.2.0

# 使用 Docker 启动 MCP 服务器
docker run -d \
    --name tiangong-lca-mcp-server \
    --publish 9278:9278 \
    --env-file .env \
    linancn/tiangong-lca-mcp-server:0.2.0
```

### 本地测试

#### STDIO 服务器

```bash
# 使用 MCP Inspector 启动 STDIO 服务器
pnpm start
```

#### Streamable Http 服务器

```bash
pnpm start:server
```

#### Streamable Http Local 服务器

```bash
pnpm start:server-local
```

HTTP 启动命令通过跨平台 Node argv wrapper 启动 MCP Inspector，并在 wrapper 内注入仅用于开发的 Inspector 环境，不依赖 POSIX shell 语法。
