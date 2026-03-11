/**
 * ProcessManager handles spawning and managing a long-running Claude CLI process
 * using stream-json mode for NDJSON communication.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { createInterface, Interface as ReadlineInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { debugLog } from './utils.js';

/**
 * Claude CLI stream-json message types
 * Based on Claude CLI's streaming JSON output format
 */
export interface ClaudeStreamMessage {
  type: 'assistant' | 'user' | 'system' | 'result';
  subtype?: 'init' | 'progress' | string;
  message?: {
    id?: string;
    type?: string;
    role?: string;
    model?: string;
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: any;
    }>;
    stop_reason?: string;
    stop_sequence?: string | null;
  };
  session_id?: string;
  is_partial?: boolean;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  result?: string;
  cost_usd?: number;
  total_cost_usd?: number;
}

/**
 * Input message format for stream-json mode
 */
export interface ClaudeStreamInput {
  type: 'user';
  message: {
    role: 'user';
    content: string;
  };
}

/**
 * Options for ProcessManager
 */
export interface ProcessManagerOptions {
  /** Path to the Claude CLI executable */
  claudeCliPath: string;
  /** Working directory for the CLI process */
  workFolder: string;
  /** Session ID for conversation continuity */
  sessionId: string;
  /** Timeout for individual operations in milliseconds */
  timeoutMs?: number;
  /** Callback for when process crashes or exits unexpectedly */
  onProcessExit?: (code: number | null, signal: string | null) => void;
}

// Default timeout: 60 minutes
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Manages a long-running Claude CLI process with stream-json I/O.
 */
export class ProcessManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private readline: ReadlineInterface | null = null;
  private claudeCliPath: string;
  private workFolder: string;
  private sessionId: string;
  private timeoutMs: number;
  private onProcessExit?: (code: number | null, signal: string | null) => void;
  private isRunning: boolean = false;
  private pendingRequest: {
    resolve: (result: string) => void;
    reject: (error: Error) => void;
    accumulatedText: string;
    timeoutHandle: NodeJS.Timeout | null;
  } | null = null;
  private stderrBuffer: string = '';

  constructor(options: ProcessManagerOptions) {
    super();
    this.claudeCliPath = options.claudeCliPath;
    this.workFolder = options.workFolder;
    this.sessionId = options.sessionId;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onProcessExit = options.onProcessExit;
  }

  /**
   * Get the current working folder
   */
  getWorkFolder(): string {
    return this.workFolder;
  }

  /**
   * Get the session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Check if the process is currently running
   */
  isProcessRunning(): boolean {
    return this.isRunning && this.process !== null && !this.process.killed;
  }

  /**
   * Start the Claude CLI process in stream-json mode
   */
  async start(): Promise<void> {
    if (this.isProcessRunning()) {
      debugLog('[ProcessManager] Process already running');
      return;
    }

    const args = [
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--session-id', this.sessionId,
      '--dangerously-skip-permissions',
    ];

    debugLog(`[ProcessManager] Starting Claude CLI: ${this.claudeCliPath} ${args.join(' ')}`);
    debugLog(`[ProcessManager] Working directory: ${this.workFolder}`);

    try {
      this.process = spawn(this.claudeCliPath, args, {
        cwd: this.workFolder,
        stdio: ['pipe', 'pipe', 'pipe'],
        // On Windows, we need shell: false for proper stdin handling
        shell: false,
      });

      if (!this.process.stdout || !this.process.stdin || !this.process.stderr) {
        throw new Error('Failed to create process with required stdio streams');
      }

      this.isRunning = true;
      this.stderrBuffer = '';

      // Set up readline for NDJSON parsing from stdout
      this.readline = createInterface({
        input: this.process.stdout,
        crlfDelay: Infinity,
      });

      this.readline.on('line', (line: string) => {
        this.handleOutputLine(line);
      });

      // Handle stderr (for debugging/errors)
      this.process.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        this.stderrBuffer += text;
        debugLog(`[ProcessManager] stderr: ${text.trim()}`);
      });

      // Handle process exit
      this.process.on('close', (code: number | null, signal: string | null) => {
        debugLog(`[ProcessManager] Process exited with code ${code}, signal ${signal}`);
        this.handleProcessExit(code, signal);
      });

      this.process.on('error', (error: Error) => {
        debugLog(`[ProcessManager] Process error: ${error.message}`);
        this.handleProcessError(error);
      });

      // Wait a short moment to ensure process started correctly
      await new Promise<void>((resolve, reject) => {
        const startupTimeout = setTimeout(() => {
          if (this.isProcessRunning()) {
            resolve();
          } else {
            reject(new Error('Process failed to start within timeout'));
          }
        }, 1000);

        // Check if process exited immediately (error case)
        this.process!.once('exit', (code) => {
          clearTimeout(startupTimeout);
          if (code !== 0 && code !== null) {
            reject(new Error(`Process exited immediately with code ${code}. Stderr: ${this.stderrBuffer}`));
          }
        });

        // If no immediate exit, resolve after a brief moment
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            clearTimeout(startupTimeout);
            resolve();
          }
        }, 100);
      });

      debugLog('[ProcessManager] Process started successfully');
    } catch (error: any) {
      this.isRunning = false;
      this.process = null;
      throw new Error(`Failed to start Claude CLI process: ${error.message}`);
    }
  }

  /**
   * Send a prompt to the Claude CLI and wait for the complete response
   */
  async sendPrompt(prompt: string): Promise<string> {
    if (!this.isProcessRunning()) {
      throw new Error('Process is not running. Call start() first.');
    }

    if (this.pendingRequest) {
      throw new Error('A request is already pending. Wait for it to complete first.');
    }

    return new Promise<string>((resolve, reject) => {
      // Set up the pending request
      this.pendingRequest = {
        resolve,
        reject,
        accumulatedText: '',
        timeoutHandle: null,
      };

      // Set up timeout
      this.pendingRequest.timeoutHandle = setTimeout(() => {
        if (this.pendingRequest) {
          const error = new Error(`Request timed out after ${this.timeoutMs}ms`);
          this.pendingRequest.reject(error);
          this.pendingRequest = null;
        }
      }, this.timeoutMs);

      // Create the input message
      const inputMessage: ClaudeStreamInput = {
        type: 'user',
        message: {
          role: 'user',
          content: prompt,
        },
      };

      const jsonLine = JSON.stringify(inputMessage) + '\n';
      debugLog(`[ProcessManager] Sending: ${jsonLine.trim()}`);

      // Write to stdin
      try {
        this.process!.stdin!.write(jsonLine, (error) => {
          if (error) {
            debugLog(`[ProcessManager] Write error: ${error.message}`);
            if (this.pendingRequest) {
              clearTimeout(this.pendingRequest.timeoutHandle!);
              this.pendingRequest.reject(error);
              this.pendingRequest = null;
            }
          }
        });
      } catch (error: any) {
        if (this.pendingRequest) {
          clearTimeout(this.pendingRequest.timeoutHandle!);
          this.pendingRequest.reject(error);
          this.pendingRequest = null;
        }
      }
    });
  }

  /**
   * Handle a line of NDJSON output from the process
   */
  private handleOutputLine(line: string): void {
    if (!line.trim()) {
      return;
    }

    debugLog(`[ProcessManager] Received line: ${line.substring(0, 200)}${line.length > 200 ? '...' : ''}`);

    try {
      const message: ClaudeStreamMessage = JSON.parse(line);
      this.processMessage(message);
    } catch (error: any) {
      debugLog(`[ProcessManager] Failed to parse JSON line: ${error.message}`);
      // Non-JSON output, could be startup messages or errors
      // Just log it and continue
    }
  }

  /**
   * Process a parsed Claude stream message
   */
  private processMessage(message: ClaudeStreamMessage): void {
    debugLog(`[ProcessManager] Processing message type: ${message.type}, subtype: ${message.subtype}, is_partial: ${message.is_partial}`);

    if (!this.pendingRequest) {
      // No pending request, might be initialization message
      debugLog('[ProcessManager] Received message but no pending request');
      return;
    }

    // Handle assistant messages - accumulate text content
    if (message.type === 'assistant' && message.message?.content) {
      for (const block of message.message.content) {
        if (block.type === 'text' && block.text) {
          // For partial messages, we're building up the text
          // For non-partial messages, we have the complete text
          if (message.is_partial) {
            // Partial message - just accumulate but don't finalize
            this.pendingRequest.accumulatedText = block.text;
          } else {
            // Complete message - use this as the final text
            this.pendingRequest.accumulatedText = block.text;
          }
        }
      }

      // Check if this is the final message (has stop_reason)
      if (message.message.stop_reason) {
        debugLog(`[ProcessManager] Assistant turn complete (stop_reason: ${message.message.stop_reason})`);
        this.completeRequest();
      }
    }

    // Handle result message - this indicates the turn is complete
    if (message.type === 'result') {
      debugLog(`[ProcessManager] Received result message: ${message.result}`);
      // If we have accumulated text, use that. Otherwise use the result field.
      if (!this.pendingRequest.accumulatedText && message.result) {
        this.pendingRequest.accumulatedText = message.result;
      }
      this.completeRequest();
    }

    // Handle system messages
    if (message.type === 'system') {
      debugLog(`[ProcessManager] System message: ${JSON.stringify(message)}`);
      // System messages typically don't end a turn
    }
  }

  /**
   * Complete the pending request with accumulated text
   */
  private completeRequest(): void {
    if (!this.pendingRequest) {
      return;
    }

    const { resolve, accumulatedText, timeoutHandle } = this.pendingRequest;

    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    this.pendingRequest = null;
    resolve(accumulatedText);
  }

  /**
   * Handle process exit
   */
  private handleProcessExit(code: number | null, signal: string | null): void {
    this.isRunning = false;
    this.process = null;

    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }

    // Reject any pending request
    if (this.pendingRequest) {
      const error = new Error(`Process exited unexpectedly with code ${code}, signal ${signal}. Stderr: ${this.stderrBuffer}`);
      if (this.pendingRequest.timeoutHandle) {
        clearTimeout(this.pendingRequest.timeoutHandle);
      }
      this.pendingRequest.reject(error);
      this.pendingRequest = null;
    }

    // Notify callback
    if (this.onProcessExit) {
      this.onProcessExit(code, signal);
    }

    this.emit('exit', code, signal);
  }

  /**
   * Handle process error
   */
  private handleProcessError(error: Error): void {
    debugLog(`[ProcessManager] Process error: ${error.message}`);

    // Reject any pending request
    if (this.pendingRequest) {
      if (this.pendingRequest.timeoutHandle) {
        clearTimeout(this.pendingRequest.timeoutHandle);
      }
      this.pendingRequest.reject(error);
      this.pendingRequest = null;
    }

    this.emit('error', error);
  }

  /**
   * Stop the process gracefully
   */
  async stop(): Promise<void> {
    if (!this.process) {
      debugLog('[ProcessManager] No process to stop');
      return;
    }

    debugLog('[ProcessManager] Stopping process');

    const currentProcess = this.process;
    if (!currentProcess) {
      return;
    }

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown fails
        if (currentProcess && !currentProcess.killed) {
          debugLog('[ProcessManager] Force killing process');
          currentProcess.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      currentProcess.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });

      // Close stdin to signal we're done
      if (currentProcess.stdin) {
        currentProcess.stdin.end();
      }

      // Send SIGTERM for graceful shutdown
      currentProcess.kill('SIGTERM');
    });
  }

  /**
   * Kill the process immediately
   */
  kill(): void {
    if (this.process && !this.process.killed) {
      debugLog('[ProcessManager] Killing process');
      this.process.kill('SIGKILL');
    }
  }

  /**
   * Restart the process (stop and start)
   */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /**
   * Update the working folder (requires restart)
   */
  async setWorkFolder(workFolder: string): Promise<void> {
    if (workFolder !== this.workFolder) {
      this.workFolder = workFolder;
      if (this.isProcessRunning()) {
        debugLog(`[ProcessManager] Work folder changed to ${workFolder}, restarting process`);
        await this.restart();
      }
    }
  }

  /**
   * Update the session ID (requires restart)
   */
  async setSessionId(sessionId: string): Promise<void> {
    if (sessionId !== this.sessionId) {
      this.sessionId = sessionId;
      if (this.isProcessRunning()) {
        debugLog(`[ProcessManager] Session ID changed to ${sessionId}, restarting process`);
        await this.restart();
      }
    }
  }

  /**
   * Get accumulated stderr output
   */
  getStderrBuffer(): string {
    return this.stderrBuffer;
  }
}

/**
 * Pool of ProcessManager instances, keyed by workFolder.
 * This allows reusing persistent processes for the same workFolder.
 */
export class ProcessManagerPool {
  private managers: Map<string, ProcessManager> = new Map();
  private claudeCliPath: string;
  private timeoutMs: number;
  private getSessionId: (workFolder: string) => string;

  constructor(
    claudeCliPath: string,
    getSessionId: (workFolder: string) => string,
    timeoutMs?: number
  ) {
    this.claudeCliPath = claudeCliPath;
    this.getSessionId = getSessionId;
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Get or create a ProcessManager for the given workFolder
   */
  async getManager(workFolder: string): Promise<ProcessManager> {
    let manager = this.managers.get(workFolder);

    if (manager && manager.isProcessRunning()) {
      debugLog(`[ProcessManagerPool] Reusing existing manager for ${workFolder}`);
      return manager;
    }

    // Create new manager
    const sessionId = this.getSessionId(workFolder);
    manager = new ProcessManager({
      claudeCliPath: this.claudeCliPath,
      workFolder,
      sessionId,
      timeoutMs: this.timeoutMs,
      onProcessExit: (code, signal) => {
        debugLog(`[ProcessManagerPool] Manager for ${workFolder} exited (code: ${code}, signal: ${signal})`);
        // Remove from pool on exit
        this.managers.delete(workFolder);
      },
    });

    await manager.start();
    this.managers.set(workFolder, manager);

    debugLog(`[ProcessManagerPool] Created new manager for ${workFolder}`);
    return manager;
  }

  /**
   * Stop and remove a specific manager
   */
  async removeManager(workFolder: string): Promise<void> {
    const manager = this.managers.get(workFolder);
    if (manager) {
      await manager.stop();
      this.managers.delete(workFolder);
    }
  }

  /**
   * Stop all managers
   */
  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.managers.values()).map((m) => m.stop());
    await Promise.all(stopPromises);
    this.managers.clear();
  }

  /**
   * Get all active workFolders
   */
  getActiveWorkFolders(): string[] {
    return Array.from(this.managers.keys());
  }

  /**
   * Get the number of active managers
   */
  getActiveCount(): number {
    return this.managers.size;
  }
}
