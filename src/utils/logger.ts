/**
 * Application Logger
 *
 * NOTE: Using simplified logger to avoid Winston dependency issues in shared environment
 * In production, use Winston or similar structured logging library
 */

import * as fs from 'fs';
import * as path from 'path';

// Ensure logs directory exists
const logsDir = 'logs';
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Structured Logger Implementation
 * Outputs JSON logs to files and formatted logs to console
 */
class StructuredLogger {
  private logLevel: string;
  private nodeEnv: string;

  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.nodeEnv = process.env.NODE_ENV || 'development';
  }

  private formatLog(level: string, message: string, meta?: Record<string, unknown>): string {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
  }

  private writeToFile(level: string, message: string, meta?: Record<string, unknown>): void {
    try {
      const logEntry = JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        ...(meta || {})
      });

      // Write to combined log
      fs.appendFileSync(path.join(logsDir, 'combined.log'), logEntry + '\n');

      // Write errors to error log
      if (level === 'error') {
        fs.appendFileSync(path.join(logsDir, 'error.log'), logEntry + '\n');
      }
    } catch (error) {
      console.error('Failed to write log:', error);
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.writeToFile('info', message, meta);
    if (this.shouldLog('info')) {
      console.log(this.formatLog('info', message, meta));
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.writeToFile('warn', message, meta);
    if (this.shouldLog('warn')) {
      console.warn(this.formatLog('warn', message, meta));
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.writeToFile('debug', message, meta);
    if (this.shouldLog('debug')) {
      console.log(this.formatLog('debug', message, meta));
    }
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.writeToFile('error', message, meta);
    console.error(this.formatLog('error', message, meta));
  }

  private shouldLog(level: string): boolean {
    if (this.nodeEnv === 'production') {
      return false;
    }

    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    return levels[level as keyof typeof levels] >= levels[this.logLevel as keyof typeof levels];
  }
}

export const logger = new StructuredLogger();

/**
 * Log helper functions
 */
export const logReviewStart = (owner: string, repo: string, prNumber: number) => {
  logger.info('Starting code review', { owner, repo, prNumber });
};

export const logReviewComplete = (
  owner: string,
  repo: string,
  prNumber: number,
  score: number,
  duration: number
) => {
  logger.info('Code review completed', {
    owner,
    repo,
    prNumber,
    score,
    duration,
    status: 'success'
  });
};

export const logReviewError = (
  owner: string,
  repo: string,
  prNumber: number,
  error: Error
) => {
  logger.error('Code review failed', {
    owner,
    repo,
    prNumber,
    error: error.message,
    stack: error.stack,
    status: 'failed'
  });
};

export const logAgentStart = (agentName: string, file: string) => {
  logger.debug('Subagent starting', { agent: agentName, file });
};

export const logAgentComplete = (agentName: string, file: string, duration: number) => {
  logger.debug('Subagent completed', { agent: agentName, file, duration });
};
