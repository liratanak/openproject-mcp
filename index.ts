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

// Monitor stdin state for debugging
// NOTE: Do NOT set stdin encoding - MCP SDK expects raw Buffer data
process.stdin.on('close', () => {
  console.error('[Tonle MCP] stdin closed');
  logger.logServerEvent(caller, 'stdin closed');
});

process.stdin.on('end', () => {
  console.error('[Tonle MCP] stdin ended');
  logger.logServerEvent(caller, 'stdin ended');
});

process.stdin.on('error', (err) => {
  console.error(`[Tonle MCP] stdin error: ${err.message}`);
  logger.logServerEvent(caller, 'stdin error', { error: err.message });
});

// Log stdin state
console.error(`[Tonle MCP] stdin isTTY: ${process.stdin.isTTY}, readable: ${process.stdin.readable}`);
logger.logServerEvent(caller, 'stdin state', {
  isTTY: process.stdin.isTTY,
  readable: process.stdin.readable,
});

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

    // Connect to MCP transport FIRST - this is critical!
    // Claude's MCP client expects the server to be ready immediately.
    // If we delay (e.g., by testing OpenProject first), the client may timeout.
    const transport = new StdioServerTransport();
    
    // Create a promise that resolves when the transport closes
    // IMPORTANT: Set up event handlers BEFORE connecting to avoid race conditions
    const transportClosed = new Promise<void>((resolve) => {
      transport.onclose = () => {
        console.error('[Tonle MCP] Transport closed');
        logger.logServerEvent(caller, 'Transport closed', {
          transport: 'stdio',
        });
        resolve();
      };

      transport.onerror = (error) => {
        console.error(`[Tonle MCP] Transport error: ${error.message}`);
        logger.logServerEvent(caller, 'Transport error', {
          error: error.message,
        });
      };
    });

    // Connect the server to the transport immediately
    await server.connect(transport);

    console.error('[Tonle MCP] OpenProject MCP Server running on stdio');
    logger.logServerEvent(caller, 'Server running', {
      transport: 'stdio',
      status: 'ready',
    });

    // Initialize the OpenProject client (lazy - will be used by tools)
    // Don't test connection on startup to avoid interfering with MCP handshake
    initClient().catch(() => {
      // Silently ignore - tools will handle connection errors individually
    });

    // Keep the process alive by waiting for the transport to close
    // This is critical - without this, the process exits immediately after connect()
    await transportClosed;

    // Graceful shutdown
    console.error('[Tonle MCP] Server shutting down');
    logger.logServerEvent(caller, 'Server shutdown', {
      transport: 'stdio',
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

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.error('[Tonle MCP] Received SIGINT, shutting down...');
  logger.logServerEvent(caller, 'Received SIGINT');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('[Tonle MCP] Received SIGTERM, shutting down...');
  logger.logServerEvent(caller, 'Received SIGTERM');
  process.exit(0);
});

main();
