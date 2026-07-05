/**
 * Registration and validation tests for the get_timesheet_summary_table MCP
 * tool (member × project logged-hours cross-table, e.g. "Summary total hours
 * by members, by projects in 1 table for last month"). Uses an in-memory
 * transport pair, so no HTTP server or live OpenProject instance is needed:
 * only the input validation paths are exercised.
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

describe('get_timesheet_summary_table tool', () => {
  test('is registered with the expected input schema', async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((entry) => entry.name === 'get_timesheet_summary_table');
    expect(tool).toBeDefined();

    const properties = Object.keys((tool?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {});
    expect(properties.sort()).toEqual(['endDate', 'period', 'projectId', 'prompt', 'startDate', 'user'].sort());
  });

  test('description routes duration-scoped time entry summaries here', async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((entry) => entry.name === 'get_timesheet_summary_table');
    expect(tool?.description).toContain('Summary total hours by members, by projects in 1 table for last month');
    expect(tool?.description).toContain('priority over list_work_packages_by_status');
    expect(tool?.description).toContain('Never use `list_time_entries` for summary/table/report requests');
  });

  test('list_time_entries tells the agent not to use it for summaries', async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((entry) => entry.name === 'list_time_entries');
    expect(tool?.description).toContain('Do NOT use this tool for any summary');
    expect(tool?.description).toContain('get_timesheet_summary_table');
  });

  test('rejects a call without a period or date range', async () => {
    const result = await callTool('get_timesheet_summary_table');
    expect(result.isError).toBe(true);
    expect(result.text).toContain('both "startDate" and "endDate"');
  });

  test('rejects a period combined with explicit dates', async () => {
    const result = await callTool('get_timesheet_summary_table', {
      period: 'last_month',
      startDate: '2026-05-01',
      endDate: '2026-05-31',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('not both');
  });

  test('rejects an invalid date range', async () => {
    const result = await callTool('get_timesheet_summary_table', {
      startDate: '2026-06-01',
      endDate: '2026-05-01',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('after endDate');
  });

  test('rejects an empty user reference', async () => {
    const result = await callTool('get_timesheet_summary_table', { period: 'last_month', user: '   ' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('User must not be empty');
  });

  test('accepts period "last_month" and proceeds past validation', async () => {
    // Valid input reaches the network layer (unreachable host), so the error
    // is a connection failure — not an input validation error.
    const result = await callTool('get_timesheet_summary_table', { period: 'last_month' });
    expect(result.isError).toBe(true);
    expect(result.text).not.toContain('Invalid arguments');
    expect(result.text).not.toContain('period');
  });

  test('accepts the natural-language summary prompt and infers the period', async () => {
    const result = await callTool('get_timesheet_summary_table', {
      prompt: 'Summary total hours by members, by projects in 1 table for last month',
    });

    expect(result.isError).toBe(true);
    expect(result.text).not.toContain('Invalid arguments');
    expect(result.text).not.toContain('both "startDate" and "endDate"');
    expect(result.text).not.toContain('Could not infer');
  });
});
