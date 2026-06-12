/**
 * Registration and validation tests for the get_timesheet_total MCP tool.
 * Uses an in-memory transport pair, so no HTTP server or live OpenProject
 * instance is needed: only the input validation paths are exercised.
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

describe('get_timesheet_total tool', () => {
  test('is registered with the expected input schema', async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((entry) => entry.name === 'get_timesheet_total');
    expect(tool).toBeDefined();

    const properties = Object.keys((tool?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {});
    expect(properties.sort()).toEqual(
      ['endDate', 'includeEntries', 'period', 'projectId', 'startDate', 'user'].sort()
    );
  });

  test('rejects a call without a period or date range', async () => {
    const result = await callTool('get_timesheet_total');
    expect(result.isError).toBe(true);
    expect(result.text).toContain('both "startDate" and "endDate"');
  });

  test('rejects a period combined with explicit dates', async () => {
    const result = await callTool('get_timesheet_total', {
      period: 'last_month',
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('not both');
  });

  test('rejects an invalid date range', async () => {
    const result = await callTool('get_timesheet_total', {
      startDate: '2026-06-01',
      endDate: '2026-05-01',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('after endDate');
  });

  test('rejects an empty user reference', async () => {
    const result = await callTool('get_timesheet_total', { period: 'this_week', user: '   ' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('User must not be empty');
  });
});
