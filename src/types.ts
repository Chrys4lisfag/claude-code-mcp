/**
 * Interface for Claude Code tool arguments
 */
export interface ClaudeCodeArgs {
  prompt: string;
  workFolder?: string;
  sessionId?: string;
}

/**
 * Process mode for Claude CLI execution
 * - 'oneshot': Spawn a new process for each request (default, safer)
 * - 'persistent': Use a long-running process with stream-json mode
 */
export type ProcessMode = 'oneshot' | 'persistent';

/**
 * Session mode for conversation continuity
 * - 'stateless': No session persistence (default)
 * - 'persistent': Session persisted to file with TTL
 */
export type SessionMode = 'stateless' | 'persistent';

/**
 * Configuration options from environment variables
 */
export interface ClaudeCodeConfig {
  /** Process mode: 'oneshot' or 'persistent' */
  processMode: ProcessMode;
  /** Session mode: 'stateless' or 'persistent' */
  sessionMode: SessionMode;
  /** CLI timeout in seconds */
  cliTimeoutSeconds: number;
  /** Session TTL in hours */
  sessionTtlHours: number;
  /** Debug mode enabled */
  debugEnabled: boolean;
  /** Custom CLI name/path */
  cliName?: string;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: ClaudeCodeConfig = {
  processMode: 'oneshot',
  sessionMode: 'stateless',
  cliTimeoutSeconds: 3600, // 60 minutes
  sessionTtlHours: 24,
  debugEnabled: false,
};

/**
 * Parse configuration from environment variables
 */
export function parseConfig(): ClaudeCodeConfig {
  const config: ClaudeCodeConfig = { ...DEFAULT_CONFIG };

  // Process mode
  const processMode = process.env.CLAUDE_PROCESS_MODE?.toLowerCase();
  if (processMode === 'persistent' || processMode === 'oneshot') {
    config.processMode = processMode;
  }

  // Session mode
  const sessionMode = process.env.CLAUDE_SESSION_MODE?.toLowerCase();
  if (sessionMode === 'persistent' || sessionMode === 'stateless') {
    config.sessionMode = sessionMode;
  }

  // CLI timeout
  const timeoutStr = process.env.CLAUDE_CLI_TIMEOUT_SECONDS;
  if (timeoutStr) {
    const timeout = parseInt(timeoutStr, 10);
    if (!isNaN(timeout) && timeout > 0) {
      config.cliTimeoutSeconds = timeout;
    }
  }

  // Session TTL
  const ttlStr = process.env.CLAUDE_SESSION_TTL_HOURS;
  if (ttlStr) {
    const ttl = parseInt(ttlStr, 10);
    if (!isNaN(ttl) && ttl > 0) {
      config.sessionTtlHours = ttl;
    }
  }

  // Debug mode
  config.debugEnabled = process.env.MCP_CLAUDE_DEBUG === 'true';

  // CLI name
  config.cliName = process.env.CLAUDE_CLI_NAME;

  return config;
} 