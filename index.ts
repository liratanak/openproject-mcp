#!/usr/bin/env bun
/**
 * OpenProject MCP Server
 * A Model Context Protocol server for OpenProject integration
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createClient, type OpenProjectClient } from './src/openproject-client.ts';

// Initialize the MCP server
const server = new McpServer({
  name: 'openproject-mcp',
  version: '1.0.0',
});

let client: OpenProjectClient;

// Helper to safely stringify responses
function formatResponse(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// Helper to create API links
function createLink(type: string, id: number | string): string {
  return `/api/v3/${type}/${id}`;
}

// ============== Root & Configuration Tools ==============

server.tool(
  'get_api_root',
  'Get the OpenProject API root information',
  {},
  async () => {
    try {
      const result = await client.getRoot();
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'get_configuration',
  'Get the OpenProject instance configuration',
  {},
  async () => {
    try {
      const result = await client.getConfiguration();
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = await client.listProjects(params);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = await client.getProject(id);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    description: z.string().optional().describe('Project description'),
    public: z.boolean().optional().describe('Whether the project is public (default: false)'),
    status: z.enum(['on_track', 'at_risk', 'off_track', 'not_set']).optional().describe('Project status'),
    statusExplanation: z.string().optional().describe('Explanation for the project status'),
    parentId: z.number().optional().describe('Parent project ID'),
  },
  async ({ name, identifier, description, public: isPublic, status, statusExplanation, parentId }) => {
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
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    description: z.string().optional().describe('New project description'),
    public: z.boolean().optional().describe('Whether the project is public'),
    active: z.boolean().optional().describe('Whether the project is active'),
    status: z.enum(['on_track', 'at_risk', 'off_track', 'not_set']).optional().describe('Project status'),
    statusExplanation: z.string().optional().describe('Explanation for the project status'),
  },
  async ({ id, name, description, public: isPublic, active, status, statusExplanation }) => {
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
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      await client.deleteProject(id);
      return { content: [{ type: 'text', text: `Project ${id} deleted successfully` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// ============== Work Package Tools ==============

server.tool(
  'list_work_packages',
  'List all work packages with optional filtering',
  {
    offset: z.number().optional().describe('Page offset for pagination'),
    pageSize: z.number().optional().describe('Number of items per page'),
    filters: z.string().optional().describe('JSON filter expression'),
    sortBy: z.string().optional().describe('Sort criteria as JSON array'),
    groupBy: z.string().optional().describe('Group by attribute'),
  },
  async (params) => {
    try {
      const result = await client.listWorkPackages(params);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'list_project_work_packages',
  'List work packages in a specific project',
  {
    projectId: z.union([z.number(), z.string()]).describe('Project ID or identifier'),
    offset: z.number().optional().describe('Page offset for pagination'),
    pageSize: z.number().optional().describe('Number of items per page'),
    filters: z.string().optional().describe('JSON filter expression'),
    sortBy: z.string().optional().describe('Sort criteria as JSON array'),
  },
  async ({ projectId, ...params }) => {
    try {
      const result = await client.listProjectWorkPackages(projectId, params);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = await client.getWorkPackage(id);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'create_work_package',
  'Create a new work package in a project',
  {
    projectId: z.union([z.number(), z.string()]).describe('Project ID or identifier'),
    subject: z.string().describe('Subject/title of the work package'),
    description: z.string().optional().describe('Detailed description (supports markdown)'),
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
    notify: z.boolean().optional().describe('Send notifications (default: true)'),
  },
  async ({ projectId, subject, description, typeId, statusId, priorityId, assigneeId, responsibleId, versionId, parentId, startDate, dueDate, estimatedTime, percentageDone, notify }) => {
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

      const result = await client.createWorkPackage(projectId, data, notify);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'update_work_package',
  'Update an existing work package',
  {
    id: z.number().describe('Work package ID'),
    lockVersion: z.number().describe('Current lock version (for optimistic locking)'),
    subject: z.string().optional().describe('New subject/title'),
    description: z.string().optional().describe('New description'),
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
    notify: z.boolean().optional().describe('Send notifications'),
  },
  async ({ id, lockVersion, subject, description, typeId, statusId, priorityId, assigneeId, responsibleId, versionId, parentId, startDate, dueDate, estimatedTime, percentageDone, notify }) => {
    try {
      const _links: NonNullable<Parameters<typeof client.updateWorkPackage>[1]['_links']> = {};
      if (typeId) _links.type = { href: createLink('types', typeId) };
      if (statusId) _links.status = { href: createLink('statuses', statusId) };
      if (priorityId) _links.priority = { href: createLink('priorities', priorityId) };
      if (assigneeId) _links.assignee = { href: createLink('users', assigneeId) };
      if (responsibleId) _links.responsible = { href: createLink('users', responsibleId) };
      if (versionId) _links.version = { href: createLink('versions', versionId) };
      if (parentId) _links.parent = { href: createLink('work_packages', parentId) };

      const data: Parameters<typeof client.updateWorkPackage>[1] = {
        lockVersion,
        subject,
        _links: Object.keys(_links).length > 0 ? _links : undefined,
        startDate,
        dueDate,
        estimatedTime,
        percentageDone,
      };
      if (description !== undefined) data.description = { raw: description };

      const result = await client.updateWorkPackage(id, data, notify);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      await client.deleteWorkPackage(id);
      return { content: [{ type: 'text', text: `Work package ${id} deleted successfully` }] };
    } catch (error) {
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
    try {
      const result = await client.listWorkPackageActivities(id);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// ============== User Tools ==============

server.tool(
  'list_users',
  'List all users',
  {
    offset: z.number().optional().describe('Page offset for pagination'),
    pageSize: z.number().optional().describe('Number of items per page'),
    filters: z.string().optional().describe('JSON filter expression'),
    sortBy: z.string().optional().describe('Sort criteria as JSON array'),
  },
  async (params) => {
    try {
      const result = await client.listUsers(params);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = id === 'me' ? await client.getCurrentUser() : await client.getUser(id);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  'get_current_user',
  'Get the currently authenticated user',
  {},
  async () => {
    try {
      const result = await client.getCurrentUser();
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = await client.createUser(params);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = await client.updateUser(id, data);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      await client.deleteUser(id);
      return { content: [{ type: 'text', text: `User ${id} deleted successfully` }] };
    } catch (error) {
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
    try {
      const result = await client.lockUser(id);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = await client.unlockUser(id);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = await client.listTypes();
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = await client.getType(id);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = await client.listProjectTypes(projectId);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// ============== Status Tools ==============

server.tool(
  'list_statuses',
  'List all work package statuses',
  {},
  async () => {
    try {
      const result = await client.listStatuses();
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = await client.getStatus(id);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = await client.listPriorities();
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = await client.getPriority(id);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = await client.listTimeEntries(params);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = await client.getTimeEntry(id);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const data: Parameters<typeof client.updateTimeEntry>[1] = {
        hours,
        spentOn,
      };
      if (activityId) data._links = { activity: { href: createLink('time_entries/activities', activityId) } };
      if (comment !== undefined) data.comment = { raw: comment };

      const result = await client.updateTimeEntry(id, data);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      await client.deleteTimeEntry(id);
      return { content: [{ type: 'text', text: `Time entry ${id} deleted successfully` }] };
    } catch (error) {
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
    try {
      const result = await client.listVersions(params);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = await client.getVersion(id);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = await client.listProjectVersions(projectId);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    description: z.string().optional().describe('Version description'),
    startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
    status: z.enum(['open', 'locked', 'closed']).optional().describe('Version status'),
    sharing: z.enum(['none', 'descendants', 'hierarchy', 'tree', 'system']).optional().describe('Sharing scope'),
  },
  async ({ name, projectId, description, startDate, endDate, status, sharing }) => {
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
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    description: z.string().optional().describe('New description'),
    startDate: z.string().optional().describe('New start date'),
    endDate: z.string().optional().describe('New end date'),
    status: z.enum(['open', 'locked', 'closed']).optional().describe('New status'),
    sharing: z.enum(['none', 'descendants', 'hierarchy', 'tree', 'system']).optional().describe('New sharing scope'),
  },
  async ({ id, name, description, startDate, endDate, status, sharing }) => {
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
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      await client.deleteVersion(id);
      return { content: [{ type: 'text', text: `Version ${id} deleted successfully` }] };
    } catch (error) {
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
    try {
      const result = await client.getActivity(id);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
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
    try {
      const result = await client.listPrincipals(params);
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// ============== Main Entry Point ==============

async function main() {
  try {
    // Initialize the OpenProject client
    client = createClient();
    
    // Test connection by getting current user
    console.error('Testing OpenProject connection...');
    const user = await client.getCurrentUser();
    console.error(`Connected as: ${user.name} (${user.login})`);
    
    // Connect to MCP transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.error('OpenProject MCP Server running on stdio');
  } catch (error) {
    console.error('Failed to start MCP server:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
