# Tonle OpenProject MCP Server

A Model Context Protocol (MCP) server that connects AI assistants (Claude, Cursor, Windsurf, etc.) to OpenProject's API v3.

## Quick Start

### 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. Clone & Install

```bash
git clone https://github.com/liratanak/tonle.git
cd tonle
bun install
```

### 3. Configure Environment

Create a `.env` file or set environment variables:

```bash
OPENPROJECT_URL=https://your-instance.openproject.com
OPENPROJECT_API_KEY=your-api-key-here
```

**Get your API key:**
- Log into OpenProject → My Account → Access Tokens → Generate

### 4. Run the Server

```bash
# Stdio mode (default)
bun run index.ts

# HTTP mode
bun run start:http
```

### 5. Test with MCP Inspector

```bash
bunx @modelcontextprotocol/inspector bun run index.ts
```

## Using with MCP Clients

Add to your MCP client configuration (e.g., `claude_desktop_config.json`, `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "openproject": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/tonle/index.ts"],
      "env": {
        "OPENPROJECT_URL": "https://your-instance.openproject.com",
        "OPENPROJECT_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**Configuration file locations:**
- **Claude Desktop** (macOS): `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Desktop** (Windows): `%APPDATA%\Claude\claude_desktop_config.json`
- **Claude Desktop** (Linux): `~/.config/Claude/claude_desktop_config.json`
- **Cursor**: `.cursor/mcp.json` in project root

## What You Can Do

Once connected, you can ask your AI assistant to:

- "List all my OpenProject projects"
- "Create a new task in project X titled 'Setup testing environment'"
- "Show me all work packages assigned to me"
- "Update work package #123 to status 'In Progress'"
- And much more...

## Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Technical architecture, implementation details, and API reference
- **[MCP_SERVERS.md](./MCP_SERVERS.md)** - Client-specific configuration examples (if available)
- **[LOGGING.md](./LOGGING.md)** - Comprehensive logging system documentation

## Features

- ✅ Complete OpenProject API v3 coverage (40+ endpoint categories)
- ✅ Work packages, projects, users, time entries, and more
- ✅ Stdio transport (local clients)
- ✅ HTTP transport (remote clients)
- ✅ Type-safe with TypeScript & Zod validation
- ✅ Comprehensive logging system (daily logs by caller/initiator)

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Server not appearing | Check absolute path to `index.ts`, restart client |
| Authentication errors | Verify API key is correct and has permissions |
| Connection timeout | Check `OPENPROJECT_URL` is accessible |
| Bun command not found | Ensure Bun is installed and in your PATH |

## Contributing

```bash
git clone https://github.com/liratanak/tonle.git
cd tonle
bun install
bun run dev    # Development mode
bun test       # Run tests
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed development information.

## License

MIT License - See LICENSE file for details

## Resources

- **OpenProject**: https://www.openproject.org/docs/
- **OpenProject API**: https://www.openproject.org/docs/api/
- **MCP Specification**: https://spec.modelcontextprotocol.io/
- **MCP SDK**: https://github.com/modelcontextprotocol/typescript-sdk
