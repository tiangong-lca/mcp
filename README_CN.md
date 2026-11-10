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
lastReviewedAt: 2026-11-04
lastReviewedCommit: e141b4108eb864e99e185c81f6fb32b1278ba1c8
lastReviewedNote: 'MCP #104: reviewed explicit actor-authenticated V2-V5 Study consumer, exact Edge artifacts, bounded downloads, source refusal and sticky same-key mutation recovery. Canonical source/packed/clean gates, independent review and installed runtime qualification are recorded separately; no publication or P5 enablement.'
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

使用 Supabase 搜索工具前，必须显式将 `SUPABASE_BASE_URL` 配置为自己的后端；没有默认生产后端。后端未配置或地址无效时，调用会在发出请求前于本地失败，STDIO 初始化、工具列表与本地指导工具仍可使用。数据库操作还需要该后端的 `SUPABASE_PUBLISHABLE_KEY`。远程 HTTP 继续要求上面的完整 OAuth 配置。

```bash
corepack install --global pnpm@11.24.0
pnpm add --global @tiangong-lca/mcp-server

pnpm dlx dotenv-cli -e .env -- tiangong-lca-mcp-stdio
```

### 使用 Docker

仓库 Dockerfile 安装的是已发布的 `@tiangong-lca/mcp-server@0.2.1`，不会构建当前 checkout。源码变更适用于 checkout 构建；已有 npm 包与镜像需要另行审核发布后才会包含修复。

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

## LCA 计算

通过认证 HTTP 使用 `Study_API_Tool`，显式选择 V2 请求，创建计算项目、准备模型、提交计算并读取结果。请先读取所选协议版本的请求 schema，再调用 `capability.read` 查询当前服务和 OAuth 身份允许的操作。

源码还支持 V3–V6，用于可选的分析、报告、审阅、分享和方法评估。V5 和 V6 需要独立准入，默认关闭。服务会重新授权每次调用。请保留原始变更请求和幂等键以便恢复；工具不披露原始来源包。下载完整性和资格边界见 [Study 消费契约](docs/agents/study-api-contract.md)。源码支持、软件包发布和托管启用是独立状态。
