/**
 * Transport Comparison Tests
 * Verifies that STDIO and HTTP transports produce identical results
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, type Subprocess } from 'bun';

const HTTP_PORT = 3198;
const HTTP_URL = `http://localhost:${HTTP_PORT}/mcp`;

let httpServer: Subprocess | null = null;

// Create clients
async function createHttpClient(): Promise<Client> {
  const client = new Client({
    name: 'test-http-client',
    version: '1.0.0',
  });
  
  const transport = new StreamableHTTPClientTransport(new URL(HTTP_URL));
  await client.connect(transport);
  return client;
}

async function createStdioClient(): Promise<{ client: Client; process: Subprocess }> {
  const client = new Client({
    name: 'test-stdio-client',
    version: '1.0.0',
  });

  const transport = new StdioClientTransport({
    command: 'bun',
    args: ['run', 'index.ts'],
    env: process.env as Record<string, string>,
  });

  await client.connect(transport);
  
  // @ts-ignore - Access the underlying process
  const proc = transport._process;
  return { client, process: proc };
}

// Helper to call a tool and extract result
async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0]?.text || '';
}

// Helper to normalize response for comparison (removes timestamps and varying fields)
function normalizeResponse(response: string): object {
  try {
    const data = JSON.parse(response);
    // Remove fields that may vary between calls
    const removeVaryingFields = (obj: any): any => {
      if (Array.isArray(obj)) {
        return obj.map(removeVaryingFields);
      }
      if (obj && typeof obj === 'object') {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          // Skip timestamp and volatile fields
          if (['createdAt', 'updatedAt', 'lockVersion', '_links'].includes(key)) {
            continue;
          }
          result[key] = removeVaryingFields(value);
        }
        return result;
      }
      return obj;
    };
    return removeVaryingFields(data);
  } catch {
    return { raw: response };
  }
}

// Global setup and teardown
beforeAll(async () => {
  // Start HTTP server
  console.log('Starting HTTP server for comparison tests...');
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

  // Verify server is running
  const response = await fetch(`http://localhost:${HTTP_PORT}/health`);
  if (!response.ok) {
    throw new Error('HTTP server failed to start');
  }
  console.log('HTTP server ready for comparison tests');
});

afterAll(async () => {
  if (httpServer) {
    httpServer.kill();
    await httpServer.exited;
  }
});

describe('Transport Comparison', () => {
  test('both transports list same tools', async () => {
    const httpClient = await createHttpClient();
    const { client: stdioClient } = await createStdioClient();

    try {
      const httpTools = await httpClient.listTools();
      const stdioTools = await stdioClient.listTools();

      const httpToolNames = httpTools.tools.map(t => t.name).sort();
      const stdioToolNames = stdioTools.tools.map(t => t.name).sort();

      expect(httpToolNames).toEqual(stdioToolNames);
      expect(httpToolNames.length).toBeGreaterThan(30); // We have many tools
    } finally {
      await httpClient.close();
      await stdioClient.close();
    }
  });

  test('get_current_user returns same user on both transports', async () => {
    const httpClient = await createHttpClient();
    const { client: stdioClient } = await createStdioClient();

    try {
      const httpResult = await callTool(httpClient, 'get_current_user');
      const stdioResult = await callTool(stdioClient, 'get_current_user');

      const httpData = normalizeResponse(httpResult);
      const stdioData = normalizeResponse(stdioResult);

      expect(httpData).toEqual(stdioData);
    } finally {
      await httpClient.close();
      await stdioClient.close();
    }
  });

  test('list_projects returns same structure on both transports', async () => {
    const httpClient = await createHttpClient();
    const { client: stdioClient } = await createStdioClient();

    try {
      const httpResult = await callTool(httpClient, 'list_projects', { pageSize: 3 });
      const stdioResult = await callTool(stdioClient, 'list_projects', { pageSize: 3 });

      // Both should be valid JSON
      const httpData = JSON.parse(httpResult);
      const stdioData = JSON.parse(stdioResult);

      // Both should have the same structure
      expect(httpData._type).toBe(stdioData._type);
      expect(typeof httpData.total).toBe(typeof stdioData.total);
      expect(typeof httpData.count).toBe(typeof stdioData.count);
    } finally {
      await httpClient.close();
      await stdioClient.close();
    }
  });

  test('list_types returns identical results on both transports', async () => {
    const httpClient = await createHttpClient();
    const { client: stdioClient } = await createStdioClient();

    try {
      const httpResult = await callTool(httpClient, 'list_types');
      const stdioResult = await callTool(stdioClient, 'list_types');

      const httpData = normalizeResponse(httpResult);
      const stdioData = normalizeResponse(stdioResult);

      expect(httpData).toEqual(stdioData);
    } finally {
      await httpClient.close();
      await stdioClient.close();
    }
  });

  test('list_statuses returns identical results on both transports', async () => {
    const httpClient = await createHttpClient();
    const { client: stdioClient } = await createStdioClient();

    try {
      const httpResult = await callTool(httpClient, 'list_statuses');
      const stdioResult = await callTool(stdioClient, 'list_statuses');

      const httpData = normalizeResponse(httpResult);
      const stdioData = normalizeResponse(stdioResult);

      expect(httpData).toEqual(stdioData);
    } finally {
      await httpClient.close();
      await stdioClient.close();
    }
  });

  test('list_priorities returns identical results on both transports', async () => {
    const httpClient = await createHttpClient();
    const { client: stdioClient } = await createStdioClient();

    try {
      const httpResult = await callTool(httpClient, 'list_priorities');
      const stdioResult = await callTool(stdioClient, 'list_priorities');

      const httpData = normalizeResponse(httpResult);
      const stdioData = normalizeResponse(stdioResult);

      expect(httpData).toEqual(stdioData);
    } finally {
      await httpClient.close();
      await stdioClient.close();
    }
  });

  test('get_api_root returns same structure on both transports', async () => {
    const httpClient = await createHttpClient();
    const { client: stdioClient } = await createStdioClient();

    try {
      const httpResult = await callTool(httpClient, 'get_api_root');
      const stdioResult = await callTool(stdioClient, 'get_api_root');

      // Both should be valid JSON
      const httpData = JSON.parse(httpResult);
      const stdioData = JSON.parse(stdioResult);

      // Both should have _links
      expect(httpData._links).toBeDefined();
      expect(stdioData._links).toBeDefined();
    } finally {
      await httpClient.close();
      await stdioClient.close();
    }
  });

  test('error responses are consistent across transports', async () => {
    const httpClient = await createHttpClient();
    const { client: stdioClient } = await createStdioClient();

    try {
      const httpResult = await callTool(httpClient, 'get_project', { id: 999999999 });
      const stdioResult = await callTool(stdioClient, 'get_project', { id: 999999999 });

      // Both should return errors
      expect(httpResult).toContain('Error');
      expect(stdioResult).toContain('Error');
    } finally {
      await httpClient.close();
      await stdioClient.close();
    }
  });

  test('all tools have matching input schemas on both transports', async () => {
    const httpClient = await createHttpClient();
    const { client: stdioClient } = await createStdioClient();

    try {
      const httpTools = await httpClient.listTools();
      const stdioTools = await stdioClient.listTools();

      // Create maps for easy comparison
      const httpToolMap = new Map(httpTools.tools.map(t => [t.name, t]));
      const stdioToolMap = new Map(stdioTools.tools.map(t => [t.name, t]));

      // Check each tool
      for (const [name, httpTool] of httpToolMap) {
        const stdioTool = stdioToolMap.get(name);
        expect(stdioTool).toBeDefined();
        
        if (stdioTool) {
          expect(httpTool.description).toBe(stdioTool.description);
          expect(JSON.stringify(httpTool.inputSchema)).toBe(JSON.stringify(stdioTool.inputSchema));
        }
      }
    } finally {
      await httpClient.close();
      await stdioClient.close();
    }
  });
});
