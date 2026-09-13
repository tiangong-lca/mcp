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
lastReviewedAt: 2026-09-14
lastReviewedCommit: b7a27cda880e0638589e8264c4cef6bbc22d552d
lastReviewedNote: '针对 MCP #78 / 0.2.1 发布完成复核：经 helper 确认的精确版本投影将 0.2.0 推进到 0.2.1，覆盖 package.json、Dockerfile 全局安装 pin、两处活跃 consumer/toolchain 绑定与四份活跃 Docker 运行示例；因 Docker Hub 无已验证的公开预构建 tag，示例改为仅本地构建。SDK 保持精确 0.2.0；lock 字节、依赖、Node 24.19.0、pnpm 11.24.0、TypeScript 7.0.2、runtime/auth 行为、workflow 逻辑与全部历史发布 fixture 不变。'
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
# 使用 Dockerfile 在本地构建 MCP 服务器镜像
docker build -t linancn/tiangong-lca-mcp-server:0.2.1 .

# 使用 Docker 启动 MCP 服务器
docker run -d \
    --name tiangong-lca-mcp-server \
    --publish 9278:9278 \
    --env-file .env \
    linancn/tiangong-lca-mcp-server:0.2.1
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
