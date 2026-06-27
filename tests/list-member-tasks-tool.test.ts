/**
 * Validation tests for the list_member_tasks MCP tool.
 *
 * These lock the input-schema contract over an in-memory transport pair (no
 * live OpenProject instance): all three filters are optional, projectId/statusId
 * accept a number OR a name string, and userId is numeric. Name -> ID resolution
 * happens after validation at the network layer, so an unreachable host surfaces
 * a connection error rather than a schema error.
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
  // Force an unreachable host so calls fail fast at the network layer instead of
  // hitting a real OpenProject instance (Bun auto-loads .env).
  process.env.OPENPROJECT_URL = 'http://openproject.test.invalid';
  process.env.OPENPROJECT_API_KEY = 'test-key';

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

describe('list_member_tasks tool', () => {
  test('is registered with userId, projectId and statusId all optional', async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((entry) => entry.name === 'list_member_tasks');
    expect(tool).toBeDefined();

    const schema = tool?.inputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const properties = schema?.properties ?? {};

    expect(Object.keys(properties)).toContain('userId');
    expect(Object.keys(properties)).toContain('projectId');
    expect(Object.keys(properties)).toContain('statusId');

    expect(schema?.required ?? []).toEqual([]);
  });

  test('passes validation with no arguments (full nested tree mode)', async () => {
    const result = await callTool('list_member_tasks', {});

    expect(result.text).not.toContain('Required');
    expect(result.text).not.toContain('Invalid arguments');
  });

  test('accepts statusId and projectId as NAME strings', async () => {
    const result = await callTool('list_member_tasks', {
      statusId: 'In Progress',
      projectId: 'Demo Project',
    });

    expect(result.text).not.toContain('expected');
    expect(result.text).not.toContain('invalid_type');
    expect(result.text).not.toContain('Invalid arguments');
  });

  test('accepts numeric ids for every filter', async () => {
    const result = await callTool('list_member_tasks', {
      userId: 5,
      projectId: 1,
      statusId: 7,
    });

    expect(result.text).not.toContain('Invalid arguments');
    expect(result.text).not.toContain('invalid_type');
  });

  test('rejects a non-numeric userId (must be a user ID)', async () => {
    const result = await callTool('list_member_tasks', {
      userId: 'John',
    });

    // userId is strictly numeric, so this fails schema validation.
    expect(result.isError).toBe(true);
  });
});
