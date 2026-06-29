/**
 * Registration/validation tests for attachment support on the
 * create_work_package and update_work_package MCP tools, plus the standalone
 * attachment management tools. The input-schema contract is verified over an
 * in-memory transport pair, so no live OpenProject instance is required.
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
  // Force an unreachable host so any network call fails fast locally.
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

describe('attachment support on work package tools', () => {
  test('create_work_package exposes an array "attachments" param', async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((entry) => entry.name === 'create_work_package');
    expect(tool).toBeDefined();

    const schema = tool?.inputSchema as { properties?: Record<string, { type?: string }>; required?: string[] };
    const properties = schema?.properties ?? {};
    expect(Object.keys(properties)).toContain('attachments');
    expect(properties.attachments?.type).toBe('array');
    // attachments must remain optional
    expect(schema?.required ?? []).not.toContain('attachments');
  });

  test('update_work_package exposes an array "attachments" param', async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((entry) => entry.name === 'update_work_package');
    const schema = tool?.inputSchema as { properties?: Record<string, { type?: string }>; required?: string[] };
    const properties = schema?.properties ?? {};
    expect(Object.keys(properties)).toContain('attachments');
    expect(properties.attachments?.type).toBe('array');
    expect(schema?.required ?? []).not.toContain('attachments');
  });

  test('standalone attachment tools are registered', async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((entry) => entry.name);
    expect(names).toContain('list_work_package_attachments');
    expect(names).toContain('delete_attachment');
  });

  test('attachments param passes validation (fails only at the network layer)', async () => {
    const result = await callTool('create_work_package', {
      projectId: 1,
      subject: 'With an inline image',
      attachments: [{ fileName: 'diagram.png', base64: Buffer.from('x').toString('base64') }],
    });

    expect(result.isError).toBe(true);
    expect(result.text).not.toContain('Invalid arguments');
    expect(result.text).not.toContain('attachments');
  });
});
