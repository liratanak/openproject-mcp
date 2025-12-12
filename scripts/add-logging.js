#!/usr/bin/env node
/**
 * Script to add logging to all MCP tool handlers in server-setup.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, '../src/server-setup.ts');
let content = fs.readFileSync(filePath, 'utf-8');

// Pattern to match tool definitions without logging
// Matches: server.tool('tool_name', ..., async (params) => {
// But NOT if it already has: const toolName =
const pattern = /server\.tool\(\s*'([^']+)',\s*'([^']+)',\s*\{([^}]*)\},\s*async\s*\(([^)]*)\)\s*=>\s*\{(?!\s*const toolName)/gs;

let matchCount = 0;
content = content.replace(pattern, (match, toolName, description, schema, params) => {
  matchCount++;

  const paramsVar = params.trim() || '';

  // Build the logging prefix
  const loggingPrefix = `
      const toolName = '${toolName}';
      const caller = \`tool:\${toolName}\`;
      logger.logToolInvocation(caller, toolName, ${paramsVar || '{}'});
      client.setCaller(caller);
`;

  // Build the new tool definition
  return `server.tool(
    '${toolName}',
    '${description}',
    {${schema}},
    async (${params}) => {${loggingPrefix}`;
});

// Now update the try-catch blocks to add logging
content = content.replace(
  /const result = await ([^;]+);(\s*)return \{ content: \[\{ type: 'text', text: formatResponse\(result\) \}\] \};/gs,
  (match, apiCall, spacing) => {
    return `const result = await ${apiCall};${spacing}const response = { content: [{ type: 'text', text: formatResponse(result) }] };${spacing}logger.logToolResult(caller, toolName, true, result);${spacing}return response;`;
  }
);

// Handle special cases that just return text without formatResponse
content = content.replace(
  /return \{ content: \[\{ type: 'text', text: `([^`]+)` \}\] \};(?!\s*} catch)/gs,
  (match, message) => {
    return `const response = { content: [{ type: 'text', text: \`${message}\` }] };
        logger.logToolResult(caller, toolName, true);
        return response;`;
  }
);

// Update catch blocks to add logging
content = content.replace(
  /\} catch \(error\) \{(\s*)return \{ content: \[\{ type: 'text', text: `Error: \$\{error instanceof Error \? error\.message : String\(error\)\}` \}\], isError: true \};/gs,
  (match, spacing) => {
    return `} catch (error) {${spacing}logger.logToolResult(caller, toolName, false, undefined, error as Error);${spacing}return { content: [{ type: 'text', text: \`Error: \${error instanceof Error ? error.message : String(error)}\` }], isError: true };`;
  }
);

fs.writeFileSync(filePath, content);
console.log(`Updated ${matchCount} tool handlers with logging`);
