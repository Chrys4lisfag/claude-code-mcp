/**
 * SessionManager handles file-based session persistence for Claude CLI.
 * Sessions are stored in a `.claude-mcp-session` file within the workFolder.
 * Sessions expire after a configurable TTL (default 24 hours).
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { debugLog } from './utils.js';

/**
 * Session data structure stored in the session file
 */
export interface SessionData {
  sessionId: string;
  createdAt: number; // Unix timestamp in milliseconds
  lastUsedAt: number; // Unix timestamp in milliseconds
}

/**
 * Options for SessionManager
 */
export interface SessionManagerOptions {
  /** Time-to-live in milliseconds (default: 24 hours) */
  ttlMs?: number;
  /** Session file name (default: .claude-mcp-session) */
  sessionFileName?: string;
}

// Default TTL: 24 hours
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SESSION_FILE_NAME = '.claude-mcp-session';

/**
 * Manages session persistence for a specific workFolder.
 * Each workFolder has its own session file.
 */
export class SessionManager {
  private ttlMs: number;
  private sessionFileName: string;

  constructor(options?: SessionManagerOptions) {
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    this.sessionFileName = options?.sessionFileName ?? DEFAULT_SESSION_FILE_NAME;
  }

  /**
   * Get the session file path for a given workFolder
   */
  getSessionFilePath(workFolder: string): string {
    return join(workFolder, this.sessionFileName);
  }

  /**
   * Load session data from a workFolder's session file
   * Returns null if no valid session exists
   */
  loadSession(workFolder: string): SessionData | null {
    const sessionFilePath = this.getSessionFilePath(workFolder);

    if (!existsSync(sessionFilePath)) {
      debugLog(`[SessionManager] No session file found at ${sessionFilePath}`);
      return null;
    }

    try {
      const fileContent = readFileSync(sessionFilePath, 'utf-8');
      const sessionData: SessionData = JSON.parse(fileContent);

      // Validate session data structure
      if (!sessionData.sessionId || typeof sessionData.createdAt !== 'number' || typeof sessionData.lastUsedAt !== 'number') {
        debugLog(`[SessionManager] Invalid session data structure in ${sessionFilePath}`);
        this.deleteSession(workFolder);
        return null;
      }

      // Check if session has expired
      const now = Date.now();
      if (now - sessionData.createdAt > this.ttlMs) {
        debugLog(`[SessionManager] Session expired (created ${new Date(sessionData.createdAt).toISOString()}, TTL: ${this.ttlMs}ms)`);
        this.deleteSession(workFolder);
        return null;
      }

      debugLog(`[SessionManager] Loaded session ${sessionData.sessionId} from ${sessionFilePath}`);
      return sessionData;
    } catch (error: any) {
      debugLog(`[SessionManager] Failed to load session from ${sessionFilePath}: ${error.message}`);
      // Delete corrupted session file
      this.deleteSession(workFolder);
      return null;
    }
  }

  /**
   * Save session data to a workFolder's session file
   */
  saveSession(workFolder: string, sessionData: SessionData): void {
    const sessionFilePath = this.getSessionFilePath(workFolder);

    try {
      const content = JSON.stringify(sessionData, null, 2);
      writeFileSync(sessionFilePath, content, 'utf-8');
      debugLog(`[SessionManager] Saved session ${sessionData.sessionId} to ${sessionFilePath}`);
    } catch (error: any) {
      debugLog(`[SessionManager] Failed to save session to ${sessionFilePath}: ${error.message}`);
      // Don't throw - session persistence is best-effort
      console.error(`[SessionManager] Warning: Could not save session file: ${error.message}`);
    }
  }

  /**
   * Delete a session file for a workFolder
   */
  deleteSession(workFolder: string): void {
    const sessionFilePath = this.getSessionFilePath(workFolder);

    if (existsSync(sessionFilePath)) {
      try {
        unlinkSync(sessionFilePath);
        debugLog(`[SessionManager] Deleted session file at ${sessionFilePath}`);
      } catch (error: any) {
        debugLog(`[SessionManager] Failed to delete session file at ${sessionFilePath}: ${error.message}`);
      }
    }
  }

  /**
   * Get or create a session for a workFolder.
   * If a valid session exists, updates lastUsedAt and returns it.
   * If no valid session exists, creates a new one.
   */
  getOrCreateSession(workFolder: string): SessionData {
    let sessionData = this.loadSession(workFolder);

    if (sessionData) {
      // Update lastUsedAt
      sessionData.lastUsedAt = Date.now();
      this.saveSession(workFolder, sessionData);
      return sessionData;
    }

    // Create new session
    const now = Date.now();
    sessionData = {
      sessionId: randomUUID(),
      createdAt: now,
      lastUsedAt: now,
    };

    this.saveSession(workFolder, sessionData);
    debugLog(`[SessionManager] Created new session ${sessionData.sessionId} for ${workFolder}`);

    return sessionData;
  }

  /**
   * Update the lastUsedAt timestamp for an existing session
   */
  touchSession(workFolder: string): void {
    const sessionData = this.loadSession(workFolder);
    if (sessionData) {
      sessionData.lastUsedAt = Date.now();
      this.saveSession(workFolder, sessionData);
    }
  }

  /**
   * Check if a session is still valid (not expired)
   */
  isSessionValid(sessionData: SessionData): boolean {
    const now = Date.now();
    return now - sessionData.createdAt <= this.ttlMs;
  }

  /**
   * Get the TTL in milliseconds
   */
  getTtlMs(): number {
    return this.ttlMs;
  }
}
