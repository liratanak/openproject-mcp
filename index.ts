#!/usr/bin/env bun
/**
 * OpenProject MCP Server (STDIO Transport)
 * A Model Context Protocol server for OpenProject integration
 *
 * LOGS LOCATION: ~/Tonle/logs/
 * View logs with: tail -f ~/Tonle/logs/$(date +%Y-%m-%d)-stdio-server.log
 */

// Import logger first to ensure logging is available immediately
import logger, { DEFAULT_LOGS_DIR } from './src/logger.ts';

const caller = 'stdio-server';

// Setup global error handlers IMMEDIATELY before any async operations
// This ensures we capture errors even if imports or initialization fails
process.on('uncaughtException', (error) => {
  const message = `Uncaught exception: ${error.message}`;
  console.error(`[Tonle MCP] ${message}`);
  console.error(error.stack);
  try {
    logger.error(caller, 'UNCAUGHT_EXCEPTION', message, {
      error: error.message,
      stack: error.stack,
      name: error.name,
    });
  } catch {
    // Logger might not be available
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  const message = `Unhandled rejection: ${reason}`;
  console.error(`[Tonle MCP] ${message}`);
  try {
    logger.error(caller, 'UNHANDLED_REJECTION', message, {
      reason: String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  } catch {
    // Logger might not be available
  }
  process.exit(1);
});

// Log process start immediately
console.error(`[Tonle MCP] Process starting. PID: ${process.pid}`);
console.error(`[Tonle MCP] Logs directory: ${DEFAULT_LOGS_DIR}`);
console.error(`[Tonle MCP] View logs: tail -f ${DEFAULT_LOGS_DIR}/$(date +%Y-%m-%d)-stdio-server.log`);

logger.logServerEvent(caller, 'Process starting', {
  pid: process.pid,
  nodeVersion: process.version,
  platform: process.platform,
  cwd: process.cwd(),
  logsDir: DEFAULT_LOGS_DIR,
  env: {
    OPENPROJECT_URL: process.env.OPENPROJECT_URL ? '[SET]' : '[NOT SET]',
    OPENPROJECT_API_KEY: process.env.OPENPROJECT_API_KEY ? '[SET]' : '[NOT SET]',
  },
});

// Now import other dependencies
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { setupMcpServer } from './src/server-setup.ts';

async function main() {
  try {
    logger.logServerEvent(caller, 'Server starting', {
      transport: 'stdio',
      version: '1.0.0',
    });

    // Validate required environment variables
    if (!process.env.OPENPROJECT_URL) {
      throw new Error('OPENPROJECT_URL environment variable is not set');
    }
    if (!process.env.OPENPROJECT_API_KEY) {
      throw new Error('OPENPROJECT_API_KEY environment variable is not set');
    }

    logger.logServerEvent(caller, 'Environment validated', {
      openProjectUrl: process.env.OPENPROJECT_URL,
    });

    // Setup the MCP server with all tools
    const { server, initClient } = setupMcpServer({
      name: 'openproject-mcp',
      version: '1.0.0',
    });

    // Initialize the OpenProject client
    console.error('[Tonle MCP] Testing OpenProject connection...');
    logger.logServerEvent(caller, 'Testing OpenProject connection');

    const client = await initClient();
    const user = await client.getCurrentUser();

    console.error(`[Tonle MCP] Connected as: ${user.name} (${user.login})`);
    logger.logAuth(caller, true, {
      userId: user.id,
      userName: user.name,
      userLogin: user.login,
      isAdmin: user.admin,
    });

    // Connect to MCP transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('[Tonle MCP] OpenProject MCP Server running on stdio');
    logger.logServerEvent(caller, 'Server running', {
      transport: 'stdio',
      status: 'ready',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Tonle MCP] Failed to start MCP server: ${errorMessage}`);
    logger.logServerEvent(caller, 'Server startup failed', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

main();
