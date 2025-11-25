#!/usr/bin/env bun
/**
 * OpenProject MCP Server (STDIO Transport)
 * A Model Context Protocol server for OpenProject integration
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setupMcpServer } from './src/server-setup.ts';

async function main() {
  try {
    // Setup the MCP server with all tools
    const { server, initClient } = setupMcpServer({
      name: 'openproject-mcp',
      version: '1.0.0',
    });

    // Initialize the OpenProject client
    console.error('Testing OpenProject connection...');
    const client = await initClient();
    const user = await client.getCurrentUser();
    console.error(`Connected as: ${user.name} (${user.login})`);
    
    // Connect to MCP transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.error('OpenProject MCP Server running on stdio');
  } catch (error) {
    console.error('Failed to start MCP server:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
