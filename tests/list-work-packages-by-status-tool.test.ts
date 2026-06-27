/**
 * Validation tests for the list_work_packages_by_status MCP tool.
 *
 * Regression coverage: the tool previously required a numeric `statusId`, so a
 * planner that omitted it (or passed a status NAME) got a -32602 validation
 * error. The tool now accepts a number OR a status name string, and treats
 * `statusId` as optional — when omitted it lists open work packages grouped by
 * status. These tests lock the input-schema contract via an in-memory
 * transport pair, so no live OpenProject instance is needed.
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
  // Force an unreachable host so calls fail at the network layer (fast) instead
  // of hitting a real OpenProject instance (Bun auto-loads .env).
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

describe('list_work_packages_by_status tool', () => {
  test('is registered with statusId optional and accepting number or string', async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((entry) => entry.name === 'list_work_packages_by_status');
    expect(tool).toBeDefined();

    const schema = tool?.inputSchema as {
      properties?: Record<string, { type?: string; anyOf?: unknown[] }>;
      required?: string[];
    };
    const properties = schema?.properties ?? {};

    expect(Object.keys(properties)).toContain('statusId');
    expect(Object.keys(properties)).toContain('projectId');
    expect(Object.keys(properties)).toContain('assigneeId');
    expect(Object.keys(properties)).toContain('offset');
    expect(Object.keys(properties)).toContain('pageSize');

    // statusId is no longer required.
    const required = schema?.required ?? [];
    expect(required).not.toContain('statusId');
  });

  test('passes validation WITHOUT a statusId (no longer a "Required" error)', async () => {
    // Omitting statusId must not fail input validation — the call proceeds to
    // the network layer (grouped-by-status mode) and surfaces a connection
    // error rather than a statusId validation error.
    const result = await callTool('list_work_packages_by_status', {});

    expect(result.text).not.toContain('statusId');
    expect(result.text).not.toContain('Required');
    expect(result.text).not.toContain('Invalid arguments');
  });

  test('accepts statusId as a NAME string (no "expected number" error)', async () => {
    // A status name must be accepted by validation; name -> ID resolution
    // happens after validation, at the network layer.
    const result = await callTool('list_work_packages_by_status', {
      statusId: 'In Progress',
    });

    expect(result.text).not.toContain('expected');
    expect(result.text).not.toContain('invalid_type');
    expect(result.text).not.toContain('Invalid arguments');
  });

  test('still accepts a numeric statusId', async () => {
    const result = await callTool('list_work_packages_by_status', {
      statusId: 7,
    });

    // Validation passes; only the network fetch fails.
    expect(result.text).not.toContain('Invalid arguments');
    expect(result.text).not.toContain('statusId');
  });
});
