# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **Tonle OpenProject MCP Server** - a Model Context Protocol (MCP) server that provides AI assistants with seamless integration to OpenProject (open-source project management software). The server implements MCP tools that wrap the OpenProject API v3, enabling natural language interactions for project management operations.

## Development Commands

### Running the Server

```bash
# Start the server with Bun
bun run index.ts

# Development mode with auto-reload
bun run dev

# Test with MCP Inspector
bun run inspect
# or
bunx @modelcontextprotocol/inspector bun run index.ts
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

1. **index.ts** - Main MCP server entry point
   - Registers all MCP tools using `@modelcontextprotocol/sdk`
   - Implements stdio transport for local integration
   - Tool handlers transform user-friendly parameters into API calls
   - Each tool follows pattern: validate input → call client → format response

2. **src/openproject-client.ts** - OpenProject API client
   - Type-safe wrapper around OpenProject API v3
   - HAL+JSON format handling
   - Authentication via Basic Auth with API key
   - Request/response typing with TypeScript interfaces

### Data Flow

```
MCP Client (Claude, Cursor, etc.)
    ↓ JSON-RPC over stdio
MCP Server (index.ts)
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

### Claude Desktop Integration

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
- **Work Packages**: CRUD, activities, project-scoped listing
- **Users**: CRUD, lock/unlock, current user
- **Types**: List available work package types
- **Statuses**: List available statuses
- **Priorities**: List available priorities
- **Time Entries**: CRUD operations
- **Versions**: CRUD operations (milestones/releases)
- **Activities**: View journal entries
- **Principals**: List users, groups, and placeholder users

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
- For work package updates, always retrieve current `lockVersion` first
