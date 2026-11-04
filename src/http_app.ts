import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import { getServer } from './_shared/init_server_http.js';
import {
  createSupabaseJwtRuntimeFromEnv,
  type McpProtectedResourceMetadata,
} from './_shared/oauth_runtime.js';
import {
  handleStatelessMcpRequest,
  installCors,
  installHealthRoute,
  installMcpMethodGuards,
} from './_shared/http_transport.js';
type ServerFactory = (downstreamAccessToken?: string, authInfo?: AuthInfo) => McpServer;
// Accommodate the 256KiB owner request plus MCP JSON-RPC/argument envelopes.
// The Study tool independently enforces the smaller exact public body cap.
export const MCP_HTTP_REQUEST_MAX_BYTES = 512 * 1024;

export type HttpAppOptions = {
  allowedOrigins?: string[];
  resourceMetadata?: McpProtectedResourceMetadata;
  resourceMetadataUrl?: string;
  serverFactory?: ServerFactory;
  tokenVerifier?: OAuthTokenVerifier;
};

function failClosedVerifier(verifier: OAuthTokenVerifier): OAuthTokenVerifier {
  return {
    verifyAccessToken: async (token) => {
      try {
        return await verifier.verifyAccessToken(token);
      } catch (error) {
        if (error instanceof InvalidTokenError) {
          throw error;
        }
        console.error('MCP_AUTHENTICATION_FAILED', { category: 'verifier' });
        throw new InvalidTokenError('Access token is invalid');
      }
    },
  };
}

function requestCredentials(req: Request): {
  accessToken?: string;
  authInfo?: AuthInfo;
} {
  const authInfo = req.auth;
  return { accessToken: authInfo?.token, authInfo };
}

export function createHttpApp(options: HttpAppOptions = {}): Express {
  const runtime = options.tokenVerifier ? undefined : createSupabaseJwtRuntimeFromEnv();
  const verifier = options.tokenVerifier ?? runtime?.verifier;
  if (!verifier) {
    throw new Error('OAuth token verifier is required');
  }
  const resourceMetadata = options.resourceMetadata ?? runtime?.resourceMetadata;
  const resourceMetadataUrl = options.resourceMetadataUrl ?? runtime?.resourceMetadataUrl;
  const serverFactory = options.serverFactory ?? getServer;
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: MCP_HTTP_REQUEST_MAX_BYTES }));
  const allowedOrigins = options.allowedOrigins ?? runtime?.allowedOrigins;
  installCors(app, allowedOrigins ? new Set(allowedOrigins) : undefined);
  if (resourceMetadata && resourceMetadataUrl) {
    const metadataPath = new URL(resourceMetadataUrl).pathname;
    app.get(metadataPath, (_req, res) => {
      res.status(200).json(resourceMetadata);
    });
  }
  const authentication = requireBearerAuth({
    verifier: failClosedVerifier(verifier),
    requiredScopes: [],
    resourceMetadataUrl,
  });
  app.post('/mcp', authentication, async (req, res) => {
    const credentials = requestCredentials(req);
    if (!credentials.accessToken) {
      console.error('MCP_AUTHENTICATION_FAILED', { category: 'downstream_token' });
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
      return;
    }
    await handleStatelessMcpRequest(req, res, () =>
      serverFactory(credentials.accessToken, credentials.authInfo),
    );
  });
  installMcpMethodGuards(app);
  installHealthRoute(app);

  app.get('/', (_req, res) => {
    res.status(200).json({
      authorization: 'oauth-2.1',
      authorizationServer: resourceMetadata?.authorization_servers[0],
      mcp: '/mcp',
      status: 'ok',
    });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const kind = error && typeof error === 'object' && 'type' in error ? error.type : undefined;
    const status =
      kind === 'entity.too.large'
        ? 413
        : kind === 'encoding.unsupported' || kind === 'charset.unsupported'
          ? 415
          : ['entity.parse.failed', 'request.aborted', 'request.size.invalid'].includes(
                String(kind),
              )
            ? 400
            : 500;
    res.status(status).json({
      jsonrpc: '2.0',
      error: {
        code: status === 400 ? -32700 : status === 500 ? -32603 : -32600,
        message:
          status === 413
            ? 'Request body too large.'
            : status === 415
              ? 'Unsupported request encoding.'
              : status === 400
                ? 'Invalid request body.'
                : 'Internal server error.',
      },
      id: null,
    });
  });
  return app;
}
