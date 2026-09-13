---
title: TianGong LCA MCP Maintainer Notes CN
docType: guide
scope: repo
status: active
authoritative: false
owner: mcp
language: zh-CN
whenToUse:
  - when you need Chinese maintainer-facing MCP development, formatting, testing, publish, or deployment commands
whenToUpdate:
  - when Chinese maintainer-facing runtime prerequisites, development commands, publish steps, or deployment notes change
checkPaths:
  - DEV_CN.md
  - DEV_EN.md
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - Dockerfile
  - .nvmrc
  - src/**
  - test/**
  - scripts/**
lastReviewedAt: 2026-09-14
lastReviewedCommit: b7a27cda880e0638589e8264c4cef6bbc22d552d
lastReviewedNote: '针对 MCP #78 / 0.2.1 发布完成复核：经 helper 确认的精确版本投影将 0.2.0 推进到 0.2.1，覆盖 package.json、Dockerfile 全局安装 pin、两处活跃 consumer/toolchain 绑定与四份活跃 Docker 运行示例；因 Docker Hub 无已验证的公开预构建 tag，示例改为仅本地构建。SDK 保持精确 0.2.0；lock 字节、依赖、Node 24.19.0、pnpm 11.24.0、TypeScript 7.0.2、runtime/auth 行为、workflow 逻辑与全部历史发布 fixture 不变。'
related:
  - AGENTS.md
  - .docpact/config.yaml
  - docs/agents/repo-validation.md
  - docs/agents/repo-architecture.md
  - DEV_EN.md
---

# TianGong-LCA-MCP

[中文](https://github.com/tiangong-lca/mcp/blob/main/DEV_CN.md) | [English](https://github.com/tiangong-lca/mcp/blob/main/DEV_EN.md)

TianGong LCA Model Context Protocol (MCP) Server 支持 STDIO 和 StreamableHttp 两种协议。

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
docker build -t linancn/tiangong-lca-mcp-server:0.2.1 .

# 使用 Docker 启动 MCP 服务器
docker run -d \
    --name tiangong-lca-mcp-server \
    --publish 9278:9278 \
    --env-file .env \
    linancn/tiangong-lca-mcp-server:0.2.1
```

## 开发

### 环境设置

```bash
# 安装 Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
nvm install 24.19.0
nvm use 24.19.0

# 安装精确包管理器并按冻结 lock 安装依赖
corepack install --global pnpm@11.24.0
pnpm install --frozen-lockfile
```

### Supabase OAuth Resource Server 配置

远程 HTTP 入口按 `.env.example` 配置。它只需要 MCP public origin、Supabase project origin/publishable key、精确允许的 public OAuth client ID、可选浏览器 Origin 和 GLAD 配置；没有 OAuth datastore、confidential client secret 或 session encryption 输入。

Dev 必须具备以下精确控制面事实：

1. 启用 Supabase OAuth Server，关闭 Dynamic Client Registration，authorization path 为 `/oauth/consent`。
2. 为目标 host 注册精确的 public Supabase OAuth client。Claude Code 支持显式 client ID 与固定 callback port；Codex 支持显式 client ID 以及每 server callback URL/port；Inspector 使用其精确 loopback callback。
3. 每个 OAuth client UUID 都必须出现在 `MCP_OAUTH_ALLOWED_CLIENT_IDS_JSON`，并通过数据库 capability facade 只授予需要的读写 capability。
4. 生产 Supabase 使用 ES256、发布匹配 JWKS，并签发包含 `aud=authenticated`、`role=authenticated`、UUID `sub`/`session_id` 与已允许 `client_id` 的 access token。

Dynamic Client Registration 保持关闭。refresh token 只保存在 MCP client；server 只验证每次请求携带的 access JWT。API-key 与 Cognito fallback 模式不存在。

MCP origin 只暴露 protected-resource metadata；Supabase 暴露 authorization、token、JWKS、grant 与 revoke 操作。live flow 前先检查发现文档：

```bash
curl --fail http://localhost:9278/.well-known/oauth-protected-resource/mcp
curl --fail https://your-project-ref.supabase.co/.well-known/oauth-authorization-server/auth/v1
```

Dev live proof 必须记录 PKCE、client 本地 refresh 轮换、重放失败、logout/revoke、精确 JWT claims、数据库 actor/client 行为以及 Edge/PostgREST 再验证；不得打印 token 或 secret。离线测试只注入 claims，不能替代该证明。

`Database_CRUD_Tool` 的读取继续使用绑定 actor 的 PostgREST。普通 create/save/delete 调用三条 `app_dataset_*` Edge 命令，并要求 `DB-CORE-WRITE-01`；LifecycleModel 的 create/save/delete 调用既有 save/delete bundle endpoint，并要求 `EDGE-BUNDLE-01`。固定 MCP OAuth client 还需要 `DB-CORE-READ-01`。禁止授予直接 table DML，也不要用 service-role 写入替代这些命令。

### 代码格式化

```bash
# 只读 lint、格式检查和 TypeScript 7 类型检查
pnpm lint

# 显式写入格式化结果
pnpm format
```

### 本地测试

#### 启动 MCP Inspector

使用 `pnpm start:server` 或 `pnpm start:server-local`。跨平台启动器会同时启动对应 HTTP 服务和 Inspector，不依赖 POSIX 专用环境变量语法。

### 标准验证

```bash
pnpm prepush:gate
```

该门禁包含只读 lint/typecheck、离线行为测试、打包消费者测试、构建、精确工具链检查、依赖审计、dry-run pack，以及在任意临时路径中的冻结 clean-worktree 重跑。该离线门禁不会访问生产、GLAD、Supabase 或 OpenLCA。

### 发布

本次 direct-OAuth 任务在变更合并后执行发布。Trusted publishing workflow 使用 pnpm frozen lock 安装并运行标准门禁；Tag 继续使用本单包仓库的 `v<package.version>` 格式，本次 `0.2.1` 对应 `v0.2.1`。构建 ECS 镜像前必须读回 registry integrity，并确认发布包包含 OAuth runtime、Supabase JWT verifier 与 HTTP app，且所有已删除的 stateful-auth 模块不存在。同一门禁还必须真实执行全局 HTTP bin 并收到 `/health`；仅 import 证明不足。

### 测试脚手架

```bash
pnpm exec tsx scripts/openlca-ipc-smoke.ts
```

### 发布

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

仓库 Dockerfile 会先启用 pnpm Corepack shim，再激活精确 pnpm `11.24.0`，并在最终 OCI `PATH` 中保留 `/pnpm/bin`。推送 ECR 前必须执行无缓存 `linux/arm64` 构建，并验证镜像架构与默认 `tiangong-lca-mcp-http` executable；只检查 Dockerfile 文本不足以证明镜像可用。

该构建会先执行 `apk upgrade --no-cache`。必须读回安装后的 OpenSSL package，并使用推送前不存在且包含 commit 的 ECR tag。必须保留 `--provenance=false`：Amazon ECR 基础扫描不接受 OCI index，因此推送产物必须解析为单一 image manifest。应复用 scan-on-push 已产生的扫描，只在明确返回 `ScanNotFoundException` 时启动新扫描；其他探测错误必须原样失败。只有扫描状态 COMPLETE 且 CRITICAL/HIGH 都为零，才能运行该镜像或注册 ECS task revision。
