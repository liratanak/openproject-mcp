/**
 * MCP Server Tests
 * Tests to verify the MCP server tools work correctly via HTTP transport
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { spawn, type Subprocess } from 'bun';

const HTTP_PORT = 3199;
const HTTP_URL = `http://localhost:${HTTP_PORT}/mcp`;

let httpServer: Subprocess | null = null;

// Helper to create HTTP client
async function createHttpClient(): Promise<Client> {
  const client = new Client({
    name: 'test-client',
    version: '1.0.0',
  });
  
  const transport = new StreamableHTTPClientTransport(new URL(HTTP_URL));
  await client.connect(transport);
  return client;
}

// Helper to call a tool and extract the text result
async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0]?.text || '';
}

// Global setup and teardown
beforeAll(async () => {
  // Start HTTP server in background
  console.log('Starting HTTP server for tests...');
  httpServer = spawn({
    cmd: ['bun', 'run', 'http-server.ts'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      MCP_HTTP_PORT: String(HTTP_PORT),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Wait for server to start
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Check if server is running
  try {
    const response = await fetch(`http://localhost:${HTTP_PORT}/health`);
    if (!response.ok) {
      throw new Error('Health check failed');
    }
    console.log('HTTP server is ready');
  } catch (error) {
    console.error('HTTP server failed to start:', error);
    throw error;
  }
});

afterAll(async () => {
  if (httpServer) {
    httpServer.kill();
    await httpServer.exited;
  }
});

describe('MCP Server Setup', () => {
  test('server-setup module exports correctly', async () => {
    const { setupMcpServer } = await import('../src/server-setup.ts');
    expect(setupMcpServer).toBeDefined();
    expect(typeof setupMcpServer).toBe('function');
  });

  test('setupMcpServer creates server instance', async () => {
    const { setupMcpServer } = await import('../src/server-setup.ts');
    const { server, initClient } = setupMcpServer();
    
    expect(server).toBeDefined();
    expect(initClient).toBeDefined();
    expect(typeof initClient).toBe('function');
  });
});

describe('HTTP Transport Tests', () => {
  test('health endpoint responds', async () => {
    const response = await fetch(`http://localhost:${HTTP_PORT}/health`);
    expect(response.ok).toBe(true);
    
    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.transport).toBe('http');
  });

  test('HTTP client can connect and list tools', async () => {
    const client = await createHttpClient();
    
    const tools = await client.listTools();
    expect(tools.tools).toBeDefined();
    expect(tools.tools.length).toBeGreaterThan(0);
    
    // Check for expected tools
    const toolNames = tools.tools.map(t => t.name);
    expect(toolNames).toContain('get_api_root');
    expect(toolNames).toContain('list_projects');
    expect(toolNames).toContain('get_current_user');
    expect(toolNames).toContain('list_work_packages');
    
    await client.close();
  });

  test('HTTP client can call get_current_user', async () => {
    const client = await createHttpClient();
    
    const result = await callTool(client, 'get_current_user');
    expect(result).toBeDefined();
    
    // Parse the JSON response
    const userData = JSON.parse(result);
    expect(userData.id).toBeDefined();
    expect(userData.login).toBeDefined();
    expect(userData.name).toBeDefined();
    
    await client.close();
  });

  test('HTTP client can call list_projects', async () => {
    const client = await createHttpClient();
    
    const result = await callTool(client, 'list_projects', { pageSize: 5 });
    expect(result).toBeDefined();
    
    const projectsData = JSON.parse(result);
    expect(projectsData._type).toBeDefined();
    
    await client.close();
  });

  test('HTTP client can call list_types', async () => {
    const client = await createHttpClient();
    
    const result = await callTool(client, 'list_types');
    expect(result).toBeDefined();
    
    const typesData = JSON.parse(result);
    expect(typesData._type).toBeDefined();
    
    await client.close();
  });

  test('HTTP client can call list_statuses', async () => {
    const client = await createHttpClient();
    
    const result = await callTool(client, 'list_statuses');
    expect(result).toBeDefined();
    
    const statusesData = JSON.parse(result);
    expect(statusesData._type).toBeDefined();
    
    await client.close();
  });

  test('HTTP client can call list_priorities', async () => {
    const client = await createHttpClient();
    
    const result = await callTool(client, 'list_priorities');
    expect(result).toBeDefined();
    
    const prioritiesData = JSON.parse(result);
    expect(prioritiesData._type).toBeDefined();
    
    await client.close();
  });

  test('HTTP client can call get_api_root', async () => {
    const client = await createHttpClient();
    
    const result = await callTool(client, 'get_api_root');
    expect(result).toBeDefined();
    
    const rootData = JSON.parse(result);
    expect(rootData._links).toBeDefined();
    
    await client.close();
  });

  test('HTTP client can call get_configuration', async () => {
    const client = await createHttpClient();
    
    const result = await callTool(client, 'get_configuration');
    expect(result).toBeDefined();
    
    const configData = JSON.parse(result);
    expect(configData).toBeDefined();
    
    await client.close();
  });
});

describe('Tool Consistency Tests', () => {
  test('list_users returns valid response', async () => {
    const client = await createHttpClient();
    
    const result = await callTool(client, 'list_users', { pageSize: 5 });
    expect(result).toBeDefined();
    
    // list_users may return an error if user doesn't have permission
    // So we just check the response is not empty
    if (!result.startsWith('Error')) {
      const usersData = JSON.parse(result);
      expect(usersData._type).toBeDefined();
    }
    
    await client.close();
  });

  test('list_work_packages returns valid response', async () => {
    const client = await createHttpClient();
    
    const result = await callTool(client, 'list_work_packages', { pageSize: 5 });
    expect(result).toBeDefined();
    
    const wpData = JSON.parse(result);
    expect(wpData._type).toBeDefined();
    
    await client.close();
  });

  test('list_memberships returns valid response', async () => {
    const client = await createHttpClient();
    
    const result = await callTool(client, 'list_memberships', { pageSize: 5 });
    expect(result).toBeDefined();
    
    const membershipsData = JSON.parse(result);
    expect(membershipsData._type).toBeDefined();
    
    await client.close();
  });

  test('list_versions returns valid response', async () => {
    const client = await createHttpClient();
    
    const result = await callTool(client, 'list_versions', { pageSize: 5 });
    expect(result).toBeDefined();
    
    const versionsData = JSON.parse(result);
    expect(versionsData._type).toBeDefined();
    
    await client.close();
  });

  test('list_principals returns valid response', async () => {
    const client = await createHttpClient();
    
    const result = await callTool(client, 'list_principals', { pageSize: 5 });
    expect(result).toBeDefined();
    
    const principalsData = JSON.parse(result);
    expect(principalsData._type).toBeDefined();
    
    await client.close();
  });

  test('list_time_entries returns valid response', async () => {
    const client = await createHttpClient();
    
    const result = await callTool(client, 'list_time_entries', { pageSize: 5 });
    expect(result).toBeDefined();
    
    const timeEntriesData = JSON.parse(result);
    expect(timeEntriesData._type).toBeDefined();
    
    await client.close();
  });
});

describe('Error Handling Tests', () => {
  test('get_project with invalid ID returns error', async () => {
    const client = await createHttpClient();
    
    const result = await callTool(client, 'get_project', { id: 999999999 });
    expect(result).toContain('Error');
    
    await client.close();
  });

  test('get_work_package with invalid ID returns error', async () => {
    const client = await createHttpClient();
    
    const result = await callTool(client, 'get_work_package', { id: 999999999 });
    expect(result).toContain('Error');
    
    await client.close();
  });

  test('get_user with invalid ID returns error', async () => {
    const client = await createHttpClient();
    
    const result = await callTool(client, 'get_user', { id: 999999999 });
    expect(result).toContain('Error');
    
    await client.close();
  });
});
