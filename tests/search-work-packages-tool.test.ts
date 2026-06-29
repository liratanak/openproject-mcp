/**
 * Validation tests for the search_work_packages MCP tool.
 *
 * The tool is tested over an in-memory transport so no live OpenProject
 * instance is needed. Network calls intentionally fail after validation.
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

describe('search_work_packages tool', () => {
  test('is registered with smart-search parameters', async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((entry) => entry.name === 'search_work_packages');
    expect(tool).toBeDefined();

    const schema = tool?.inputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const properties = schema?.properties ?? {};

    expect(Object.keys(properties)).toContain('query');
    expect(Object.keys(properties)).toContain('projectId');
    expect(Object.keys(properties)).toContain('statusId');
    expect(Object.keys(properties)).toContain('assigneeId');
    expect(Object.keys(properties)).toContain('includeClosed');
    expect(Object.keys(properties)).toContain('limit');
    expect(Object.keys(properties)).toContain('candidatePageSize');
    expect(Object.keys(properties)).toContain('maxPages');
    expect(schema?.required ?? []).toContain('query');
  });

  test('passes validation with a natural-language query', async () => {
    const result = await callTool('search_work_packages', {
      query: 'signin bug',
    });

    expect(result.text).not.toContain('Invalid arguments');
    expect(result.text).not.toContain('invalid_type');
  });

  test('accepts statusId and projectId as NAME strings', async () => {
    const result = await callTool('search_work_packages', {
      query: 'invoice upload',
      statusId: 'In Progress',
      projectId: 'Demo Project',
    });

    expect(result.text).not.toContain('expected');
    expect(result.text).not.toContain('invalid_type');
    expect(result.text).not.toContain('Invalid arguments');
  });

  test('rejects an empty query before calling OpenProject search', async () => {
    const result = await callTool('search_work_packages', {
      query: '   ',
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('query must not be empty');
  });
});

describe('work package search routing guidance', () => {
  test('discourages list_project_work_packages for search-style requests', async () => {
    const tools = await client.listTools();
    const listProjectTool = tools.tools.find((entry) => entry.name === 'list_project_work_packages');
    const searchTool = tools.tools.find((entry) => entry.name === 'search_work_packages');
    const semanticSearchTool = tools.tools.find((entry) => entry.name === 'semantic_search_project_work_packages');

    expect(listProjectTool?.description).toContain('Do NOT use this for search/find/look up/locate');
    expect(listProjectTool?.description).toContain('search_work_packages');
    expect(listProjectTool?.description).toContain('semantic_search_project_work_packages');
    expect(searchTool?.description).toContain('Never use `list_project_work_packages`');
    expect(semanticSearchTool?.description).toContain('never use `list_project_work_packages`');
  });
});

describe('semantic_search_project_work_packages tool', () => {
  test('is registered with project-scoped local vector parameters', async () => {
    const tools = await client.listTools();
    const tool = tools.tools.find((entry) => entry.name === 'semantic_search_project_work_packages');
    expect(tool).toBeDefined();

    const schema = tool?.inputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const properties = schema?.properties ?? {};

    expect(Object.keys(properties)).toContain('projectId');
    expect(Object.keys(properties)).toContain('query');
    expect(Object.keys(properties)).toContain('statusId');
    expect(Object.keys(properties)).toContain('assigneeId');
    expect(Object.keys(properties)).toContain('includeClosed');
    expect(Object.keys(properties)).toContain('limit');
    expect(Object.keys(properties)).toContain('candidateLimit');
    expect(schema?.required ?? []).toContain('projectId');
    expect(schema?.required ?? []).toContain('query');
  });

  test('passes validation with numeric projectId and natural-language query', async () => {
    const result = await callTool('semantic_search_project_work_packages', {
      projectId: 1,
      query: 'payment checkout capture',
    });

    expect(result.text).not.toContain('Invalid arguments');
    expect(result.text).not.toContain('invalid_type');
  });

  test('rejects candidateLimit above the 500 RAM window', async () => {
    const result = await callTool('semantic_search_project_work_packages', {
      projectId: 1,
      query: 'payment',
      candidateLimit: 501,
    });

    expect(result.isError).toBe(true);
  });

  test('rejects an empty query before building a local vector index', async () => {
    const result = await callTool('semantic_search_project_work_packages', {
      projectId: 1,
      query: '   ',
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('query must not be empty');
  });
});
