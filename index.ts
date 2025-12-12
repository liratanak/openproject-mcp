#!/usr/bin/env bun
/**
 * OpenProject MCP Server (STDIO Transport)
 * A Model Context Protocol server for OpenProject integration
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setupMcpServer } from './src/server-setup.ts';
import logger from './src/logger.ts';

async function main() {
  const caller = 'stdio-server';

  try {
    logger.logServerEvent(caller, 'Server starting', {
      transport: 'stdio',
      version: '1.0.0',
    });

    // Setup the MCP server with all tools
    const { server, initClient } = setupMcpServer({
      name: 'openproject-mcp',
      version: '1.0.0',
    });

    // Initialize the OpenProject client
    console.error('Testing OpenProject connection...');
    logger.logServerEvent(caller, 'Testing OpenProject connection');

    const client = await initClient();
    const user = await client.getCurrentUser();

    console.error(`Connected as: ${user.name} (${user.login})`);
    logger.logAuth(caller, true, {
      userId: user.id,
      userName: user.name,
      userLogin: user.login,
      isAdmin: user.admin,
    });

    // Connect to MCP transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('OpenProject MCP Server running on stdio');
    logger.logServerEvent(caller, 'Server running', {
      transport: 'stdio',
      status: 'ready',
    });
  } catch (error) {
    console.error('Failed to start MCP server:', error instanceof Error ? error.message : String(error));
    logger.logServerEvent(caller, 'Server startup failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

main();
