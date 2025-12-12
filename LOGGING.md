# Logging System Documentation

## Overview

The Tonle OpenProject MCP Server includes a comprehensive logging system that tracks all server activities, API calls, and tool invocations. Logs are automatically organized by date and caller (initiator) for easy debugging and auditing.

## Log Directory Structure

All logs are stored in the `logs/` directory at the project root:

```
logs/
├── 2025-12-10-stdio-server.log      # STDIO server lifecycle events
├── 2025-12-10-http-server.log       # HTTP server lifecycle events
├── 2025-12-10-tool_list_projects.log    # Logs from list_projects tool
├── 2025-12-10-tool_create_work_package.log  # Logs from create_work_package tool
└── ...
```

## Log File Format

Each log entry follows this format:

```
[timestamp] [level] [caller] [category] message
  Data: {json data if present}
```

### Example Log Entries

**Server Startup:**
```
[2025-12-10T10:30:45.123Z] [INFO] [stdio-server] [SERVER_EVENT] Server starting
  Data: {
    "transport": "stdio",
    "version": "1.0.0"
  }
```

**Authentication:**
```
[2025-12-10T10:30:46.456Z] [INFO] [stdio-server] [AUTH] Authentication successful
  Data: {
    "userId": 1,
    "userName": "Admin User",
    "userLogin": "admin",
    "isAdmin": true
  }
```

**Tool Invocation:**
```
[2025-12-10T10:31:20.789Z] [INFO] [tool:list_projects] [TOOL_INVOCATION] Tool: list_projects
  Data: {
    "toolName": "list_projects",
    "params": {
      "pageSize": 50
    }
  }
```

**API Request:**
```
[2025-12-10T10:31:20.890Z] [INFO] [tool:list_projects] [API_REQUEST] GET /projects
  Data: {
    "method": "GET",
    "endpoint": "/projects",
    "params": {
      "pageSize": 50
    }
  }
```

**API Response:**
```
[2025-12-10T10:31:21.234Z] [INFO] [tool:list_projects] [API_RESPONSE] GET /projects - Status: 200
  Data: {
    "method": "GET",
    "endpoint": "/projects",
    "status": 200,
    "responseData": { ... }
  }
```

**Tool Result:**
```
[2025-12-10T10:31:21.345Z] [INFO] [tool:list_projects] [TOOL_RESULT] Tool list_projects succeeded
  Data: {
    "toolName": "list_projects",
    "result": { ... }
  }
```

**Error Example:**
```
[2025-12-10T10:32:15.678Z] [ERROR] [tool:get_project] [API_ERROR] GET /projects/999 failed
  Data: {
    "method": "GET",
    "endpoint": "/projects/999",
    "error": "OpenProject API Error: Not Found (404)",
    "stack": "Error: OpenProject API Error: Not Found (404)\n    at ..."
  }
```

## Log Levels

- **INFO**: Normal operational messages (API calls, tool invocations, successes)
- **WARN**: Warning messages (authentication failures, invalid sessions)
- **ERROR**: Error messages (API failures, tool errors, server errors)
- **DEBUG**: Debug messages (health checks, detailed request info)

## Log Categories

### SERVER_EVENT
Server lifecycle events (startup, shutdown, connection status)

**Callers:** `stdio-server`, `http-server`

### AUTH
Authentication and authorization events

**Callers:** `stdio-server`, `http-server`

### SESSION_EVENT
HTTP session management (initialization, closure)

**Callers:** `http-server`

### TOOL_INVOCATION
MCP tool invocation with parameters

**Callers:** `tool:<tool_name>`

### TOOL_RESULT
MCP tool execution results (success or failure)

**Callers:** `tool:<tool_name>`

### API_REQUEST
HTTP requests to OpenProject API

**Callers:** `tool:<tool_name>`, `system`

### API_RESPONSE
HTTP responses from OpenProject API

**Callers:** `tool:<tool_name>`, `system`

### API_ERROR
Errors from OpenProject API calls

**Callers:** `tool:<tool_name>`, `system`

### HTTP_REQUEST
Incoming HTTP requests to the MCP server

**Callers:** `http-server`

## Environment Variables

### LOG_TO_CONSOLE
Console logging is **enabled by default**. Logs are written to both files and console (stderr).

To disable console logging and only write to files:

```bash
LOG_TO_CONSOLE=false bun run start
```

Default: `true` (logs to both console and files)

## Caller Identification

Logs are separated by caller/initiator:

1. **stdio-server** - STDIO transport server
2. **http-server** - HTTP transport server
3. **system** - System-level operations (initial auth)
4. **tool:<tool_name>** - Individual MCP tools (e.g., `tool:list_projects`)

Each caller gets its own log file per day, making it easy to track specific operations.

## Viewing Logs

### View all logs for today
```bash
ls -l logs/$(date +%Y-%m-%d)-*.log
```

### View STDIO server logs
```bash
tail -f logs/$(date +%Y-%m-%d)-stdio-server.log
```

### View HTTP server logs
```bash
tail -f logs/$(date +%Y-%m-%d)-http-server.log
```

### View specific tool logs
```bash
tail -f logs/$(date +%Y-%m-%d)-tool_list_projects.log
```

### Search for errors
```bash
grep -r "ERROR" logs/
```

### Search for specific tool invocations
```bash
grep -r "list_projects" logs/
```

### View all API calls for a specific date
```bash
grep "API_REQUEST" logs/2025-12-10-*.log
```

## Log Rotation

Logs are automatically rotated daily by filename. Old logs are kept indefinitely unless manually deleted. To implement automatic cleanup:

```bash
# Delete logs older than 30 days
find logs/ -name "*.log" -mtime +30 -delete
```

You can add this to a cron job for automatic cleanup:
```bash
# Run daily at midnight
0 0 * * * find /path/to/Tonle/logs/ -name "*.log" -mtime +30 -delete
```

## Best Practices

1. **Monitor logs regularly** - Check for errors and unusual patterns
2. **Set up log rotation** - Prevent logs from consuming too much disk space
3. **Use grep/awk for analysis** - Powerful tools for log analysis
4. **Disable console logging in production** - Set `LOG_TO_CONSOLE=false` to reduce noise
5. **Separate logs by environment** - Use different log directories for dev/staging/prod

## Troubleshooting

### Logs directory not created
The logs directory is created automatically on first log write. If it doesn't exist, check file system permissions.

### No logs appearing
1. Check that the logger is imported in the file
2. Verify LOG_TO_CONSOLE is set if you expect console output
3. Check file system permissions on the logs directory

### Large log files
Implement log rotation (see above) or increase cleanup frequency.

## Integration with Monitoring Tools

The log format is compatible with standard log aggregation tools:

- **Logstash/Elasticsearch**: Parse JSON data sections
- **Splunk**: Index by caller and category
- **CloudWatch**: Stream logs with AWS CLI
- **Datadog**: Use file tailing agent

Example Logstash grok pattern:
```
\[%{TIMESTAMP_ISO8601:timestamp}\] \[%{WORD:level}\] \[%{DATA:caller}\] \[%{DATA:category}\] %{GREEDYDATA:message}
```

## API Reference

For developers extending the logging system, see `src/logger.ts`:

```typescript
import logger from './src/logger.ts';

// Log methods
logger.info(caller, category, message, data?)
logger.warn(caller, category, message, data?)
logger.error(caller, category, message, data?)
logger.debug(caller, category, message, data?)

// Specialized methods
logger.logApiRequest(caller, method, endpoint, params?, body?)
logger.logApiResponse(caller, method, endpoint, status, data?)
logger.logApiError(caller, method, endpoint, error)
logger.logToolInvocation(caller, toolName, params)
logger.logToolResult(caller, toolName, success, result?, error?)
logger.logServerEvent(caller, event, details?)
logger.logSessionEvent(caller, sessionId, event, details?)
logger.logAuth(caller, success, userInfo?)
```
