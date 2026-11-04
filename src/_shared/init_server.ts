import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { regStudyTool } from '../tools/study.js';
import { regOpenLcaPrompts } from '../prompts/lca_calculation.js';
import { regOpenLcaResources } from '../resources/lca_calculation.js';
import { regFlowSearchTool } from '../tools/flow_hybrid_search.js';
import { regGladDatasetTools } from '../tools/glad_dataset_search.js';
import { regLcaCalculationGuidanceTool } from '../tools/lca_calculation_guidance.js';
import { regLifecycleModelSearchTool } from '../tools/life_cycle_model_hybrid_search.js';
import { regOpenLcaLciaTool } from '../tools/openlca_ipc_lcia.js';
import { regOpenLcaListLCIAMethodsTool } from '../tools/openlca_ipc_lcia_methods_list.js';
import { regOpenLcaListSystemProcessesTool } from '../tools/openlca_ipc_system_processes_list.js';
import { regProcessSearchTool } from '../tools/process_hybrid_search.js';

export function initializeServer(bearerKey?: string): McpServer {
  const server = new McpServer(
    {
      name: 'TianGong-MCP-Server',
      version: '1.0.0',
    },
    { capabilities: { prompts: {}, resources: {} } },
  );

  regStudyTool(server, bearerKey);
  regFlowSearchTool(server, bearerKey);
  regProcessSearchTool(server, bearerKey);
  regLifecycleModelSearchTool(server, bearerKey);
  regGladDatasetTools(server);
  regOpenLcaLciaTool(server);
  regOpenLcaListSystemProcessesTool(server);
  regOpenLcaListLCIAMethodsTool(server);
  regOpenLcaPrompts(server);
  regOpenLcaResources(server);
  regLcaCalculationGuidanceTool(server);

  return server;
}

export function getServer(bearerKey?: string) {
  return initializeServer(bearerKey);
}
