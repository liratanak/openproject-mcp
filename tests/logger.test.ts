/**
 * Tests for the logging functionality
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../src/logger.ts';

describe('Logger', () => {
  const testLogsDir = 'logs-test';
  let logger: Logger;

  beforeAll(() => {
    // Create test logger
    logger = new Logger(testLogsDir, false);
  });

  afterAll(() => {
    // Clean up test logs
    if (fs.existsSync(testLogsDir)) {
      fs.rmSync(testLogsDir, { recursive: true, force: true });
    }
  });

  it('should create logs directory', () => {
    expect(fs.existsSync(testLogsDir)).toBe(true);
  });

  it('should log info message', () => {
    const caller = 'test-caller';
    const category = 'TEST';
    const message = 'Test info message';

    logger.info(caller, category, message);

    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(testLogsDir, `${date}-test-caller.log`);

    expect(fs.existsSync(logFile)).toBe(true);

    const content = fs.readFileSync(logFile, 'utf-8');
    expect(content).toContain('INFO');
    expect(content).toContain('test-caller');
    expect(content).toContain('TEST');
    expect(content).toContain('Test info message');
  });

  it('should log error with data', () => {
    const caller = 'error-caller';
    const category = 'ERROR_TEST';
    const message = 'Test error message';
    const data = { errorCode: 500, details: 'Something went wrong' };

    logger.error(caller, category, message, data);

    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(testLogsDir, `${date}-error-caller.log`);

    expect(fs.existsSync(logFile)).toBe(true);

    const content = fs.readFileSync(logFile, 'utf-8');
    expect(content).toContain('ERROR');
    expect(content).toContain('error-caller');
    expect(content).toContain('ERROR_TEST');
    expect(content).toContain('Test error message');
    expect(content).toContain('errorCode');
    expect(content).toContain('500');
  });

  it('should log API request', () => {
    const caller = 'api-test';
    const method = 'GET';
    const endpoint = '/test';

    logger.logApiRequest(caller, method, endpoint);

    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(testLogsDir, `${date}-api-test.log`);

    expect(fs.existsSync(logFile)).toBe(true);

    const content = fs.readFileSync(logFile, 'utf-8');
    expect(content).toContain('API_REQUEST');
    expect(content).toContain('GET /test');
  });

  it('should log tool invocation', () => {
    const caller = 'tool:test_tool';
    const toolName = 'test_tool';
    const params = { param1: 'value1', param2: 42 };

    logger.logToolInvocation(caller, toolName, params);

    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(testLogsDir, `${date}-tool_test_tool.log`);

    expect(fs.existsSync(logFile)).toBe(true);

    const content = fs.readFileSync(logFile, 'utf-8');
    expect(content).toContain('TOOL_INVOCATION');
    expect(content).toContain('test_tool');
    expect(content).toContain('param1');
  });

  it('should log session event', () => {
    const caller = 'session-test';
    const sessionId = 'test-session-123';
    const event = 'initialized';

    logger.logSessionEvent(caller, sessionId, event);

    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(testLogsDir, `${date}-session-test.log`);

    expect(fs.existsSync(logFile)).toBe(true);

    const content = fs.readFileSync(logFile, 'utf-8');
    expect(content).toContain('SESSION_EVENT');
    expect(content).toContain('test-session-123');
    expect(content).toContain('initialized');
  });
});
