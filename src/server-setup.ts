#!/usr/bin/env bun
/**
 * OpenProject MCP Server Setup
 * Shared server configuration for both STDIO and HTTP transports
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createClient, type OpenProjectClient, type Project, type WorkPackage } from './openproject-client.ts';
import {
  TIMESHEET_PERIOD_PRESETS,
  aggregateTimeEntries,
  buildTimeEntryFilters,
  resolvePeriod,
} from './timesheet.ts';
import { executeBulkWorkPackageUpdate, updateWithLockRetry, listChangedFields, type WorkPackageChanges } from './bulk-update.ts';
import {
  appendInlineImages,
  prepareAttachments,
  uploadPreparedAttachments,
  type AttachmentInput,
  type UploadedAttachmentResult,
} from './attachments.ts';
import { buildMemberTaskFilters, groupWorkPackagesByProjectMemberStatus } from './member-tasks.ts';
import {
  DEFAULT_STATUS_TASK_PAGE_SIZE,
  buildStatusWorkPackageFilters,
  getStatusLabelForSummary,
  groupStatusTasks,
  summarizeWorkPackagesByStatus,
  toStatusTask,
} from './status-tasks.ts';
import {
  MAX_WORK_PACKAGE_SEARCH_LIMIT,
  MAX_WORK_PACKAGE_SEARCH_MAX_PAGES,
  MAX_WORK_PACKAGE_SEARCH_PAGE_SIZE,
  MAX_PROJECT_MEMORY_CANDIDATE_LIMIT,
  PROJECT_MEMORY_SEARCH_SELECT,
  PROJECT_MEMORY_SEARCH_SORT_BY,
  buildWorkPackageSearchFilters,
  clampProjectMemoryCandidateLimit,
  clampSearchLimit,
  clampSearchMaxPages,
  clampSearchPageSize,
  mergeWorkPackages,
  parseWorkPackageIdQuery,
  rankProjectMemorySearchResults,
  rankWorkPackageSearchResults,
} from './work-package-search.ts';
import logger from './logger.ts';

export interface ServerConfig {
  name?: string;
  version?: string;
}

// Helper to safely stringify responses
export function formatResponse(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// Helper to create API links
export function createLink(type: string, id: number | string): string {
  return `/api/v3/${type}/${id}`;
}

/**
 * Lenient `description` input. The OpenProject API *returns* description as a
 * rich-text object ({ format, raw, html }), and LLM planners sometimes mirror
 * that object shape when calling write tools. The MCP tool schemas expect a
 * plain string, so this preprocessor coerces { raw } (or { format, raw, html })
 * back to a plain string before `z.string()` validates it. The generated JSON
 * schema still advertises `type: string`; objects are silently normalized.
 */
export const descriptionInput = z.preprocess((val) => {
  if (val == null) return undefined;
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null && typeof (val as Record<string, unknown>).raw === 'string') {
    return (val as Record<string, string>).raw;
  }
  return val;
}, z.string().optional());

/**
 * Per-file attachment input shared by the create/update work package tools.
 * Each file is provided either by a local `filePath` the server can read or as
 * `base64` content. Image files are embedded inline in the work package
 * description by default; every other file type is attached as a normal file.
 */
export const attachmentInputSchema = z.object({
  fileName: z.string().optional().describe('File name including extension (e.g. "diagram.png"). Derived from filePath when omitted; required for base64 content.'),
  filePath: z.string().optional().describe('Path to a local file the server can read. Provide this OR base64, not both.'),
  base64: z.string().optional().describe('Base64-encoded file content. Provide this OR filePath, not both.'),
  contentType: z.string().optional().describe('MIME type (e.g. "image/png"). Auto-detected from the file extension when omitted.'),
  description: z.string().optional().describe('Optional caption stored on the attachment.'),
  inline: z.boolean().optional().describe('Embed the file in the description as an inline image. Defaults to true for images, false for other file types.'),
});

/**
 * Upload attachments to a work package, then embed any inline images into its
 * description. Returns the per-file upload results and, when inline images were
 * added, the work package after its description was patched. The supplied
 * `baseDescription` is the description to extend (the value just written, or
 * the work package's current description).
 */
export async function attachToWorkPackage(
  client: OpenProjectClient,
  workPackageId: number,
  lockVersion: number,
  baseDescription: string,
  attachments: AttachmentInput[],
  notify?: boolean
): Promise<{ results: UploadedAttachmentResult[]; workPackage?: WorkPackage }> {
  const prepared = await prepareAttachments(attachments);
  const { results, inlineMarkdown } = await uploadPreparedAttachments(client, workPackageId, prepared);

  let workPackage: WorkPackage | undefined;
  if (inlineMarkdown) {
    const description = appendInlineImages(baseDescription, inlineMarkdown);
    const updated = await updateWithLockRetry(client, { id: workPackageId, lockVersion }, { description }, notify);
    workPackage = updated.workPackage;
  }

  return { results, workPackage };
}

export async function resolveProjectId(client: OpenProjectClient, projectRef: number | string): Promise<number> {
  if (typeof projectRef === 'number') {
    return projectRef;
  }

  const numericId = Number(projectRef);
  if (!Number.isNaN(numericId)) {
    return numericId;
  }

  const project = await client.getProject(projectRef);
  return project.id;
}

/**
 * Resolve a project reference (numeric ID, numeric string, identifier, or human
 * project NAME) to a project ID and name. Identifiers/names are matched against
 * the project list — case-insensitive exact match on name or identifier first,
 * then a unique partial name match — so callers can pass "Demo Project" or
 * "demo-project" interchangeably. Throws on no match or an ambiguous name.
 */
export async function resolveProjectRef(
  client: OpenProjectClient,
  projectRef: number | string
): Promise<{ id: number; name?: string }> {
  if (typeof projectRef === 'number') {
    return { id: projectRef };
  }

  const trimmed = projectRef.trim();
  if (trimmed === '') {
    throw new Error('Project must not be empty; pass a project ID, identifier, or name');
  }

  const numericId = Number(trimmed);
  if (Number.isInteger(numericId) && numericId > 0) {
    return { id: numericId };
  }

  const result = await client.listProjects({ pageSize: 1000 });
  const projects = (result._embedded?.elements ?? result.elements ?? []) as Project[];
  const needle = trimmed.toLowerCase();
  const exact = projects.filter(
    (project) => project.name.toLowerCase() === needle || project.identifier?.toLowerCase() === needle
  );
  const matches = exact.length > 0 ? exact : projects.filter((project) => project.name.toLowerCase().includes(needle));

  if (matches.length === 0) {
    throw new Error(`No project found matching "${trimmed}"`);
  }
  if (matches.length > 1) {
    const candidates = matches.map((project) => `${project.name} (ID ${project.id})`).join(', ');
    throw new Error(`Multiple projects match "${trimmed}": ${candidates}. Use the project ID instead`);
  }

  const match = matches[0]!;
  return { id: match.id, name: match.name };
}

/**
 * Resolve a status reference (numeric ID, numeric string, or status NAME like
 * "In Progress") to a numeric status ID. When a name is given, the statuses
 * are listed and matched case-insensitively so callers do not need a separate
 * `list_statuses` round-trip. Throws a helpful error listing the known
 * statuses when no match is found.
 */
export async function resolveStatusId(client: OpenProjectClient, statusRef: number | string): Promise<number> {
  if (typeof statusRef === 'number') {
    return statusRef;
  }

  const numericId = Number(statusRef);
  if (!Number.isNaN(numericId) && statusRef.trim() !== '') {
    return numericId;
  }

  const result = await client.listStatuses();
  const statuses = (result._embedded?.elements ?? result.elements ?? []) as Array<{ id: number; name: string }>;
  const needle = statusRef.trim().toLowerCase();
  const match = statuses.find((status) => status.name.toLowerCase() === needle);
  if (!match) {
    const known = statuses.map((status) => `${status.name} (id=${status.id})`).join(', ');
    throw new Error(`Unknown status "${statusRef}". Known statuses: ${known}`);
  }
  return match.id;
}

export function buildProjectMembershipFilter(projectId: number): string {
  return JSON.stringify([
    {
      project: {
        operator: '=',
        values: [String(projectId)],
      },
    },
  ]);
}

export function extractResourceId(href: string, resource: string): number | null {
  const regex = new RegExp(`/${resource}/(\\d+)(?:/|$)`);
  const match = href.match(regex);
  return match ? Number(match[1]) : null;
}

/**
 * Resolve a user reference into a user ID. Accepts a numeric ID, "me" for the
 * authenticated user, or a (partial) name which is looked up via the
 * principals endpoint (works without admin rights, unlike /users).
 */
export async function resolveTimesheetUser(
  client: OpenProjectClient,
  userRef: number | string
): Promise<{ id: number; name?: string }> {
  if (typeof userRef === 'number') {
    return { id: userRef };
  }

  const trimmed = userRef.trim();
  if (trimmed === '') {
    throw new Error('User must not be empty; pass a user ID, "me", or a name to search for');
  }

  if (trimmed.toLowerCase() === 'me') {
    const me = await client.getCurrentUser();
    return { id: me.id, name: me.name };
  }

  const numericId = Number(trimmed);
  if (Number.isInteger(numericId) && numericId > 0) {
    return { id: numericId };
  }

  const filters = JSON.stringify([
    { type: { operator: '=', values: ['User'] } },
    { any_name_attribute: { operator: '~', values: [trimmed] } },
  ]);
  const result = await client.listPrincipals({ filters, pageSize: 25 });
  const principals = ((result._embedded?.elements ?? result.elements ?? []) as Array<{ id?: number; name?: string }>)
    .filter((principal): principal is { id: number; name?: string } => typeof principal?.id === 'number');

  const exactMatches = principals.filter((principal) => principal.name?.toLowerCase() === trimmed.toLowerCase());
  const matches = exactMatches.length > 0 ? exactMatches : principals;

  if (matches.length === 0) {
    throw new Error(`No user found matching "${trimmed}"`);
  }
  if (matches.length > 1) {
    const candidates = matches.map((principal) => `${principal.name ?? 'Unnamed'} (ID ${principal.id})`).join(', ');
    throw new Error(`Multiple users match "${trimmed}": ${candidates}. Use the user ID instead`);
  }

  const match = matches[0]!;
  return { id: match.id, name: match.name };
}

// Helper to wrap tool handlers with logging
function wrapToolHandler<T extends z.ZodTypeAny>(
  client: OpenProjectClient,
  toolName: string,
  handler: (params: z.infer<T>) => Promise<any>
): (params: z.infer<T>) => Promise<any> {
  return async (params: z.infer<T>) => {
    const caller = `tool:${toolName}`;

    // Log tool invocation
    logger.logToolInvocation(caller, toolName, params);

    // Set caller in client for API logging
    client.setCaller(caller);

    try {
      const result = await handler(params);

      // Log successful tool result
      logger.logToolResult(caller, toolName, true, result);

      return result;
    } catch (error) {
      // Log failed tool result
      logger.logToolResult(caller, toolName, false, undefined, error as Error);

      throw error;
    }
  };
}

export function setupMcpServer(config: ServerConfig = {}): { server: McpServer; initClient: () => Promise<OpenProjectClient> } {
  const server = new McpServer({
    name: config.name || 'openproject-mcp',
    version: config.version || '1.0.0',
  });

  let client: OpenProjectClient;

  const initClient = async (): Promise<OpenProjectClient> => {
    client = createClient('system');
    return client;
  };

  // ============== Root & Configuration Tools ==============

  server.tool(
    'get_api_root',
    'Get the OpenProject API root information',
    {},
    async () => {
      const toolName = 'get_api_root';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, {});
      client.setCaller(caller);

      try {
        const result = await client.getRoot();
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_configuration',
    'Get the OpenProject instance configuration',
    {},
    async () => {
      const toolName = 'get_configuration';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, {});
      client.setCaller(caller);

      try {
        const result = await client.getConfiguration();
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ============== Project Tools ==============

  server.tool(
    'list_projects',
    'List all projects accessible to the current user',
    {
      offset: z.number().optional().describe('Page offset for pagination (default: 0)'),
      pageSize: z.number().optional().describe('Number of items per page (default: 20, max: 1000)'),
      filters: z.string().optional().describe('JSON filter expression'),
      sortBy: z.string().optional().describe('Sort criteria as JSON array'),
    },
    async (params) => {
      const toolName = 'list_projects';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, params);
      client.setCaller(caller);

      try {
        const result = await client.listProjects(params);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_project',
    'Get details of a specific project',
    {
      id: z.union([z.number(), z.string()]).describe('Project ID or identifier'),
    },
    async ({ id }) => {
      const toolName = 'get_project';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        const result = await client.getProject(id);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'create_project',
    'Create a new project',
    {
      name: z.string().describe('Name of the project'),
      identifier: z.string().optional().describe('Unique identifier (auto-generated if not provided)'),
      description: descriptionInput.describe('Project description'),
      public: z.boolean().optional().describe('Whether the project is public (default: false)'),
      status: z.enum(['on_track', 'at_risk', 'off_track', 'not_set']).optional().describe('Project status'),
      statusExplanation: z.string().optional().describe('Explanation for the project status'),
      parentId: z.number().optional().describe('Parent project ID'),
    },
    async ({ name, identifier, description, public: isPublic, status, statusExplanation, parentId }) => {
      const toolName = 'create_project';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { name, identifier, description, public: isPublic, status, statusExplanation, parentId });
      client.setCaller(caller);

      try {
        const data: Parameters<typeof client.createProject>[0] = {
          name,
          identifier,
          public: isPublic,
          status,
        };
        if (description) data.description = { raw: description };
        if (statusExplanation) data.statusExplanation = { raw: statusExplanation };
        if (parentId) data.parent = { href: createLink('projects', parentId) };
        
        const result = await client.createProject(data);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'update_project',
    'Update an existing project',
    {
      id: z.union([z.number(), z.string()]).describe('Project ID or identifier'),
      name: z.string().optional().describe('New name for the project'),
      description: descriptionInput.describe('New project description'),
      public: z.boolean().optional().describe('Whether the project is public'),
      active: z.boolean().optional().describe('Whether the project is active'),
      status: z.enum(['on_track', 'at_risk', 'off_track', 'not_set']).optional().describe('Project status'),
      statusExplanation: z.string().optional().describe('Explanation for the project status'),
    },
    async ({ id, name, description, public: isPublic, active, status, statusExplanation }) => {
      const toolName = 'update_project';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id, name, description, public: isPublic, active, status, statusExplanation });
      client.setCaller(caller);

      try {
        const data: Parameters<typeof client.updateProject>[1] = {
          name,
          public: isPublic,
          active,
          status,
        };
        if (description !== undefined) data.description = { raw: description };
        if (statusExplanation !== undefined) data.statusExplanation = { raw: statusExplanation };
        
        const result = await client.updateProject(id, data);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'delete_project',
    'Delete a project (requires confirmation)',
    {
      id: z.union([z.number(), z.string()]).describe('Project ID or identifier'),
    },
    async ({ id }) => {
      const toolName = 'delete_project';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        await client.deleteProject(id);
        return { content: [{ type: 'text', text: `Project ${id} deleted successfully` }] };
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ============== Work Package Tools ==============

  server.tool(
    'list_work_packages',
    'List all work packages (tasks) with optional filtering. ' +
      'By default, this returns OPEN work packages only; pass an explicit `filters` value if you need closed tasks. ' +
      'IMPORTANT — filtering by status (e.g. "In Progress"): statuses are referenced by numeric ID, not name. ' +
      'Do NOT guess the ID. First call `list_statuses` to resolve the status name to its ID (e.g. "In Progress" -> 7), then pass it in `filters`. ' +
      'For "In Progress tasks per member", resolve the status ID once with `list_statuses`, then filter by status and assignee. ' +
      'Filter examples (the `filters` param is a JSON-encoded array of conditions): ' +
      'by status: [{"status":{"operator":"=","values":["7"]}}]; ' +
      'by status + assignee: [{"status":{"operator":"=","values":["7"]}},{"assignee":{"operator":"=","values":["3"]}}]; ' +
      'open work packages only: [{"status":{"operator":"o","values":[]}}]. ' +
      'Tip: prefer the dedicated `list_work_packages_by_status` tool when filtering by a single status.',
    {
      offset: z.number().optional().describe('Page offset for pagination'),
      pageSize: z.number().optional().describe('Number of items per page'),
      filters: z.string().optional().describe('JSON filter expression (array of conditions). Status/assignee values are numeric IDs as strings, e.g. [{"status":{"operator":"=","values":["7"]}}]. Resolve status names to IDs via list_statuses first'),
      sortBy: z.string().optional().describe('Sort criteria as JSON array'),
      groupBy: z.string().optional().describe('Group by attribute (e.g. "status" or "assignee")'),
      query_id: z.number().optional().describe('Query ID to apply a saved query/filter'),
    },
    async (params) => {
      const toolName = 'list_work_packages';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, params);
      client.setCaller(caller);

      try {
        const effectiveParams = params.filters === undefined && params.query_id === undefined
          ? { ...params, filters: buildStatusWorkPackageFilters({}) }
          : params;
        const result = await client.listWorkPackages(effectiveParams);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'list_project_work_packages',
    'List work packages (tasks) in a specific project. ' +
      'Do NOT use this for search/find/look up/locate/related/relevant/keyword requests; use `search_work_packages` instead, or `semantic_search_project_work_packages` when the user wants project-scoped related/relevant tickets. ' +
      'By default, this returns OPEN work packages only; pass an explicit `filters` value if you need closed tasks. ' +
      'IMPORTANT — to filter by status (e.g. "In Progress"), statuses are referenced by numeric ID, not name: ' +
      'call `list_statuses` first to resolve the name to its ID, then pass it in `filters` ' +
      '(e.g. [{"status":{"operator":"=","values":["7"]}}]). ' +
      'For "In Progress tasks per member" within a project, resolve the status ID once, then filter by status (optionally combined with assignee).',
    {
      projectId: z.union([z.number(), z.string()]).describe('Project ID or identifier'),
      offset: z.number().optional().describe('Page offset for pagination'),
      pageSize: z.number().optional().describe('Number of items per page'),
      filters: z.string().optional().describe('JSON filter expression (array of conditions). Status/assignee values are numeric IDs as strings, e.g. [{"status":{"operator":"=","values":["7"]}}]. Resolve status names to IDs via list_statuses first'),
      sortBy: z.string().optional().describe('Sort criteria as JSON array'),
      query_id: z.number().optional().describe('Query ID to apply a saved query/filter'),
    },
    async ({ projectId, ...params }) => {
      const toolName = 'list_project_work_packages';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { projectId, ...params });
      client.setCaller(caller);

      try {
        const effectiveParams = params.filters === undefined && params.query_id === undefined
          ? { ...params, filters: buildStatusWorkPackageFilters({}) }
          : params;
        const result = await client.listProjectWorkPackages(projectId, effectiveParams);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'search_work_packages',
    'Smart search for work packages by natural text. Prefer this tool whenever a request asks to search, find, look up, or locate tasks/work packages by title, description, comments, attachments, similar words, or possibly misspelled text. ' +
      'Never use `list_project_work_packages` for these search-style requests, even when a project is provided; pass `projectId` here to scope the search. ' +
      'It uses OpenProject\'s `search` filter for server-side full-text candidates, then locally ranks candidates with typo-tolerant fuzzy matching and lightweight related-term matching (for example bug/issue/defect, login/auth/signin, upload/attachment/file). ' +
      'By default it searches OPEN work packages only; set `includeClosed` to true to search closed tasks too, or pass `statusId` as a numeric ID or status NAME to search one status.',
    {
      query: z.string().describe('Text to search for. Supports natural words, phrases, typos, related terms, or a work package ID like "#123"'),
      projectId: z
        .union([z.number(), z.string()])
        .optional()
        .describe('Optional project ID, identifier, or NAME (e.g. "Demo Project") to scope search to one project'),
      statusId: z
        .union([z.number(), z.string()])
        .optional()
        .describe('Optional status ID or status NAME (e.g. "In Progress"). When omitted, open work packages only are searched unless includeClosed is true'),
      assigneeId: z.number().optional().describe('Optional assignee user ID'),
      includeClosed: z.boolean().optional().describe('Search closed work packages too when statusId is omitted (default: false)'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_WORK_PACKAGE_SEARCH_LIMIT)
        .optional()
        .describe(`Maximum ranked results to return (default 25, max ${MAX_WORK_PACKAGE_SEARCH_LIMIT})`),
      candidatePageSize: z
        .number()
        .int()
        .min(1)
        .max(MAX_WORK_PACKAGE_SEARCH_PAGE_SIZE)
        .optional()
        .describe(`Candidate fetch page size for ranking (default 200, max ${MAX_WORK_PACKAGE_SEARCH_PAGE_SIZE})`),
      maxPages: z
        .number()
        .int()
        .min(1)
        .max(MAX_WORK_PACKAGE_SEARCH_MAX_PAGES)
        .optional()
        .describe(`Maximum pages to fetch for candidate ranking (default 5, max ${MAX_WORK_PACKAGE_SEARCH_MAX_PAGES})`),
      sortBy: z.string().optional().describe('Optional OpenProject sort criteria as a JSON array for candidate fetching'),
    },
    async ({ query, projectId, statusId, assigneeId, includeClosed, limit, candidatePageSize, maxPages, sortBy }) => {
      const toolName = 'search_work_packages';
      const caller = `tool:${toolName}`;
      const params = { query, projectId, statusId, assigneeId, includeClosed, limit, candidatePageSize, maxPages, sortBy };
      logger.logToolInvocation(caller, toolName, params);
      client.setCaller(caller);

      try {
        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
          throw new Error('query must not be empty');
        }

        const resolvedProject = projectId === undefined ? undefined : await resolveProjectRef(client, projectId);
        const resolvedStatusId = statusId === undefined ? undefined : await resolveStatusId(client, statusId);
        const effectiveLimit = clampSearchLimit(limit);
        const effectivePageSize = clampSearchPageSize(candidatePageSize);
        const effectiveMaxPages = clampSearchMaxPages(maxPages);
        const exactWorkPackageId = parseWorkPackageIdQuery(trimmedQuery);

        const baseFilters = buildWorkPackageSearchFilters({
          statusId: resolvedStatusId,
          assigneeId,
          includeClosed,
          useFullText: false,
        });
        const fullTextFilters = buildWorkPackageSearchFilters({
          query: trimmedQuery,
          statusId: resolvedStatusId,
          assigneeId,
          includeClosed,
        });

        const [fullTextFetch, broadFetch, exactIdFetch] = await Promise.allSettled([
          client.listAllWorkPackages({
            projectId: resolvedProject?.id,
            filters: fullTextFilters,
            sortBy,
            pageSize: effectivePageSize,
            maxPages: effectiveMaxPages,
          }),
          client.listAllWorkPackages({
            projectId: resolvedProject?.id,
            filters: baseFilters,
            sortBy,
            pageSize: effectivePageSize,
            maxPages: effectiveMaxPages,
          }),
          exactWorkPackageId === null
            ? Promise.resolve<WorkPackage | null>(null)
            : client.getWorkPackage(exactWorkPackageId),
        ] as const);

        if (
          fullTextFetch.status === 'rejected' &&
          broadFetch.status === 'rejected' &&
          (exactWorkPackageId === null || exactIdFetch.status === 'rejected')
        ) {
          throw new Error(
            `Search failed: ${String(fullTextFetch.reason instanceof Error ? fullTextFetch.reason.message : fullTextFetch.reason)}; ` +
              `fallback failed: ${String(broadFetch.reason instanceof Error ? broadFetch.reason.message : broadFetch.reason)}`
          );
        }

        const fullTextWorkPackages = fullTextFetch.status === 'fulfilled' ? fullTextFetch.value.workPackages : [];
        const broadWorkPackages = broadFetch.status === 'fulfilled' ? broadFetch.value.workPackages : [];

        function workPackageMatchesSearchFilters(workPackage: WorkPackage): boolean {
          const links = workPackage._links ?? {};
          if (
            resolvedProject &&
            extractResourceId(links.project?.href ?? '', 'projects') !== resolvedProject.id
          ) {
            return false;
          }
          if (
            resolvedStatusId !== undefined &&
            extractResourceId(links.status?.href ?? '', 'statuses') !== resolvedStatusId
          ) {
            return false;
          }
          if (
            assigneeId !== undefined &&
            extractResourceId(links.assignee?.href ?? '', 'users') !== assigneeId
          ) {
            return false;
          }
          return true;
        }

        const exactIdWorkPackages =
          exactIdFetch.status === 'fulfilled' && exactIdFetch.value && workPackageMatchesSearchFilters(exactIdFetch.value)
            ? [exactIdFetch.value]
            : [];
        const serverMatchedIds = new Set(fullTextWorkPackages.map((workPackage) => workPackage.id));
        const candidates = mergeWorkPackages(exactIdWorkPackages, fullTextWorkPackages, broadWorkPackages);
        const results = rankWorkPackageSearchResults(candidates, trimmedQuery, {
          serverMatchedIds,
          limit: effectiveLimit,
        });

        const warnings: string[] = [];
        if (fullTextFetch.status === 'rejected') {
          warnings.push(
            `OpenProject full-text search failed: ${
              fullTextFetch.reason instanceof Error ? fullTextFetch.reason.message : String(fullTextFetch.reason)
            }`
          );
        }
        if (broadFetch.status === 'rejected') {
          warnings.push(
            `Broad fuzzy candidate fetch failed: ${
              broadFetch.reason instanceof Error ? broadFetch.reason.message : String(broadFetch.reason)
            }`
          );
        }
        if (exactWorkPackageId !== null && exactIdFetch.status === 'rejected') {
          warnings.push(
            `Exact ID lookup for work package ${exactWorkPackageId} failed: ${
              exactIdFetch.reason instanceof Error ? exactIdFetch.reason.message : String(exactIdFetch.reason)
            }`
          );
        }

        const result = {
          query: trimmedQuery,
          filters: {
            project: resolvedProject ? { id: resolvedProject.id, name: resolvedProject.name ?? null } : null,
            statusId: resolvedStatusId ?? null,
            statusRef: statusId ?? null,
            assigneeId: assigneeId ?? null,
            openOnly: resolvedStatusId === undefined && includeClosed !== true,
            includeClosed: includeClosed === true,
          },
          search: {
            mode: 'openproject_full_text_plus_local_fuzzy',
            semantic: 'lexical aliases only; no embedding service is used',
            fullTextFilter: fullTextFilters,
            broadCandidateFilter: baseFilters,
            warnings,
          },
          summary: {
            returned: results.length,
            candidatesScored: candidates.length,
            exactIdCandidates: exactIdWorkPackages.length,
            fullTextCandidates: fullTextWorkPackages.length,
            broadCandidates: broadWorkPackages.length,
            apiReportedTotal: {
              fullText: fullTextFetch.status === 'fulfilled' ? fullTextFetch.value.total : null,
              broad: broadFetch.status === 'fulfilled' ? broadFetch.value.total : null,
            },
            complete: {
              fullText:
                fullTextFetch.status === 'fulfilled'
                  ? fullTextFetch.value.workPackages.length >= fullTextFetch.value.total
                  : false,
              broad:
                broadFetch.status === 'fulfilled'
                  ? broadFetch.value.workPackages.length >= broadFetch.value.total
                  : false,
            },
            candidateFetch: {
              pageSize: effectivePageSize,
              maxPages: effectiveMaxPages,
              maxCandidates: effectivePageSize * effectiveMaxPages,
            },
          },
          results,
        };

        logger.logToolResult(caller, toolName, true, result);
        return { content: [{ type: 'text', text: formatResponse(result) }] };
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'semantic_search_project_work_packages',
    'Project-scoped in-memory semantic-ish search over recently updated work packages. Use this when a request asks to find related or relevant tickets inside a project. ' +
      'This is the preferred action for project-specific "search", "find", "look for", "related", "similar", or "relevant tickets" requests; never use `list_project_work_packages` for those intents. ' +
      'The tool fetches only the latest updated project work packages into RAM (default/max 500), requests only ID, subject, description, and updatedAt from OpenProject, builds a local TF-IDF vector index over subject + description, then blends vector similarity with keyword/fuzzy relevance. ' +
      'No remote embedding service or persistent vector database is used.',
    {
      projectId: z
        .union([z.number(), z.string()])
        .describe('Project ID, identifier, or NAME (e.g. "Demo Project") to search within'),
      query: z.string().describe('Natural text, keywords, or a phrase to find related/relevant tickets for'),
      statusId: z
        .union([z.number(), z.string()])
        .optional()
        .describe('Optional status ID or status NAME (e.g. "In Progress"). When omitted, open work packages only are indexed unless includeClosed is true'),
      assigneeId: z.number().optional().describe('Optional assignee user ID'),
      includeClosed: z.boolean().optional().describe('Index closed work packages too when statusId is omitted (default: false)'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_WORK_PACKAGE_SEARCH_LIMIT)
        .optional()
        .describe(`Maximum ranked results to return (default 25, max ${MAX_WORK_PACKAGE_SEARCH_LIMIT})`),
      candidateLimit: z
        .number()
        .int()
        .min(1)
        .max(MAX_PROJECT_MEMORY_CANDIDATE_LIMIT)
        .optional()
        .describe(`How many latest-updated project work packages to load into RAM (default/max ${MAX_PROJECT_MEMORY_CANDIDATE_LIMIT})`),
    },
    async ({ projectId, query, statusId, assigneeId, includeClosed, limit, candidateLimit }) => {
      const toolName = 'semantic_search_project_work_packages';
      const caller = `tool:${toolName}`;
      const params = { projectId, query, statusId, assigneeId, includeClosed, limit, candidateLimit };
      logger.logToolInvocation(caller, toolName, params);
      client.setCaller(caller);

      try {
        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
          throw new Error('query must not be empty');
        }

        const resolvedProject = await resolveProjectRef(client, projectId);
        const resolvedStatusId = statusId === undefined ? undefined : await resolveStatusId(client, statusId);
        const effectiveLimit = clampSearchLimit(limit);
        const effectiveCandidateLimit = clampProjectMemoryCandidateLimit(candidateLimit);
        const filters = buildWorkPackageSearchFilters({
          statusId: resolvedStatusId,
          assigneeId,
          includeClosed,
          useFullText: false,
        });

        const { workPackages, total } = await client.listAllWorkPackages({
          projectId: resolvedProject.id,
          filters,
          sortBy: PROJECT_MEMORY_SEARCH_SORT_BY,
          pageSize: effectiveCandidateLimit,
          maxPages: 1,
          select: PROJECT_MEMORY_SEARCH_SELECT,
        });
        const results = rankProjectMemorySearchResults(workPackages, trimmedQuery, {
          limit: effectiveLimit,
        });

        const result = {
          query: trimmedQuery,
          filters: {
            project: { id: resolvedProject.id, name: resolvedProject.name ?? null },
            statusId: resolvedStatusId ?? null,
            statusRef: statusId ?? null,
            assigneeId: assigneeId ?? null,
            openOnly: resolvedStatusId === undefined && includeClosed !== true,
            includeClosed: includeClosed === true,
          },
          search: {
            mode: 'local_ram_tfidf_vector_plus_keyword_fuzzy',
            semantic: 'local lexical vector over subject + description; no embedding API or persistent vector store',
            candidateWindow: 'latest_updated_project_work_packages',
            sortBy: PROJECT_MEMORY_SEARCH_SORT_BY,
            selectedFields: PROJECT_MEMORY_SEARCH_SELECT,
          },
          summary: {
            returned: results.length,
            candidatesIndexed: workPackages.length,
            apiReportedTotal: total,
            complete: workPackages.length >= total,
            candidateLimit: effectiveCandidateLimit,
          },
          results,
        };

        logger.logToolResult(caller, toolName, true, result);
        return { content: [{ type: 'text', text: formatResponse(result) }] };
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'list_work_packages_by_status',
    'List work packages (tasks) by status with summary counts and a paged task list. Pass `statusId` as either a numeric ID or a status NAME string (e.g. "In Progress", "New", "Closed") — names are resolved to IDs automatically, so you do NOT need to call list_statuses first. ' +
      'Optionally scope to a project (`projectId`) and/or an assignee (`assigneeId`). Task listing defaults to page 1 with 100 records per page unless `offset` or `pageSize` is provided. ' +
      'If `statusId` is omitted, only OPEN work packages are summarized and listed by status name (closed tasks are excluded by default; pass a closed status explicitly when needed). ' +
      'NOTE: for requests that group/list tasks BY or PER member (e.g. "In Progress tasks grouped by each member", "... by team members"), prefer the `list_member_tasks` tool — it returns a Project -> Member -> Status -> tasks tree and does the per-member grouping for you. ' +
      'Use this tool for a flat single-status listing, optionally narrowed to one assignee via `assigneeId`.',
    {
      statusId: z.union([z.number(), z.string()]).optional().describe('Status ID or status NAME (e.g. "In Progress", "New"). Resolved automatically when a name is given. Omit to list open work packages grouped by status.'),
      projectId: z.union([z.number(), z.string()]).optional().describe('Optional project ID or identifier to scope the listing to one project'),
      assigneeId: z.number().optional().describe('Optional assignee user ID to return only that member\'s work packages'),
      offset: z.number().optional().describe('Page offset for pagination (defaults to 1)'),
      pageSize: z.number().optional().describe('Number of tasks to list per page (defaults to 100)'),
      sortBy: z.string().optional().describe('Sort criteria as JSON array'),
    },
    async ({ statusId, projectId, assigneeId, offset, pageSize, sortBy }) => {
      const toolName = 'list_work_packages_by_status';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { statusId, projectId, assigneeId, offset, pageSize, sortBy });
      client.setCaller(caller);

      try {
        const resolvedStatusId = statusId === undefined ? undefined : await resolveStatusId(client, statusId);
        const filters = buildStatusWorkPackageFilters({ statusId: resolvedStatusId, assigneeId });
        const effectiveOffset = offset ?? 1;
        const effectivePageSize = pageSize ?? DEFAULT_STATUS_TASK_PAGE_SIZE;

        const page = projectId === undefined
          ? await client.listWorkPackages({ offset: effectiveOffset, pageSize: effectivePageSize, sortBy, filters })
          : await client.listProjectWorkPackages(projectId, { offset: effectiveOffset, pageSize: effectivePageSize, sortBy, filters });

        const workPackages = (page._embedded?.elements ?? page.elements ?? []) as Array<WorkPackage>;
        const tasks = workPackages.map(toStatusTask);
        const pageTotal = page.total ?? workPackages.length;
        const responseOffset = page.offset ?? effectiveOffset;
        const responsePageSize = page.pageSize ?? effectivePageSize;
        const hasMore = tasks.length > 0 && responseOffset * responsePageSize < pageTotal;

        const allForSummary = resolvedStatusId === undefined
          ? await client.listAllWorkPackages({ projectId, filters, sortBy, pageSize: 1000 })
          : undefined;
        const byStatus = resolvedStatusId === undefined
          ? summarizeWorkPackagesByStatus(allForSummary?.workPackages ?? [])
          : [
              {
                statusId: resolvedStatusId,
                status: getStatusLabelForSummary(workPackages, { statusId: resolvedStatusId, statusRef: statusId }),
                count: pageTotal,
              },
            ];
        const groupedResult = {
          filters: {
            statusId: resolvedStatusId ?? null,
            statusRef: statusId ?? null,
            openOnly: resolvedStatusId === undefined,
            projectId: projectId ?? null,
            assigneeId: assigneeId ?? null,
          },
          summary: {
            total: resolvedStatusId === undefined ? allForSummary?.total ?? 0 : pageTotal,
            returned: tasks.length,
            statusCount: byStatus.length,
            byStatus,
            complete: resolvedStatusId !== undefined || (allForSummary?.workPackages.length ?? 0) >= (allForSummary?.total ?? 0),
          },
          pagination: {
            offset: responseOffset,
            pageSize: responsePageSize,
            count: page.count ?? tasks.length,
            returned: tasks.length,
            total: pageTotal,
            hasMore,
          },
          tasks,
          groupedByStatus: groupStatusTasks(tasks),
        };

        const response = { content: [{ type: 'text', text: formatResponse(groupedResult) }] };
        logger.logToolResult(caller, toolName, true, groupedResult);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'list_member_tasks',
    'List tasks of each member as a nested hierarchy: Level 1 Project -> Level 2 Member (assignee) -> Level 3 Status -> Level 4 task list. ' +
      'Every level includes a taskCount, and unassigned tasks are grouped under an "Unassigned" member. ' +
      'USE THIS TOOL whenever a request asks to list / extract / show / break down / organize tasks BY, PER, or FOR EACH member (also phrased "grouped by each member", "by team members", "for every member", "what each person is working on", "tasks each member has") — it does the per-member grouping for you, so prefer it over list_work_packages_by_status and list_work_packages for these requests. ' +
      'Pass `statusId` (NAME or ID) to restrict the tree to a single status. Examples mapping requests to calls: ' +
      '"Extract all tasks currently marked as In Progress group by each member" -> list_member_tasks(statusId="In Progress"); ' +
      '"an easy-to-read list of all tasks that are currently marked as In Progress by team members" -> list_member_tasks(statusId="In Progress"); ' +
      '"what is everyone working on" / "tasks per member" -> list_member_tasks(); ' +
      '"In Progress tasks for Jane in the Demo project" -> list_member_tasks(statusId="In Progress", projectId="Demo Project", userId=<Jane id>). ' +
      'All filters are OPTIONAL; with no explicit `statusId`, it returns the Project -> Member -> Status -> tasks tree for OPEN work packages only (closed tasks are excluded by default; pass a closed status explicitly when needed). ' +
      'Optional filters: `userId` (assignee user ID) narrows to one member; `projectId` accepts a project ID, identifier, OR human name (e.g. "Demo Project"); ' +
      '`statusId` accepts a status ID OR status NAME (e.g. "In Progress") — names are resolved automatically, so you do NOT need to call list_statuses first. ' +
      'The output keeps the same nested shape no matter which filters are applied.',
    {
      userId: z.number().optional().describe('Optional assignee user ID — show only this member\'s tasks'),
      projectId: z
        .union([z.number(), z.string()])
        .optional()
        .describe('Optional project ID, identifier, or NAME (e.g. "Demo Project") to scope to a single project'),
      statusId: z
        .union([z.number(), z.string()])
        .optional()
        .describe('Optional status ID or status NAME (e.g. "In Progress"); a name is resolved to its ID automatically'),
    },
    async ({ userId, projectId, statusId }) => {
      const toolName = 'list_member_tasks';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { userId, projectId, statusId });
      client.setCaller(caller);

      try {
        const resolvedProject = projectId === undefined ? undefined : await resolveProjectRef(client, projectId);
        const resolvedStatusId = statusId === undefined ? undefined : await resolveStatusId(client, statusId);

        const filters = buildMemberTaskFilters({ assigneeId: userId, statusId: resolvedStatusId });
        const { workPackages, total } = await client.listAllWorkPackages({
          projectId: resolvedProject?.id,
          filters,
        });

        const hierarchy = groupWorkPackagesByProjectMemberStatus(workPackages);

        const result = {
          filters: {
            userId: userId ?? null,
            project: resolvedProject ? { id: resolvedProject.id, name: resolvedProject.name ?? null } : null,
            status: resolvedStatusId ?? null,
            openOnly: resolvedStatusId === undefined,
          },
          totalTasks: hierarchy.totalTasks,
          projectCount: hierarchy.projectCount,
          projects: hierarchy.projects,
          validation: {
            apiReportedTotal: total,
            tasksFetched: workPackages.length,
            complete: workPackages.length >= total,
          },
        };

        logger.logToolResult(caller, toolName, true, result);
        return { content: [{ type: 'text', text: formatResponse(result) }] };
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_work_package',
    'Get details of a specific work package',
    {
      id: z.number().describe('Work package ID'),
    },
    async ({ id }) => {
      const toolName = 'get_work_package';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        const result = await client.getWorkPackage(id);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'create_work_package',
    'Create a new work package in a project. Optionally attach files via "attachments": image files are embedded inline in the description, other file types are attached as normal work package files. Each attachment is provided by a local filePath or base64 content.',
    {
      projectId: z.union([z.number(), z.string()]).describe('Project ID or identifier'),
      subject: z.string().describe('Subject/title of the work package'),
      description: descriptionInput.describe('Detailed description (supports markdown)'),
      typeId: z.number().optional().describe('Work package type ID'),
      statusId: z.number().optional().describe('Status ID'),
      priorityId: z.number().optional().describe('Priority ID'),
      assigneeId: z.number().optional().describe('Assignee user ID'),
      responsibleId: z.number().optional().describe('Responsible user ID'),
      versionId: z.number().optional().describe('Version/milestone ID'),
      parentId: z.number().optional().describe('Parent work package ID'),
      startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      dueDate: z.string().optional().describe('Due date (YYYY-MM-DD)'),
      estimatedTime: z.string().optional().describe('Estimated time (ISO 8601 duration, e.g., PT8H)'),
      percentageDone: z.number().min(0).max(100).optional().describe('Completion percentage (0-100)'),
      attachments: z.array(attachmentInputSchema).optional().describe('Files to attach. Images are embedded inline in the description; other file types are attached as regular work package files.'),
      notify: z.boolean().optional().describe('Send notifications (default: true)'),
    },
    async ({ projectId, subject, description, typeId, statusId, priorityId, assigneeId, responsibleId, versionId, parentId, startDate, dueDate, estimatedTime, percentageDone, attachments, notify }) => {
      const toolName = 'create_work_package';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { projectId, subject, description, typeId, statusId, priorityId, assigneeId, responsibleId, versionId, parentId, startDate, dueDate, estimatedTime, percentageDone, attachments: attachments?.length, notify });
      client.setCaller(caller);

      try {
        const _links: NonNullable<Parameters<typeof client.createWorkPackage>[1]['_links']> = {};
        if (typeId) _links.type = { href: createLink('types', typeId) };
        if (statusId) _links.status = { href: createLink('statuses', statusId) };
        if (priorityId) _links.priority = { href: createLink('priorities', priorityId) };
        if (assigneeId) _links.assignee = { href: createLink('users', assigneeId) };
        if (responsibleId) _links.responsible = { href: createLink('users', responsibleId) };
        if (versionId) _links.version = { href: createLink('versions', versionId) };
        if (parentId) _links.parent = { href: createLink('work_packages', parentId) };

        const data: Parameters<typeof client.createWorkPackage>[1] = {
          subject,
          _links: Object.keys(_links).length > 0 ? _links : undefined,
          startDate,
          dueDate,
          estimatedTime,
          percentageDone,
        };
        if (description) data.description = { raw: description };

        let result = await client.createWorkPackage(projectId, data, notify);

        let attachmentResults: UploadedAttachmentResult[] | undefined;
        if (attachments && attachments.length > 0) {
          const baseDescription = result.description?.raw ?? description ?? '';
          const { results, workPackage } = await attachToWorkPackage(client, result.id, result.lockVersion, baseDescription, attachments, notify);
          attachmentResults = results;
          if (workPackage) result = workPackage;
        }

        const payload = attachmentResults ? { workPackage: result, attachments: attachmentResults } : result;
        const response = { content: [{ type: 'text', text: formatResponse(payload) }] };
        logger.logToolResult(caller, toolName, true, payload);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'update_work_package',
    'Update an existing work package. The current lockVersion is fetched automatically when omitted (preferred); a stale lockVersion (UpdateConflict) is automatically refetched and the update retried once. Pass only the fields you want to change. Optionally add files via "attachments": image files are embedded inline in the description, other file types are attached as normal work package files. Each attachment is provided by a local filePath or base64 content.',
    {
      id: z.number().describe('Work package ID'),
      lockVersion: z.number().optional().describe('Current lock version (for optimistic locking). Fetched automatically when omitted; a stale version is refetched and the update retried once.'),
      subject: z.string().optional().describe('New subject/title'),
      description: descriptionInput.describe('New description (plain text/markdown string)'),
      typeId: z.number().optional().describe('New type ID'),
      statusId: z.number().optional().describe('New status ID'),
      priorityId: z.number().optional().describe('New priority ID'),
      assigneeId: z.number().optional().describe('New assignee user ID'),
      responsibleId: z.number().optional().describe('New responsible user ID'),
      versionId: z.number().optional().describe('New version ID'),
      parentId: z.number().optional().describe('New parent work package ID'),
      startDate: z.string().optional().describe('New start date (YYYY-MM-DD)'),
      dueDate: z.string().optional().describe('New due date (YYYY-MM-DD)'),
      estimatedTime: z.string().optional().describe('New estimated time'),
      percentageDone: z.number().min(0).max(100).optional().describe('New completion percentage'),
      attachments: z.array(attachmentInputSchema).optional().describe('Files to attach. Images are embedded inline in the description; other file types are attached as regular work package files.'),
      notify: z.boolean().optional().describe('Send notifications'),
    },
    async ({ id, lockVersion, subject, description, typeId, statusId, priorityId, assigneeId, responsibleId, versionId, parentId, startDate, dueDate, estimatedTime, percentageDone, attachments, notify }) => {
      const toolName = 'update_work_package';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id, lockVersion, subject, description, typeId, statusId, priorityId, assigneeId, responsibleId, versionId, parentId, startDate, dueDate, estimatedTime, percentageDone, attachments: attachments?.length, notify });
      client.setCaller(caller);

      try {
        const changes: WorkPackageChanges = {
          subject,
          description,
          typeId,
          statusId,
          priorityId,
          assigneeId,
          responsibleId,
          versionId,
          parentId,
          startDate,
          dueDate,
          estimatedTime,
          percentageDone,
        };

        // Apply field changes first (when any were given), otherwise read the
        // current work package so attachments have a fresh lockVersion and
        // description to extend with inline images.
        let result: WorkPackage;
        if (listChangedFields(changes).length > 0) {
          result = (await updateWithLockRetry(client, { id, lockVersion }, changes, notify)).workPackage;
        } else if (attachments && attachments.length > 0) {
          result = await client.getWorkPackage(id);
        } else {
          // No changes and no attachments: preserve prior behavior (a no-op PATCH).
          result = (await updateWithLockRetry(client, { id, lockVersion }, changes, notify)).workPackage;
        }

        let attachmentResults: UploadedAttachmentResult[] | undefined;
        if (attachments && attachments.length > 0) {
          const baseDescription = result.description?.raw ?? '';
          const { results, workPackage } = await attachToWorkPackage(client, id, result.lockVersion, baseDescription, attachments, notify);
          attachmentResults = results;
          if (workPackage) result = workPackage;
        }

        const payload = attachmentResults ? { workPackage: result, attachments: attachmentResults } : result;
        const response = { content: [{ type: 'text', text: formatResponse(payload) }] };
        logger.logToolResult(caller, toolName, true, payload);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  const bulkChangeShape = {
    subject: z.string().optional().describe('New subject/title'),
    description: descriptionInput.describe('New description (supports markdown)'),
    typeId: z.number().optional().describe('New type ID'),
    statusId: z.number().optional().describe('New status ID'),
    priorityId: z.number().optional().describe('New priority ID'),
    assigneeId: z.number().optional().describe('New assignee user ID'),
    responsibleId: z.number().optional().describe('New responsible user ID'),
    versionId: z.number().optional().describe('New version/milestone ID'),
    parentId: z.number().optional().describe('New parent work package ID'),
    startDate: z.string().optional().describe('New start date (YYYY-MM-DD)'),
    dueDate: z.string().optional().describe('New due date (YYYY-MM-DD)'),
    estimatedTime: z.string().optional().describe('New estimated time (ISO 8601 duration, e.g., PT8H)'),
    percentageDone: z.number().min(0).max(100).optional().describe('New completion percentage (0-100)'),
  };

  server.tool(
    'bulk_update_work_packages',
    'Update multiple work packages in one call. Put shared changes in "defaults" (applied to every work package) and/or set fields per item in "updates" (per-item values override defaults). Each work package\'s current lockVersion is fetched automatically when not provided; prefer omitting lockVersion so the freshest value is used. A stale lockVersion (UpdateConflict) is automatically refetched and the update retried once. Updates run sequentially and the response reports the outcome of every item (updated/failed/skipped, with "retried" flagged when a conflict was recovered); the call is marked as an error if ANY item fails, so partial failures are never mistaken for full success',
    {
      updates: z
        .array(
          z.object({
            id: z.number().describe('Work package ID'),
            lockVersion: z.number().optional().describe('Known lock version (fetched automatically when omitted)'),
            ...bulkChangeShape,
          })
        )
        .min(1)
        .max(100)
        .describe('Work packages to update (1-100). Items only need "id" when "defaults" carries the changes'),
      defaults: z.object(bulkChangeShape).optional().describe('Shared changes applied to every work package unless overridden per item'),
      notify: z.boolean().optional().describe('Send notifications for each update (default: true)'),
      stopOnError: z.boolean().optional().describe('Stop at the first failure and skip the remaining work packages (default: false — continue and report per-item results)'),
    },
    async ({ updates, defaults, notify, stopOnError }) => {
      const toolName = 'bulk_update_work_packages';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { updates, defaults, notify, stopOnError });
      client.setCaller(caller);

      try {
        const result = await executeBulkWorkPackageUpdate(client, { updates, defaults, notify, stopOnError });
        // Surface ANY per-item failure (not only an all-failed batch) so partial
        // failures — e.g. a work package left unchanged by a lock conflict — are
        // not mistaken for full success.
        const hasFailures = result.summary.failed > 0;
        logger.logToolResult(caller, toolName, !hasFailures, result);
        if (hasFailures) {
          return { content: [{ type: 'text', text: formatResponse(result) }], isError: true };
        }
        return { content: [{ type: 'text', text: formatResponse(result) }] };
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'delete_work_package',
    'Delete a work package',
    {
      id: z.number().describe('Work package ID'),
    },
    async ({ id }) => {
      const toolName = 'delete_work_package';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        await client.deleteWorkPackage(id);
        return { content: [{ type: 'text', text: `Work package ${id} deleted successfully` }] };
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'list_work_package_activities',
    'List activities/journal entries for a work package',
    {
      id: z.number().describe('Work package ID'),
    },
    async ({ id }) => {
      const toolName = 'list_work_package_activities';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        const result = await client.listWorkPackageActivities(id);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ============== Attachment Tools ==============

  server.tool(
    'list_work_package_attachments',
    'List the files attached to a work package',
    {
      id: z.number().describe('Work package ID'),
    },
    async ({ id }) => {
      const toolName = 'list_work_package_attachments';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        const result = await client.listWorkPackageAttachments(id);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'delete_attachment',
    'Delete an attachment by its ID',
    {
      id: z.number().describe('Attachment ID'),
    },
    async ({ id }) => {
      const toolName = 'delete_attachment';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        await client.deleteAttachment(id);
        return { content: [{ type: 'text', text: `Attachment ${id} deleted successfully` }] };
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ============== User Tools ==============

  server.tool(
    'list_users',
    'List all users (administrator only)',
    {
      offset: z.number().optional().describe('Page offset for pagination'),
      pageSize: z.number().optional().describe('Number of items per page'),
      filters: z.string().optional().describe('JSON filter expression'),
      sortBy: z.string().optional().describe('Sort criteria as JSON array'),
    },
    async (params) => {
      const toolName = 'list_users';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, params);
      client.setCaller(caller);

      try {
        const currentUser = await client.getCurrentUser();
        if (!currentUser.admin) {
          return {
            content: [{ type: 'text', text: 'Error: list_users requires administrator privileges' }],
            isError: true,
          };
        }

        const result = await client.listUsers(params);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_user',
    'Get details of a specific user',
    {
      id: z.union([z.number(), z.string()]).describe('User ID or "me" for current user'),
    },
    async ({ id }) => {
      const toolName = 'get_user';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        const result = id === 'me' ? await client.getCurrentUser() : await client.getUser(id);
        return { content: [{ type: 'text', text: formatResponse(result) }] };
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_current_user',
    'Get the currently authenticated user',
    {},
    async () => {
      const toolName = 'get_current_user';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, {});
      client.setCaller(caller);

      try {
        const result = await client.getCurrentUser();
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'create_user',
    'Create a new user (admin only)',
    {
      login: z.string().describe('Login username'),
      email: z.string().email().describe('Email address'),
      firstName: z.string().describe('First name'),
      lastName: z.string().describe('Last name'),
      admin: z.boolean().optional().describe('Whether user is admin'),
      language: z.string().optional().describe('Preferred language'),
      password: z.string().optional().describe('Initial password'),
    },
    async (params) => {
      const toolName = 'create_user';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, params);
      client.setCaller(caller);

      try {
        const result = await client.createUser(params);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'update_user',
    'Update an existing user',
    {
      id: z.number().describe('User ID'),
      login: z.string().optional().describe('New login username'),
      email: z.string().email().optional().describe('New email address'),
      firstName: z.string().optional().describe('New first name'),
      lastName: z.string().optional().describe('New last name'),
      admin: z.boolean().optional().describe('Admin status'),
      language: z.string().optional().describe('Preferred language'),
    },
    async ({ id, ...data }) => {
      const toolName = 'update_user';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id, ...data });
      client.setCaller(caller);

      try {
        const result = await client.updateUser(id, data);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'delete_user',
    'Delete a user (admin only)',
    {
      id: z.number().describe('User ID'),
    },
    async ({ id }) => {
      const toolName = 'delete_user';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        await client.deleteUser(id);
        return { content: [{ type: 'text', text: `User ${id} deleted successfully` }] };
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'lock_user',
    'Lock a user account',
    {
      id: z.number().describe('User ID'),
    },
    async ({ id }) => {
      const toolName = 'lock_user';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        const result = await client.lockUser(id);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'unlock_user',
    'Unlock a user account',
    {
      id: z.number().describe('User ID'),
    },
    async ({ id }) => {
      const toolName = 'unlock_user';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        const result = await client.unlockUser(id);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ============== Membership Tools ==============

  server.tool(
    'list_memberships',
    'List project memberships (users/groups assigned to projects)',
    {
      offset: z.number().optional().describe('Page offset for pagination'),
      pageSize: z.number().optional().describe('Number of items per page'),
      filters: z.string().optional().describe('JSON filter expression'),
      sortBy: z.string().optional().describe('Sort criteria as JSON array'),
    },
    async (params) => {
      const toolName = 'list_memberships';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, params);
      client.setCaller(caller);

      try {
        const result = await client.listMemberships(params);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'list_project_members',
    'List members who belong to a specific project',
    {
      projectId: z.union([z.number(), z.string()]).describe('Project ID or identifier'),
      offset: z.number().optional().describe('Page offset for pagination'),
      pageSize: z.number().optional().describe('Number of items per page'),
    },
    async ({ projectId, offset, pageSize }) => {
      const toolName = 'list_project_members';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { projectId, offset, pageSize });
      client.setCaller(caller);

      try {
        const resolvedProjectId = await resolveProjectId(client, projectId);
        const filters = buildProjectMembershipFilter(resolvedProjectId);
        const result = await client.listMemberships({ offset, pageSize, filters });
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'list_work_package_members',
    'List members of the project that owns a work package',
    {
      workPackageId: z.number().describe('Work package ID'),
      offset: z.number().optional().describe('Page offset for pagination'),
      pageSize: z.number().optional().describe('Number of items per page'),
    },
    async ({ workPackageId, offset, pageSize }) => {
      const toolName = 'list_work_package_members';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { workPackageId, offset, pageSize });
      client.setCaller(caller);

      try {
        const workPackage = await client.getWorkPackage(workPackageId);
        const projectHref = workPackage._links?.project?.href;
        if (!projectHref) {
          throw new Error(`Work package ${workPackageId} does not reference a project.`);
        }

        const projectId = extractResourceId(projectHref, 'projects');
        if (projectId === null) {
          throw new Error(`Unable to extract project ID from link: ${projectHref}`);
        }

        const filters = buildProjectMembershipFilter(projectId);
        const memberships = await client.listMemberships({ offset, pageSize, filters });
        const response = {
          workPackageId,
          projectId,
          projectHref,
          memberships,
        };
        return { content: [{ type: 'text', text: formatResponse(response) }] };
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ============== Type Tools ==============

  server.tool(
    'list_types',
    'List all work package types',
    {},
    async () => {
      const toolName = 'list_types';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, {});
      client.setCaller(caller);

      try {
        const result = await client.listTypes();
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_type',
    'Get details of a specific work package type',
    {
      id: z.number().describe('Type ID'),
    },
    async ({ id }) => {
      const toolName = 'get_type';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        const result = await client.getType(id);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'list_project_types',
    'List types available in a specific project',
    {
      projectId: z.union([z.number(), z.string()]).describe('Project ID or identifier'),
    },
    async ({ projectId }) => {
      const toolName = 'list_project_types';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { projectId });
      client.setCaller(caller);

      try {
        const result = await client.listProjectTypes(projectId);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ============== Status Tools ==============

  server.tool(
    'list_statuses',
    'List all work package statuses with their IDs and names (e.g. "New", "In Progress", "Closed"). ' +
      'Call this FIRST only when you must pass a numeric status ID to a tool that does NOT resolve names — i.e. a raw `status` filter on list_work_packages / list_project_work_packages: ' +
      '(1) call list_statuses to find the ID of "In Progress", (2) pass that ID in the status filter. ' +
      'You do NOT need this for list_member_tasks or list_work_packages_by_status — both accept a status NAME directly and resolve it for you. ' +
      'For "In Progress tasks grouped/listed per member (or by team members)", skip this and call list_member_tasks(statusId="In Progress").',
    {},
    async () => {
      const toolName = 'list_statuses';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, {});
      client.setCaller(caller);

      try {
        const result = await client.listStatuses();
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_status',
    'Get details of a specific status',
    {
      id: z.number().describe('Status ID'),
    },
    async ({ id }) => {
      const toolName = 'get_status';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        const result = await client.getStatus(id);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ============== Priority Tools ==============

  server.tool(
    'list_priorities',
    'List all priorities',
    {},
    async () => {
      const toolName = 'list_priorities';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, {});
      client.setCaller(caller);

      try {
        const result = await client.listPriorities();
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_priority',
    'Get details of a specific priority',
    {
      id: z.number().describe('Priority ID'),
    },
    async ({ id }) => {
      const toolName = 'get_priority';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        const result = await client.getPriority(id);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ============== Time Entry Tools ==============

  server.tool(
    'list_time_entries',
    'List all time entries',
    {
      offset: z.number().optional().describe('Page offset for pagination'),
      pageSize: z.number().optional().describe('Number of items per page'),
      filters: z.string().optional().describe('JSON filter expression'),
      sortBy: z.string().optional().describe('Sort criteria as JSON array'),
    },
    async (params) => {
      const toolName = 'list_time_entries';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, params);
      client.setCaller(caller);

      try {
        const result = await client.listTimeEntries(params);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_time_entry',
    'Get details of a specific time entry',
    {
      id: z.number().describe('Time entry ID'),
    },
    async ({ id }) => {
      const toolName = 'get_time_entry';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        const result = await client.getTimeEntry(id);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'create_time_entry',
    'Create a new time entry',
    {
      projectId: z.number().describe('Project ID'),
      workPackageId: z.number().optional().describe('Work package ID'),
      activityId: z.number().describe('Activity ID'),
      hours: z.string().describe('Hours spent (ISO 8601 duration, e.g., PT8H30M)'),
      spentOn: z.string().describe('Date spent on (YYYY-MM-DD)'),
      comment: z.string().optional().describe('Comment for the time entry'),
    },
    async ({ projectId, workPackageId, activityId, hours, spentOn, comment }) => {
      const toolName = 'create_time_entry';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { projectId, workPackageId, activityId, hours, spentOn, comment });
      client.setCaller(caller);

      try {
        const data: Parameters<typeof client.createTimeEntry>[0] = {
          _links: {
            project: { href: createLink('projects', projectId) },
            activity: { href: createLink('time_entries/activities', activityId) },
          },
          hours,
          spentOn,
        };
        if (workPackageId) data._links.workPackage = { href: createLink('work_packages', workPackageId) };
        if (comment) data.comment = { raw: comment };

        const result = await client.createTimeEntry(data);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'update_time_entry',
    'Update an existing time entry',
    {
      id: z.number().describe('Time entry ID'),
      activityId: z.number().optional().describe('New activity ID'),
      hours: z.string().optional().describe('New hours'),
      spentOn: z.string().optional().describe('New date'),
      comment: z.string().optional().describe('New comment'),
    },
    async ({ id, activityId, hours, spentOn, comment }) => {
      const toolName = 'update_time_entry';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id, activityId, hours, spentOn, comment });
      client.setCaller(caller);

      try {
        const data: Parameters<typeof client.updateTimeEntry>[1] = {
          hours,
          spentOn,
        };
        if (activityId) data._links = { activity: { href: createLink('time_entries/activities', activityId) } };
        if (comment !== undefined) data.comment = { raw: comment };

        const result = await client.updateTimeEntry(id, data);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'delete_time_entry',
    'Delete a time entry',
    {
      id: z.number().describe('Time entry ID'),
    },
    async ({ id }) => {
      const toolName = 'delete_time_entry';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        await client.deleteTimeEntry(id);
        return { content: [{ type: 'text', text: `Time entry ${id} deleted successfully` }] };
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_timesheet_total',
    'Get timesheet totals (logged hours) for a specific user or the whole team over a time range. Accepts a named period (today, yesterday, this_week, last_week, this_month, last_month; weeks start on Monday, local timezone) or an exact startDate/endDate range. Fetches all matching time entries across pages and returns total entries/hours plus per-user, per-project and per-date breakdowns with hours as decimal numbers (e.g. PT7H30M = 7.5)',
    {
      user: z.union([z.number(), z.string()]).optional().describe('User ID, "me" for the authenticated user, or a (partial) user name to look up. Omit to include all users (team totals)'),
      period: z.enum(TIMESHEET_PERIOD_PRESETS).optional().describe('Named time range relative to today. Use either this or startDate+endDate'),
      startDate: z.string().optional().describe('Range start date (YYYY-MM-DD, inclusive); required together with endDate when period is not set'),
      endDate: z.string().optional().describe('Range end date (YYYY-MM-DD, inclusive); required together with startDate when period is not set'),
      projectId: z.union([z.number(), z.string()]).optional().describe('Optional project ID or identifier to limit the timesheet to one project'),
      includeEntries: z.boolean().optional().describe('Include the normalized raw time entries in the response (default: false)'),
    },
    async ({ user, period, startDate, endDate, projectId, includeEntries }) => {
      const toolName = 'get_timesheet_total';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { user, period, startDate, endDate, projectId, includeEntries });
      client.setCaller(caller);

      try {
        const resolvedPeriod = resolvePeriod({ period, startDate, endDate });
        const resolvedUser = user === undefined ? undefined : await resolveTimesheetUser(client, user);
        const resolvedProjectId = projectId === undefined ? undefined : await resolveProjectId(client, projectId);

        const filters = buildTimeEntryFilters({
          startDate: resolvedPeriod.startDate,
          endDate: resolvedPeriod.endDate,
          userId: resolvedUser?.id,
          projectId: resolvedProjectId,
        });

        const { entries, total } = await client.listAllTimeEntries({ filters });
        const aggregation = aggregateTimeEntries(entries);

        const result = {
          period: resolvedPeriod,
          user: resolvedUser ?? 'all',
          projectId: resolvedProjectId,
          totals: aggregation.totals,
          byUser: aggregation.byUser,
          byProject: aggregation.byProject,
          byDate: aggregation.byDate,
          validation: {
            apiReportedTotal: total,
            entriesFetched: entries.length,
            complete: entries.length >= total,
          },
          warnings: aggregation.warnings.length > 0 ? aggregation.warnings : undefined,
          entries: includeEntries ? aggregation.entries : undefined,
        };

        logger.logToolResult(caller, toolName, true, result);
        return { content: [{ type: 'text', text: formatResponse(result) }] };
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ============== Version Tools ==============

  server.tool(
    'list_versions',
    'List all versions/milestones',
    {
      offset: z.number().optional().describe('Page offset for pagination'),
      pageSize: z.number().optional().describe('Number of items per page'),
      filters: z.string().optional().describe('JSON filter expression'),
    },
    async (params) => {
      const toolName = 'list_versions';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, params);
      client.setCaller(caller);

      try {
        const result = await client.listVersions(params);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_version',
    'Get details of a specific version',
    {
      id: z.number().describe('Version ID'),
    },
    async ({ id }) => {
      const toolName = 'get_version';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        const result = await client.getVersion(id);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'list_project_versions',
    'List versions in a specific project',
    {
      projectId: z.union([z.number(), z.string()]).describe('Project ID or identifier'),
    },
    async ({ projectId }) => {
      const toolName = 'list_project_versions';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { projectId });
      client.setCaller(caller);

      try {
        const result = await client.listProjectVersions(projectId);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'create_version',
    'Create a new version/milestone',
    {
      name: z.string().describe('Version name'),
      projectId: z.number().describe('Defining project ID'),
      description: descriptionInput.describe('Version description'),
      startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
      status: z.enum(['open', 'locked', 'closed']).optional().describe('Version status'),
      sharing: z.enum(['none', 'descendants', 'hierarchy', 'tree', 'system']).optional().describe('Sharing scope'),
    },
    async ({ name, projectId, description, startDate, endDate, status, sharing }) => {
      const toolName = 'create_version';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { name, projectId, description, startDate, endDate, status, sharing });
      client.setCaller(caller);

      try {
        const data: Parameters<typeof client.createVersion>[0] = {
          name,
          _links: {
            definingProject: { href: createLink('projects', projectId) },
          },
          startDate,
          endDate,
          status,
          sharing,
        };
        if (description) data.description = { raw: description };

        const result = await client.createVersion(data);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'update_version',
    'Update an existing version',
    {
      id: z.number().describe('Version ID'),
      name: z.string().optional().describe('New version name'),
      description: descriptionInput.describe('New description'),
      startDate: z.string().optional().describe('New start date'),
      endDate: z.string().optional().describe('New end date'),
      status: z.enum(['open', 'locked', 'closed']).optional().describe('New status'),
      sharing: z.enum(['none', 'descendants', 'hierarchy', 'tree', 'system']).optional().describe('New sharing scope'),
    },
    async ({ id, name, description, startDate, endDate, status, sharing }) => {
      const toolName = 'update_version';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id, name, description, startDate, endDate, status, sharing });
      client.setCaller(caller);

      try {
        const data: Parameters<typeof client.updateVersion>[1] = {
          name,
          startDate,
          endDate,
          status,
          sharing,
        };
        if (description !== undefined) data.description = { raw: description };

        const result = await client.updateVersion(id, data);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    'delete_version',
    'Delete a version',
    {
      id: z.number().describe('Version ID'),
    },
    async ({ id }) => {
      const toolName = 'delete_version';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        await client.deleteVersion(id);
        return { content: [{ type: 'text', text: `Version ${id} deleted successfully` }] };
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ============== Activity Tools ==============

  server.tool(
    'get_activity',
    'Get details of a specific activity/journal entry',
    {
      id: z.number().describe('Activity ID'),
    },
    async ({ id }) => {
      const toolName = 'get_activity';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, { id });
      client.setCaller(caller);

      try {
        const result = await client.getActivity(id);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  // ============== Principal Tools ==============

  server.tool(
    'list_principals',
    'List all principals (users, groups, placeholder users)',
    {
      offset: z.number().optional().describe('Page offset for pagination'),
      pageSize: z.number().optional().describe('Number of items per page'),
      filters: z.string().optional().describe('JSON filter expression'),
    },
    async (params) => {
      const toolName = 'list_principals';
      const caller = `tool:${toolName}`;
      logger.logToolInvocation(caller, toolName, params);
      client.setCaller(caller);

      try {
        const result = await client.listPrincipals(params);
        const response = { content: [{ type: 'text', text: formatResponse(result) }] };
        logger.logToolResult(caller, toolName, true, result);
        return response;
      } catch (error) {
        logger.logToolResult(caller, toolName, false, undefined, error as Error);
        return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  return { server, initClient };
}
