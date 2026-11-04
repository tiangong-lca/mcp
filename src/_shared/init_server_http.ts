import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { regStudyTool } from '../tools/study.js';
import { regStudyResources } from '../resources/study.js';
import { regCrudTool } from '../tools/db_crud.js';
import { regFlowSearchTool } from '../tools/flow_hybrid_search.js';
import { regGladDatasetTools } from '../tools/glad_dataset_search.js';
import { regLifecycleModelSearchTool } from '../tools/life_cycle_model_hybrid_search.js';
import { regProcessSearchTool } from '../tools/process_hybrid_search.js';

export function initializeServer(bearerKey?: string): McpServer {
  const server = new McpServer({
    name: 'TianGong-LCA-MCP-Server',
    version: '1.0.0',
  });

  regStudyTool(server, bearerKey);
  regStudyResources(server);
  regFlowSearchTool(server, bearerKey);
  regProcessSearchTool(server, bearerKey);
  regLifecycleModelSearchTool(server, bearerKey);
  regGladDatasetTools(server);
  regCrudTool(server, bearerKey);

  return server;
}

export function getServer(bearerKey?: string): McpServer {
  return initializeServer(bearerKey);
}
