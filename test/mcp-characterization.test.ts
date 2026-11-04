import './helpers/backend-env.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { initializeServer as initializeStdioServer } from '../src/_shared/init_server.js';
import { initializeServer as initializeHttpServer } from '../src/_shared/init_server_http.js';
import { initializeServer as initializeLocalHttpServer } from '../src/_shared/init_server_http_local.js';
import { connectInMemory } from './helpers/mcp-client.js';

const toolNames = async (server: ReturnType<typeof initializeStdioServer>) => {
  const connection = await connectInMemory(server);
  try {
    const result = await connection.client.listTools();
    return result.tools.map((tool) => tool.name).sort();
  } finally {
    await connection.close();
  }
};

type TextToolResult = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

const responseText = (result: unknown) =>
  ((result as TextToolResult).content ?? [])
    .filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('\n');

async function callTool(
  client: Awaited<ReturnType<typeof connectInMemory>>['client'],
  name: string,
  args: Record<string, unknown>,
) {
  return client.callTool({ name, arguments: args });
}

describe('MCP registration contract', () => {
  it('preserves the STDIO tool surface', async () => {
    assert.deepEqual(await toolNames(initializeStdioServer('test-bearer')), [
      'Get_GLAD_Dataset_Tool',
      'LCA_Calculation_Guidance_Tool',
      'OpenLCA_Impact_Assessment_Tool',
      'OpenLCA_List_LCIA_Methods_Tool',
      'OpenLCA_List_System_Processes_Tool',
      'Search_Flows_Tool',
      'Search_GLAD_Datasets_Tool',
      'Search_Life_Cycle_Models_Tool',
      'Search_Processes_Tool',
      'Study_API_Tool',
    ]);
  });

  it('preserves the authenticated HTTP tool surface', async () => {
    assert.deepEqual(await toolNames(initializeHttpServer('test-bearer')), [
      'Database_CRUD_Tool',
      'Get_GLAD_Dataset_Tool',
      'Search_Flows_Tool',
      'Search_GLAD_Datasets_Tool',
      'Search_Life_Cycle_Models_Tool',
      'Search_Processes_Tool',
      'Study_API_Tool',
    ]);
  });

  it('preserves the local HTTP tool surface', async () => {
    assert.deepEqual(await toolNames(initializeLocalHttpServer()), [
      'OpenLCA_Impact_Assessment_Tool',
      'OpenLCA_List_LCIA_Methods_Tool',
      'OpenLCA_List_System_Processes_Tool',
      'Tidas_Data_Validate_Tool',
    ]);
  });
});

describe('TIDAS validation contract', () => {
  const entityTypes = [
    'contact',
    'flow',
    'process',
    'source',
    'flowProperty',
    'unitGroup',
    'lciaMethod',
    'lifeCycleModel',
  ] as const;

  it('returns a stable error envelope for every declared dataset type', async () => {
    const connection = await connectInMemory(initializeLocalHttpServer());
    try {
      for (const entityType of entityTypes) {
        const result = await callTool(connection.client, 'Tidas_Data_Validate_Tool', {
          entityType,
          data: {},
        });
        assert.equal(result.isError, true, entityType);
        const envelope = JSON.parse(responseText(result)) as {
          code: string;
          entityType: string;
          validationIssues: Array<{
            code: string;
            path: Array<string | number>;
            severity: string;
          }>;
        };
        assert.equal(envelope.code, 'TIDAS_VALIDATION_FAILED', entityType);
        assert.equal(envelope.entityType, entityType);
        assert.ok(envelope.validationIssues.length > 0, entityType);
        for (const issue of envelope.validationIssues) {
          assert.equal(typeof issue.code, 'string', entityType);
          assert.ok(Array.isArray(issue.path), entityType);
          assert.match(issue.severity, /^(?:error|warning|info)$/u, entityType);
        }
      }
    } finally {
      await connection.close();
    }
  });

  it('rejects unknown dataset types at the protocol boundary', async () => {
    const connection = await connectInMemory(initializeLocalHttpServer());
    try {
      const result = await callTool(connection.client, 'Tidas_Data_Validate_Tool', {
        entityType: 'unknown',
        data: {},
      });
      assert.equal(result.isError, true);
      assert.match(responseText(result), /Input validation error/u);
    } finally {
      await connection.close();
    }
  });
});

describe('remote read and CRUD boundaries', () => {
  it('forwards a read-only flow search with the bearer and region headers', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
      const inputUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requests.push({ input: inputUrl, init });
      return new Response(JSON.stringify({ rows: [{ id: 'flow-1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const connection = await connectInMemory(initializeHttpServer('test-bearer'));
    try {
      const result = await callTool(connection.client, 'Search_Flows_Tool', { query: 'steel' });
      assert.equal(result.isError, undefined);
      assert.deepEqual(JSON.parse(responseText(result)), { rows: [{ id: 'flow-1' }] });
      assert.equal(requests.length, 1);
      const request = requests[0];
      assert.ok(request);
      assert.match(request.input, /\/functions\/v1\/flow_hybrid_search$/u);
      const body = request.init?.body;
      if (typeof body !== 'string') {
        assert.fail('Expected a string request body.');
      }
      assert.deepEqual(JSON.parse(body), { query: 'steel' });
      assert.equal(new Headers(request.init?.headers).get('authorization'), 'Bearer test-bearer');
    } finally {
      globalThis.fetch = originalFetch;
      await connection.close();
    }
  });

  it('normalizes a remote search failure into an MCP tool error', async () => {
    const originalFetch = globalThis.fetch;
    const originalConsoleError = console.error;
    globalThis.fetch = async () => new Response('', { status: 503, statusText: 'Unavailable' });
    console.error = () => {};
    const connection = await connectInMemory(initializeHttpServer('test-bearer'));
    try {
      const result = await callTool(connection.client, 'Search_Flows_Tool', { query: 'steel' });
      assert.equal(result.isError, true);
      assert.match(responseText(result), /HTTP error: 503 Unavailable/u);
    } finally {
      globalThis.fetch = originalFetch;
      console.error = originalConsoleError;
      await connection.close();
    }
  });

  it('rejects incomplete insert, update, and delete inputs before any request', async () => {
    const originalFetch = globalThis.fetch;
    let requestCount = 0;
    globalThis.fetch = async () => {
      requestCount += 1;
      throw new Error('unexpected network request');
    };
    const connection = await connectInMemory(initializeHttpServer('test-bearer'));
    const id = '12345678-1234-4234-8234-123456789abc';
    try {
      const cases = [
        [{ operation: 'insert', table: 'contacts', id }, /jsonOrdered is required/u],
        [
          { operation: 'update', table: 'contacts', id, version: '01.00.000' },
          /jsonOrdered is required/u,
        ],
        [{ operation: 'delete', table: 'contacts', id }, /version is required/u],
      ] as const;
      for (const [args, expected] of cases) {
        const result = await callTool(connection.client, 'Database_CRUD_Tool', args);
        assert.equal(result.isError, true);
        assert.match(responseText(result), expected);
      }
      assert.equal(requestCount, 0);
    } finally {
      globalThis.fetch = originalFetch;
      await connection.close();
    }
  });
});
