#!/usr/bin/env bun
/**
 * OpenProject MCP HTTP Server
 * A Model Context Protocol server using HTTP/SSE transport for OpenProject integration
 */

import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { setupMcpServer } from './src/server-setup.ts';

export interface HttpServerConfig {
  port?: number;
  host?: string;
}

// Store transports for session management
const transports: Record<string, StreamableHTTPServerTransport> = {};

export async function startHttpServer(config: HttpServerConfig = {}) {
  const port = config.port || parseInt(process.env.MCP_HTTP_PORT || '3100');
  const host = config.host || process.env.MCP_HTTP_HOST || '0.0.0.0';

  // Setup the MCP server
  const { server, initClient } = setupMcpServer({
    name: 'openproject-mcp-http',
    version: '1.0.0',
  });

  // Initialize the OpenProject client
  console.error('Initializing OpenProject connection...');
  try {
    const client = await initClient();
    const user = await client.getCurrentUser();
    console.error(`Connected as: ${user.name} (${user.login})`);
  } catch (error) {
    console.error('Failed to connect to OpenProject:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Create Bun HTTP server
  const bunServer = Bun.serve({
    port,
    hostname: host,
    async fetch(req) {
      const url = new URL(req.url);
      const method = req.method;

      // CORS preflight
      if (method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id',
          },
        });
      }

      // Health check endpoint
      if (url.pathname === '/health' && method === 'GET') {
        return new Response(JSON.stringify({ status: 'ok', transport: 'http' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Modern Streamable HTTP endpoint
      if (url.pathname === '/mcp') {
        if (method === 'POST') {
          return handleMcpPost(req, server);
        } else if (method === 'GET') {
          return handleMcpGet(req);
        } else if (method === 'DELETE') {
          return handleMcpDelete(req);
        }
      }

      // 404 for unknown routes
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  console.error(`OpenProject MCP HTTP Server running on http://${host}:${port}`);
  console.error(`  - Streamable HTTP endpoint: POST/GET/DELETE /mcp`);
  console.error(`  - Health check: GET /health`);

  return bunServer;
}

async function handleMcpPost(req: Request, mcpServer: ReturnType<typeof setupMcpServer>['server']): Promise<Response> {
  const sessionId = req.headers.get('mcp-session-id') || undefined;
  let transport: StreamableHTTPServerTransport;
  let body: any;

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    }), {
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  if (sessionId && transports[sessionId]) {
    // Reuse existing session
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(body)) {
    // New session initialization
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports[id] = transport;
        console.error('HTTP session initialized:', id);
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        delete transports[transport.sessionId];
        console.error('HTTP session closed:', transport.sessionId);
      }
    };

    await mcpServer.connect(transport);
  } else if (!sessionId) {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
      id: null,
    }), {
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } else {
    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: Session not found' },
      id: null,
    }), {
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // Create a mock request/response adapter for the transport
  return new Promise((resolve) => {
    const responseChunks: string[] = [];
    const headers: Record<string, string> = {};
    let statusCode = 200;
    let resolved = false;

    const mockRes = {
      statusCode: 200,
      headersSent: false,
      setHeader(name: string, value: string) {
        headers[name.toLowerCase()] = value;
        return this;
      },
      getHeader(name: string) {
        return headers[name.toLowerCase()];
      },
      writeHead(status: number, hdrs?: Record<string, string>) {
        statusCode = status;
        if (hdrs) {
          Object.entries(hdrs).forEach(([k, v]) => {
            headers[k.toLowerCase()] = v;
          });
        }
        return this;
      },
      write(chunk: string | Buffer) {
        const data = typeof chunk === 'string' ? chunk : chunk.toString();
        responseChunks.push(data);
        return true;
      },
      end(chunk?: string | Buffer) {
        if (chunk) {
          const data = typeof chunk === 'string' ? chunk : chunk.toString();
          responseChunks.push(data);
        }
        if (!resolved) {
          resolved = true;
          headers['access-control-allow-origin'] = '*';
          resolve(new Response(responseChunks.join(''), {
            status: statusCode,
            headers,
          }));
        }
        return this;
      },
      on(_event: string, _cb: Function) {
        return this;
      },
      once(_event: string, _cb: Function) {
        return this;
      },
      emit(_event: string, ..._args: any[]) {
        return true;
      },
      removeListener(_event: string, _cb: Function) {
        return this;
      },
    };

    const mockReq = {
      method: 'POST',
      url: '/mcp',
      headers: Object.fromEntries(req.headers.entries()),
      body,
      on(_event: string, _cb: Function) {
        return this;
      },
      pipe(destination: any) {
        return destination;
      },
    };

    transport.handleRequest(mockReq as any, mockRes as any, body).catch((error) => {
      console.error('Error handling MCP request:', error);
      if (!resolved) {
        resolved = true;
        resolve(new Response(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }));
      }
    });

    // Set a timeout to ensure we always resolve
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(new Response(responseChunks.join('') || JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Request timeout' },
          id: null,
        }), {
          status: statusCode || 500,
          headers: {
            ...headers,
            'Access-Control-Allow-Origin': '*',
          },
        }));
      }
    }, 30000);
  });
}

async function handleMcpGet(req: Request): Promise<Response> {
  const sessionId = req.headers.get('mcp-session-id');
  
  if (!sessionId || !transports[sessionId]) {
    return new Response(JSON.stringify({ error: 'Invalid or missing session' }), {
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  return new Response(JSON.stringify({ 
    sessionId, 
    status: 'active',
    transport: 'streamable-http' 
  }), {
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function handleMcpDelete(req: Request): Promise<Response> {
  const sessionId = req.headers.get('mcp-session-id');
  
  if (!sessionId || !transports[sessionId]) {
    return new Response(JSON.stringify({ error: 'Invalid or missing session' }), {
      status: 400,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const transport = transports[sessionId];
  await transport.close();
  delete transports[sessionId];

  return new Response(JSON.stringify({ message: 'Session closed' }), {
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Main entry point
if (import.meta.main) {
  startHttpServer().catch((error) => {
    console.error('Failed to start HTTP server:', error);
    process.exit(1);
  });
}
