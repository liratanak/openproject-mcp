/**
 * Logging utility for OpenProject MCP Server
 * Creates daily log files separated by caller/initiator
 *
 * IMPORTANT: Logs are stored in an absolute path:
 * ~/Tonle/logs/
 *
 * This ensures logs are always written to the same location regardless
 * of the working directory when the MCP server is started.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Get the absolute path to the project root (where this file's parent directory is)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Default logs directory - always use absolute path
const DEFAULT_LOGS_DIR = path.join(PROJECT_ROOT, 'logs');

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  caller: string;
  category: string;
  message: string;
  data?: any;
}

export class Logger {
  private logsDir: string;
  private enableConsole: boolean;

  constructor(logsDir?: string, enableConsole: boolean = false) {
    // Use provided path or default to absolute project logs directory
    this.logsDir = logsDir || DEFAULT_LOGS_DIR;
    this.enableConsole = enableConsole;
    this.ensureLogsDirectory();
  }

  /**
   * Get the logs directory path (useful for debugging/documentation)
   */
  getLogsDir(): string {
    return this.logsDir;
  }

  private ensureLogsDirectory(): void {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  private getLogFileName(caller: string): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const sanitizedCaller = caller.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(this.logsDir, `${date}-${sanitizedCaller}.log`);
  }

  private formatLogEntry(entry: LogEntry): string {
    const dataStr = entry.data ? `\n  Data: ${JSON.stringify(entry.data, null, 2)}` : '';
    return `[${entry.timestamp}] [${entry.level}] [${entry.caller}] [${entry.category}] ${entry.message}${dataStr}\n`;
  }

  private writeLog(entry: LogEntry): void {
    const logFile = this.getLogFileName(entry.caller);
    const formattedEntry = this.formatLogEntry(entry);

    // Write to file
    fs.appendFileSync(logFile, formattedEntry);

    // Optionally write to console for debugging
    if (this.enableConsole) {
      console.error(formattedEntry.trim());
    }
  }

  log(level: LogLevel, caller: string, category: string, message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      caller,
      category,
      message,
      data,
    };
    this.writeLog(entry);
  }

  // Convenience methods
  info(caller: string, category: string, message: string, data?: any): void {
    this.log('INFO', caller, category, message, data);
  }

  warn(caller: string, category: string, message: string, data?: any): void {
    this.log('WARN', caller, category, message, data);
  }

  error(caller: string, category: string, message: string, data?: any): void {
    this.log('ERROR', caller, category, message, data);
  }

  debug(caller: string, category: string, message: string, data?: any): void {
    this.log('DEBUG', caller, category, message, data);
  }

  // Specialized logging methods for different event types
  logApiRequest(caller: string, method: string, endpoint: string, params?: any, body?: any): void {
    this.info(caller, 'API_REQUEST', `${method} ${endpoint}`, {
      method,
      endpoint,
      params,
      body,
    });
  }

  logApiResponse(caller: string, method: string, endpoint: string, status: number, data?: any): void {
    this.info(caller, 'API_RESPONSE', `${method} ${endpoint} - Status: ${status}`, {
      method,
      endpoint,
      status,
      responseData: data,
    });
  }

  logApiError(caller: string, method: string, endpoint: string, error: Error): void {
    this.error(caller, 'API_ERROR', `${method} ${endpoint} failed`, {
      method,
      endpoint,
      error: error.message,
      stack: error.stack,
    });
  }

  logToolInvocation(caller: string, toolName: string, params: any): void {
    this.info(caller, 'TOOL_INVOCATION', `Tool: ${toolName}`, {
      toolName,
      params,
    });
  }

  logToolResult(caller: string, toolName: string, success: boolean, result?: any, error?: Error): void {
    if (success) {
      this.info(caller, 'TOOL_RESULT', `Tool ${toolName} succeeded`, {
        toolName,
        result,
      });
    } else {
      this.error(caller, 'TOOL_RESULT', `Tool ${toolName} failed`, {
        toolName,
        error: error?.message,
        stack: error?.stack,
      });
    }
  }

  logServerEvent(caller: string, event: string, details?: any): void {
    this.info(caller, 'SERVER_EVENT', event, details);
  }

  logSessionEvent(caller: string, sessionId: string, event: string, details?: any): void {
    this.info(caller, 'SESSION_EVENT', `Session ${sessionId}: ${event}`, {
      sessionId,
      event,
      ...details,
    });
  }

  logAuth(caller: string, success: boolean, userInfo?: any): void {
    if (success) {
      this.info(caller, 'AUTH', 'Authentication successful', userInfo);
    } else {
      this.warn(caller, 'AUTH', 'Authentication failed', userInfo);
    }
  }
}

// Create a singleton instance
// Default to console logging enabled unless explicitly disabled
const enableConsole = process.env.LOG_TO_CONSOLE !== 'false';
const logger = new Logger(undefined, enableConsole); // undefined uses DEFAULT_LOGS_DIR

// Log where logs are being written (helps with debugging)
// This runs at module load time
try {
  const initMessage = `Logger initialized. Logs directory: ${logger.getLogsDir()}`;
  console.error(`[Tonle MCP] ${initMessage}`);
} catch {
  // Silently ignore if console.error fails
}

export default logger;
export { DEFAULT_LOGS_DIR, PROJECT_ROOT };
