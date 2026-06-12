/**
 * Registration and validation tests for the bulk_update_work_packages MCP
 * tool. Uses an in-memory transport pair, so no HTTP server or live
 * OpenProject instance is needed: only the input validation paths are
 * exercised (they fail before any API request would be made).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { setupMcpServer } from '../src/server-setup.ts';

let client: Client;

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return { isError: result.isError === true, text: content[0]?.text ?? '' };
}

beforeAll(async () => {
  process.env.OPENPROJECT_URL ??= 'http://openproject.test.invalid';
  process.env.OPENPROJECT_API_KEY ??= 'test-key';

  const { server, initClient } = setupMcpServer({ name: 'test-server', version: '0.0.0' });
  await initClient();

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client?.close();
});

describe('bulk_update_work_packages tool', () => {
  test('is registered with the expected input schema', async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((entry) => entry.name === 'bulk_update_work_packages');
    expect(tool).toBeDefined();

    const schema = tool?.inputSchema as {
      properties?: Record<string, { items?: { properties?: Record<string, unknown> } }>;
    };
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(
      ['defaults', 'notify', 'stopOnError', 'updates'].sort()
    );

    const itemProperties = Object.keys(schema?.properties?.updates?.items?.properties ?? {});
    expect(itemProperties).toContain('id');
    expect(itemProperties).toContain('lockVersion');
    expect(itemProperties).toContain('statusId');
    expect(itemProperties).toContain('assigneeId');
  });

  test('rejects duplicate work package IDs', async () => {
    const result = await callTool('bulk_update_work_packages', {
      updates: [{ id: 101 }, { id: 101 }],
      defaults: { statusId: 7 },
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Duplicate work package IDs');
  });

  test('rejects items without any changes', async () => {
    const result = await callTool('bulk_update_work_packages', {
      updates: [{ id: 101 }, { id: 102 }],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('No changes specified for work package(s) 101, 102');
  });
});
