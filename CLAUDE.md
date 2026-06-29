# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **Tonle OpenProject MCP Server** - a Model Context Protocol (MCP) server that provides AI assistants with seamless integration to OpenProject (open-source project management software). The server implements MCP tools that wrap the OpenProject API v3, enabling natural language interactions for project management operations.

## Development Commands

### Running the Server

```bash
# Start STDIO server (for local MCP clients like Claude Desktop)
bun run start
# or
bun run index.ts

# Start HTTP server (for remote/web clients)
bun run start:http

# Development mode with auto-reload
bun run dev          # STDIO transport
bun run dev:http     # HTTP transport

# Test with MCP Inspector
bun run inspect      # Inspect STDIO server
bun run inspect:http # Inspect HTTP server
```

### Running Tests

```bash
# Run all tests
bun test

# Run HTTP transport tests only
bun test tests/mcp-server.test.ts

# Run transport comparison tests
bun test tests/transport-comparison.test.ts
```

### Package Management

```bash
# Install dependencies
bun install

# Update dependencies
bun update
```

## Architecture

### Core Components

1. **index.ts** - STDIO MCP server entry point
   - Uses shared server setup from `src/server-setup.ts`
   - Implements stdio transport for local integration (Claude Desktop, Cursor)
   - Best for spawning server as subprocess

2. **http-server.ts** - HTTP MCP server entry point
   - Uses shared server setup from `src/server-setup.ts`
   - Implements Streamable HTTP transport for remote clients
   - Supports session management with UUID-based sessions
   - Endpoints: `/mcp` (POST/GET/DELETE), `/health` (GET)

3. **src/server-setup.ts** - Shared MCP server configuration
   - Registers all MCP tools using `@modelcontextprotocol/sdk`
   - Tool handlers transform user-friendly parameters into API calls
   - Each tool follows pattern: validate input → call client → format response

4. **src/openproject-client.ts** - OpenProject API client
   - Type-safe wrapper around OpenProject API v3
   - HAL+JSON format handling
   - Authentication via Basic Auth with API key
   - Request/response typing with TypeScript interfaces

### Data Flow

```
MCP Client (Claude, Cursor, etc.)          Web Client / Remote App
    ↓ JSON-RPC over stdio                       ↓ JSON-RPC over HTTP
MCP Server (index.ts)                      HTTP Server (http-server.ts)
    ↓                                           ↓
    └─────────── Server Setup (src/server-setup.ts) ───────────┘
                            ↓ Tool registration & handlers
                OpenProject Client (src/openproject-client.ts)
                            ↓ HTTPS with HAL+JSON
                        OpenProject Instance (API v3)
```

### Key Architecture Patterns

- **HAL+JSON Hypermedia**: OpenProject uses hypermedia format where relationships are represented as `_links` objects containing hrefs
- **Link Construction**: Related entities reference each other via links like `/api/v3/projects/123`, constructed using the `createLink()` helper
- **Optimistic Locking**: Updates require `lockVersion` parameter to prevent concurrent modification conflicts
- **Rich Text Fields**: Description fields use `{ raw: string }` format for markdown content
- **Pagination**: List endpoints support `offset` and `pageSize` parameters (max 1000)

## Configuration

### Environment Variables

Required for the server to connect to OpenProject:

- `OPENPROJECT_URL` - Base URL of OpenProject instance (e.g., `https://example.openproject.com`)
- `OPENPROJECT_API_KEY` or `OPENPROJECT_TOKEN` - API key for authentication
- `OPENPROJECT_TIMEOUT` - Request timeout in milliseconds (default: 30000)

HTTP server specific (optional):

- `MCP_HTTP_PORT` - HTTP server port (default: 3100)
- `MCP_HTTP_HOST` - HTTP server host (default: 0.0.0.0)

### Claude Desktop Integration (STDIO)

Add to `~/.config/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "openproject": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/Tonle/index.ts"],
      "env": {
        "OPENPROJECT_URL": "https://your-instance.openproject.com",
        "OPENPROJECT_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### HTTP Client Integration

For remote/web clients, start the HTTP server:

```bash
OPENPROJECT_URL=https://your-instance.openproject.com \
OPENPROJECT_API_KEY=your-api-key \
bun run start:http
```

Then connect using the MCP SDK's HTTP transport:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL('http://localhost:3100/mcp')
);
const client = new Client({ name: 'my-client', version: '1.0.0' });
await client.connect(transport);
```

## Implementing New Tools

When adding support for additional OpenProject API endpoints:

1. **Add TypeScript interface** to `src/openproject-client.ts` if needed for the response type
2. **Implement client method** in `OpenProjectClient` class following existing patterns:
   - Use typed parameters and return types
   - Handle HAL+JSON link structures
   - Support optional pagination/filtering parameters
3. **Register MCP tool** in `index.ts`:
   - Use `server.tool()` with clear name and description
   - Define Zod schema for input validation
   - Transform parameters to API format (especially `_links` objects)
   - Handle errors and format responses consistently
   - Return `{ content: [{ type: 'text', text: formatResponse(result) }] }`

### Example Pattern for Creating Resources

```typescript
// In src/openproject-client.ts
async createResource(data: { name: string; projectId: number }): Promise<Resource> {
  return this.request('POST', '/resources', {
    name: data.name,
    _links: {
      project: { href: `/api/v3/projects/${data.projectId}` }
    }
  });
}

// In index.ts
server.tool(
  'create_resource',
  'Create a new resource in a project',
  {
    name: z.string().describe('Resource name'),
    projectId: z.number().describe('Project ID'),
  },
  async ({ name, projectId }) => {
    try {
      const result = await client.createResource({ name, projectId });
      return { content: [{ type: 'text', text: formatResponse(result) }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true
      };
    }
  }
);
```

## OpenProject API Specifics

### Authentication
- Uses Basic Auth with format: `apikey:{API_KEY}` encoded as base64
- API keys generated in OpenProject under "My account" → "Access tokens"

### HAL+JSON Links Pattern
When referencing related resources, use the `_links` structure:
```typescript
{
  _links: {
    assignee: { href: '/api/v3/users/5' },
    project: { href: '/api/v3/projects/demo-project' }
  }
}
```

### Common Endpoints Currently Implemented
- **Projects**: CRUD operations, listing with filters
- **Work Packages**: CRUD, activities, project-scoped listing; task read tools default to OPEN work packages only unless an explicit status/filter is supplied; `list_work_packages_by_status` filters tasks by a status ID/name (optionally scoped by project and/or assignee), builds the filter JSON for you, returns `summary` counts plus a paged `tasks` list, and defaults task paging to 100 records; `bulk_update_work_packages` updates many at once (shared `defaults` plus per-item overrides, auto-fetched lockVersions, per-item success/failure results; helpers in `src/bulk-update.ts`); `list_member_tasks` returns tasks of each member as a 4-level nested tree — Project → Member (assignee) → Status → task list — with a `taskCount` at every level and an "Unassigned" bucket. Route any request that lists/extracts/groups tasks **by / per / for each member** here (e.g. "Extract all tasks currently marked as In Progress group by each member" or "easy-to-read list of all In Progress tasks by team members" → `list_member_tasks(statusId="In Progress")`); it does the per-member grouping itself, so prefer it over `list_work_packages_by_status` for those. All three filters are optional (`userId` assignee ID; `projectId` accepts ID/identifier/**name**; `statusId` accepts ID or **name**, resolved automatically); with no status/filter, closed tasks are excluded by the open-status filter. Grouping/filter helpers live in `src/member-tasks.ts` and `src/status-tasks.ts`; `OpenProjectClient.listAllWorkPackages` follows pagination, and `resolveProjectRef` resolves a project name/identifier/ID.
  - **Status-by-name workflow**: in the raw OpenProject filter JSON, statuses (and assignees) are referenced by numeric ID, never by name. The two-step "call `list_statuses` to resolve the name → ID, then pass that ID" instruction applies **only** when building a `status` filter for `list_work_packages` / `list_project_work_packages`. Prefer the name-aware tools: both `list_work_packages_by_status` and `list_member_tasks` accept a status NAME directly and resolve it for you — no `list_statuses` round-trip needed. In particular, a request that names a status **and** groups by member (e.g. "In Progress tasks per member / by team members") should go straight to `list_member_tasks(statusId="In Progress")`.
- **Users**: CRUD, lock/unlock, current user
- **Types**: List available work package types
- **Statuses**: List available statuses
- **Priorities**: List available priorities
- **Time Entries**: CRUD operations; `get_timesheet_total` aggregates logged hours for a user or the whole team over named periods (today/yesterday/this_week/last_week/this_month/last_month) or an explicit date range, with per-user/per-project/per-date breakdowns (helpers in `src/timesheet.ts`)
- **Versions**: CRUD operations (milestones/releases)
- **Activities**: View journal entries
- **Principals**: List users, groups, and placeholder users
- **Attachments**: `create_work_package` and `update_work_package` accept an optional `attachments` array; `list_work_package_attachments` and `delete_attachment` manage existing files. Each attachment is supplied by a local `filePath` (server reads it) **or** `base64` content, with optional `fileName`/`contentType`/`description`. **Image** files (content type `image/*`) are embedded **inline in the work package description** as markdown (`![fileName](/api/v3/attachments/{id}/content)`); **all other file types** are attached as normal work package file attachments. The `inline` flag overrides this per file (defaults to true for images, false otherwise). Uploads use OpenProject's `multipart/form-data` attachment endpoint (`OpenProjectClient.uploadMultipart` / `createWorkPackageAttachment`); preparation, content-type detection, the inline-image decision and the description-merge happen in `src/attachments.ts`. Flow: the work package is created/updated first, attachments are uploaded to it, then the description is patched once (via `updateWithLockRetry`) to embed any inline images. A failed individual upload is reported per-file without aborting the rest; when attachments are present the tool returns `{ workPackage, attachments: [...] }`.

### Future Endpoint Categories to Implement
See README.md for comprehensive list of 40+ endpoint categories including memberships, roles, relations, queries, notifications, attachments, file links, and more.

## TypeScript Configuration

The project uses Bun's modern TypeScript setup:
- `module: "Preserve"` - Preserves ES modules
- `moduleResolution: "bundler"` - Bundler-style resolution
- `allowImportingTsExtensions: true` - Direct .ts imports
- `strict: true` - Full strict mode enabled
- `noEmit: true` - No compilation output (Bun runs TS directly)

## Error Handling

OpenProject API returns structured errors:
```typescript
{
  _type: 'Error',
  errorIdentifier: 'urn:openproject-org:api:v3:errors:NotFound',
  message: 'Resource not found',
  _embedded: { details: { attribute: 'subject' } }
}
```

The client extracts and throws readable error messages including the identifier and message.

## Testing Strategy

- Use MCP Inspector (`bun run inspect`) to test tools interactively
- Verify authentication by testing `get_current_user` tool
- Test against a dedicated OpenProject test instance, not production
- For work package updates, `lockVersion` is optional — omit it to auto-fetch the freshest value (a stale version is refetched and the update retried once); supply it only when you already have a fresh value
