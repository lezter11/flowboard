#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { FlowboardClient } from './client.ts';
import { createFlowboardMcpServer } from './server.ts';

async function run() {
  const server = createFlowboardMcpServer(new FlowboardClient());
  await server.connect(new StdioServerTransport());
  console.error('[Flowboard MCP] Server running on stdio');
}

run().catch(() => {
  // Keep stdout exclusively for MCP frames; arbitrary errors may contain credentials.
  console.error('[Flowboard MCP] Startup failed. Check local token and API-origin configuration.');
  process.exitCode = 1;
});
