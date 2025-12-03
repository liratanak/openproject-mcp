# Tonle OpenProject MCP Server Architecture

This document describes the architecture and detailed behaviour of the Tonle OpenProject MCP server.

## Goals

- Expose the full OpenProject API v3 as MCP tools.
- Provide a simple, predictable tool schema for AI assistants.
- Support both local (stdio) and remote (HTTP) transports.
- Be production-ready and easy to extend.

## High-level architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    MCP-Compatible Clients                    │
│         (Claude Desktop, Cursor, Windsurf, etc.)            │
└─────────────────────────────────────────────────────────────┘
                             │
                             │ MCP Protocol (JSON-RPC 2.0)
                             │
┌─────────────────────────────────────────────────────────────┐
│                  OpenProject MCP Server                      │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                    Transport Layer                       ││
│  │         (Stdio / Streamable HTTP / WebSocket)           ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   MCP Server Core                        ││
│  │    (@modelcontextprotocol/sdk TypeScript SDK)           ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   Tool Registry                          ││
│  │      (Tool definitions, schemas, handlers)              ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │                Resource Provider                         ││
│  │   (Dynamic data exposure for projects, users, etc.)     ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │               OpenProject API Client                     ││
│  │        (HAL+JSON API v3 communication layer)            ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                             │
                             │ HTTPS (HAL+JSON)
                             │
┌─────────────────────────────────────────────────────────────┐
│                   OpenProject Instance                       │
│                      (API v3 Endpoints)                      │
└─────────────────────────────────────────────────────────────┘
```

## Core technologies

| Component      | Technology                      | Purpose                                  |
|---------------|----------------------------------|------------------------------------------|
| Runtime       | Bun                              | Server execution environment             |
| Language      | TypeScript 5.x                  | Type-safe development                    |
| MCP SDK       | `@modelcontextprotocol/sdk`     | MCP protocol implementation              |
| Validation    | Zod                             | Runtime schema validation                |
| HTTP Client   | Axios/Fetch                     | OpenProject API communication            |
| Testing       | Vitest                          | Unit and integration testing             |
| Documentation | TypeDoc                         | API documentation generation             |

## Transports

### Stdio (default)

- Used by desktop/CLI clients that spawn the server as a subprocess.
- Command: `bun run index.ts`
- Environment: `OPENPROJECT_URL`, `OPENPROJECT_API_KEY`, optional `OPENPROJECT_TIMEOUT`.

### HTTP / Streamable HTTP

- Optional HTTP server to expose MCP over HTTP/SSE for remote clients.
- Typical start command:

```bash
# default port 3100
bun run start:http

# custom port
MCP_HTTP_PORT=8080 bun run start:http
```

- Exposes `/mcp` (JSON-RPC over HTTP + SSE) and `/health`.

## MCP implementation model

### Tools

Each OpenProject API operation is wrapped as an MCP tool with:

- A descriptive name (e.g. `create_work_package`).
- A Zod `inputSchema` matching the OpenProject payload.
- A Zod `outputSchema` describing the key response fields.
- A handler that calls the OpenProject client and returns MCP content.

Example:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

server.registerTool(
  'create_work_package',
  {
    title: 'Create Work Package',
    description: 'Creates a new work package in OpenProject with specified properties',
    inputSchema: {
      project_id: z.number().describe('The ID of the project'),
      subject: z.string().describe('The subject/title of the work package'),
      type_id: z.number().optional().describe('The work package type ID'),
      description: z.string().optional().describe('Detailed description (supports markdown)'),
      assignee_id: z.number().optional().describe('User ID of the assignee'),
      priority_id: z.number().optional().describe('Priority ID'),
      start_date: z.string().optional().describe('Start date (ISO 8601)'),
      due_date: z.string().optional().describe('Due date (ISO 8601)'),
      estimated_hours: z.number().optional().describe('Estimated hours'),
      notify: z.boolean().optional().default(true).describe('Send notifications'),
    },
    outputSchema: {
      id: z.number(),
      subject: z.string(),
      project: z.object({ id: z.number(), name: z.string() }),
      status: z.object({ id: z.number(), name: z.string() }),
      _links: z.object({
        self: z.object({ href: z.string() }),
      }),
    },
  },
  async (params) => {
    const response = await openProjectClient.createWorkPackage(params);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }
);
```

The goal is to provide one tool per OpenProject API v3 endpoint whenever practical.

### Resources

Read-only data snapshots (projects, users, etc.) are exposed as MCP resources:

```typescript
server.resource(
  'projects',
  'openproject://projects',
  {
    name: 'OpenProject Projects',
    description: 'List of all accessible projects',
    mimeType: 'application/json',
  },
  async () => {
    const projects = await openProjectClient.listProjects();
    return {
      contents: [
        {
          uri: 'openproject://projects',
          mimeType: 'application/json',
          text: JSON.stringify(projects, null, 2),
        },
      ],
    };
  }
);
```

### Prompt templates

Reusable prompt templates help clients drive common workflows:

```typescript
server.prompt(
  'create_sprint_backlog',
  {
    name: 'Create Sprint Backlog',
    description: 'Template for creating work packages for a sprint',
    arguments: [
      { name: 'project_id', description: 'Project ID', required: true },
      { name: 'sprint_name', description: 'Sprint name', required: true },
      { name: 'tasks', description: 'JSON array of task titles', required: true },
    ],
  },
  async ({ project_id, sprint_name, tasks }) => {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Create work packages in project ${project_id} for sprint "${sprint_name}" with these tasks: ${tasks}`,
          },
        },
      ],
    };
  }
);
```

## Configuration & environment

- OpenProject connection is configured via:

  - `OPENPROJECT_URL` – base URL of your OpenProject instance.
  - `OPENPROJECT_API_KEY` – API key or access token.
  - `OPENPROJECT_TIMEOUT` – optional request timeout in ms (default 30000).

- For local development, you can use a `.env` file and let Bun load it.

## Custom MCP clients

For custom TypeScript/Node/Bun MCP clients:

### Stdio transport

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'bun',
  args: ['run', '/path/to/tonle/index.ts'],
  env: {
    OPENPROJECT_URL: 'https://your-instance.openproject.com',
    OPENPROJECT_API_KEY: 'your-api-key',
  },
});

const client = new Client({
  name: 'my-mcp-client',
  version: '1.0.0',
});

await client.connect(transport);
const tools = await client.listTools();
```

### HTTP transport

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL('http://localhost:3100/mcp')
);

const client = new Client({
  name: 'my-http-client',
  version: '1.0.0',
});

await client.connect(transport);
const tools = await client.listTools();
```

## Security & error handling

- Uses HTTPS to talk to OpenProject.
- API keys are provided only via environment variables.
- Operations respect OpenProject permissions; the server never elevates privileges.
- Errors from OpenProject are normalised into a small set of error identifiers such as:

```typescript
const ERROR_CODES = {
  NOT_FOUND: 'urn:openproject-org:api:v3:errors:NotFound',
  UNAUTHORIZED: 'urn:openproject-org:api:v3:errors:Unauthenticated',
  FORBIDDEN: 'urn:openproject-org:api:v3:errors:MissingPermission',
  VALIDATION: 'urn:openproject-org:api:v3:errors:PropertyConstraintViolation',
  CONFLICT: 'urn:openproject-org:api:v3:errors:UpdateConflict',
  INVALID_BODY: 'urn:openproject-org:api:v3:errors:InvalidRequestBody',
};
```

Transient errors can be retried with backoff; user-facing messages are kept clear and actionable.

## Roadmap (abridged)

- **Phase 1 – Core**: API client, work packages & projects CRUD, API-key auth, stdio transport.
- **Phase 2 – Coverage**: Remaining endpoints, OAuth2, resources, prompts, HTTP transport.
- **Phase 3 – Enterprise**: Rate limiting, caching, audit logging, multi-instance, SSO.
- **Phase 4 – Advanced**: Webhooks, real-time notifications, batch operations, AI-assisted planning prompts.

## OpenProject API v3 Endpoint Coverage

The MCP server provides tools for all OpenProject API v3 endpoints, organized into 41 categories:

### Core Categories

1. **Work Packages** - Tasks, features, bugs, milestones (CRUD + watchers, assignees, custom actions)
2. **Projects** - Project management (CRUD, copy, statuses)
3. **Users & Authentication** - User management (CRUD, lock/unlock, current user)
4. **Groups** - Group management (CRUD)
5. **Principals** - Users, groups, placeholder users
6. **Memberships** - Project memberships with roles
7. **Roles** - Permission roles
8. **Time Entries** - Time tracking (CRUD)
9. **Time Entry Activities** - Activity types for time entries
10. **Activities (Journal Entries)** - Work package history and comments

### Content & Documents

11. **Attachments** - File attachments (upload, download, link to work packages/activities)
12. **News** - News articles
13. **Posts** - Forum messages
14. **Wiki Pages** - Wiki content (read, update)
15. **Documents** - Document management
16. **File Links & Storages** - External file integration (Nextcloud, OneDrive/SharePoint)

### Organization & Configuration

17. **Versions** - Releases/milestones with sharing scopes
18. **Categories** - Work package categories
19. **Types** - Work package types (Task, Bug, Feature, etc.)
20. **Statuses** - Work package statuses (New, In Progress, Done, etc.)
21. **Priorities** - Priority levels
22. **Relations** - Work package relationships (blocks, precedes, relates, etc.)

### Views & Queries

23. **Queries** - Saved filters (CRUD, star/unstar)
24. **Query Filters** - Available filter definitions
25. **Query Columns** - Available column definitions
26. **Query Operators** - Filter operators (=, !=, <, >, etc.)
27. **Query Sort Bys** - Sort options
28. **Views** - Work packages table, team planner, Gantt views

### Notifications & Schedules

29. **Notifications** - In-app notifications (read/unread status)
30. **Work Schedule** - Days, week days, non-working days

### Budgets & Revisions

31. **Budgets** - Project budgets
32. **Revisions** - Repository commits linked to work packages

### Grids & Dashboards

33. **Grids** - Dashboard layouts with widgets

### Advanced Features

34. **Actions & Capabilities** - User capabilities
35. **Custom Actions** - Execute custom workflow actions
36. **Custom Options** - Custom field value options
37. **Help Texts** - Attribute help texts
38. **Project Phases & Definitions** - Project phase management
39. **Schemas** - Entity schemas
40. **User Preferences** - Current user preferences

### System & Configuration

41. **Root & Configuration** - API root, instance configuration (attachment limits, feature flags)
42. **OAuth 2.0** - OAuth application management
43. **Previewing** - Markdown and plain text rendering

For detailed endpoint documentation, see: https://www.openproject.org/docs/api/

## Deployment Options

### Docker Deployment

```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --production
COPY . .
ENV OPENPROJECT_URL=""
ENV OPENPROJECT_API_KEY=""
EXPOSE 3100
CMD ["bun", "run", "start:http"]
```

Build and run:

```bash
docker build -t tonle-mcp .
docker run -p 3100:3100 \
  -e OPENPROJECT_URL=https://your-instance.openproject.com \
  -e OPENPROJECT_API_KEY=your-api-key \
  tonle-mcp
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tonle-mcp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: tonle-mcp
  template:
    metadata:
      labels:
        app: tonle-mcp
    spec:
      containers:
      - name: mcp-server
        image: your-registry/tonle-mcp:latest
        ports:
        - containerPort: 3100
        env:
        - name: OPENPROJECT_URL
          valueFrom:
            secretKeyRef:
              name: openproject-secrets
              key: url
        - name: OPENPROJECT_API_KEY
          valueFrom:
            secretKeyRef:
              name: openproject-secrets
              key: api-key
---
apiVersion: v1
kind: Service
metadata:
  name: tonle-mcp
spec:
  selector:
    app: tonle-mcp
  ports:
  - port: 3100
    targetPort: 3100
```

### Process Manager (PM2)

```bash
pm2 start "bun run start:http" --name tonle-mcp
pm2 save
pm2 startup
```

## References

- OpenProject docs: `https://www.openproject.org/docs/`
- OpenProject API reference: `https://www.openproject.org/docs/api/`
- MCP spec: `https://spec.modelcontextprotocol.io/`
- MCP TypeScript SDK: `https://github.com/modelcontextprotocol/typescript-sdk`

