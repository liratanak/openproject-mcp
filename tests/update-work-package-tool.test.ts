/**
 * Registration and validation tests for the update_work_package MCP tool.
 *
 * Regression coverage for failures seen from the Kardal AI Employee planner:
 *  1. the tool previously required `lockVersion` (which an LLM caller cannot
 *     know without a prior read) — now optional and auto-fetched.
 *  2. the planner sent `description` as an OpenProject-style rich-text object
 *     ({ format, raw }) instead of a plain string — now coerced to a string.
 * These tests lock the input-schema contract via an in-memory transport pair,
 * so no live OpenProject instance is needed.
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
  // Force an unreachable host so the auto-fetch GET fails fast locally
  // instead of hitting a real OpenProject instance (Bun auto-loads .env).
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

describe('update_work_package tool', () => {
  test('is registered with lockVersion optional', async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((entry) => entry.name === 'update_work_package');
    expect(tool).toBeDefined();

    const schema = tool?.inputSchema as {
      properties?: Record<string, { type?: string }>;
      required?: string[];
    };
    const properties = schema?.properties ?? {};

    expect(Object.keys(properties)).toContain('id');
    expect(Object.keys(properties)).toContain('lockVersion');
    expect(Object.keys(properties)).toContain('description');

    // lockVersion is now optional: id is the only required field.
    const required = schema?.required ?? [];
    expect(required).toContain('id');
    expect(required).not.toContain('lockVersion');

    expect(properties.lockVersion?.type).toBe('number');
  });

  test('passes validation without a lockVersion (no longer a "Required" error)', async () => {
    // Omitting lockVersion must not fail input validation. Without a fake
    // client the call proceeds to a network fetch against an invalid host and
    // surfaces a connection error rather than a lockVersion validation error.
    const result = await callTool('update_work_package', {
      id: 1602,
      description: 'Please configure the Mastercard Payment Gateway Services (MPGS) for the project.',
    });

    expect(result.isError).toBe(true);
    expect(result.text).not.toContain('lockVersion');
    expect(result.text).not.toContain('Required');
    expect(result.text).not.toContain('Invalid arguments');
  });

  test('accepts description as a plain string (no "Expected string, received object")', async () => {
    const result = await callTool('update_work_package', {
      id: 1602,
      description: 'Technical configuration of MPGS API integration.',
    });

    // Validation passes; the call only fails at the network layer.
    expect(result.text).not.toContain('Expected string, received object');
    expect(result.text).not.toContain('Invalid arguments');
  });

  test('accepts description as an OpenProject-style object { format, raw } and coerces it', async () => {
    // The planner mirrors the API response shape ({ format, raw, html }).
    // The tool must coerce { raw } to a plain string and NOT reject it as an
    // object. This is the exact payload that failed in production.
    const result = await callTool('update_work_package', {
      id: 1602,
      description: {
        format: 'markdown',
        raw: 'Technical configuration of MPGS API integration.\n- Integrate MPGS REST APIs for payment authorization and capture.',
      },
    });

    // Validation must pass; the only failure is the network fetch.
    expect(result.text).not.toContain('Expected string, received object');
    expect(result.text).not.toContain('Invalid arguments');
    expect(result.text).not.toContain('description');
  });
});
