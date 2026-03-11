import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter, Readable, Writable } from 'node:stream';

// Mock node:child_process
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('node:child_process');
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

import { spawn, ChildProcess } from 'node:child_process';
import { ProcessManager, ProcessManagerPool, type ClaudeStreamMessage } from '../process-manager.js';

// Helper to create a mock process with proper stream types
function createMockProcess(): {
  process: any;
  stdin: Writable & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: Readable;
  stderr: Readable;
  processEmitter: EventEmitter;
} {
  // Create proper readable streams for stdout/stderr
  const stdout = new Readable({
    read() {} // No-op read function required by Readable
  });
  const stderr = new Readable({
    read() {}
  });

  // Create a mock stdin
  const stdinInternal = {
    write: vi.fn((data: string | Buffer, callback?: (err?: Error | null) => void) => {
      if (callback) callback(null);
      return true;
    }),
    end: vi.fn(),
  };

  const processEmitter = new EventEmitter();

  const mockProcess = {
    stdin: stdinInternal,
    stdout,
    stderr,
    kill: vi.fn(() => {
      (mockProcess as any).killed = true;
    }),
    killed: false,
    pid: 12345,
    on: processEmitter.on.bind(processEmitter),
    once: processEmitter.once.bind(processEmitter),
    emit: processEmitter.emit.bind(processEmitter),
    removeListener: processEmitter.removeListener.bind(processEmitter),
    removeAllListeners: processEmitter.removeAllListeners.bind(processEmitter),
  };

  return {
    process: mockProcess,
    stdin: stdinInternal as any,
    stdout,
    stderr,
    processEmitter,
  };
}

describe('ProcessManager', () => {
  let mockSpawn: ReturnType<typeof vi.mocked<typeof spawn>>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const childProcess = await import('node:child_process');
    mockSpawn = vi.mocked(childProcess.spawn);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with provided options', () => {
      const manager = new ProcessManager({
        claudeCliPath: '/test/claude',
        workFolder: '/test/work',
        sessionId: 'test-session-id',
        timeoutMs: 5000,
      });

      expect(manager.getWorkFolder()).toBe('/test/work');
      expect(manager.getSessionId()).toBe('test-session-id');
      expect(manager.isProcessRunning()).toBe(false);
    });

    it('should use default timeout when not specified', () => {
      const manager = new ProcessManager({
        claudeCliPath: '/test/claude',
        workFolder: '/test/work',
        sessionId: 'test-session-id',
      });

      expect(manager.getWorkFolder()).toBe('/test/work');
    });
  });

  describe('start', () => {
    it('should spawn process with correct arguments', async () => {
      const { process: mockProcess } = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess as any);

      const manager = new ProcessManager({
        claudeCliPath: '/test/claude',
        workFolder: '/test/work',
        sessionId: 'test-session-id',
      });

      // Start the process
      const startPromise = manager.start();

      // Simulate successful startup
      await new Promise(resolve => setTimeout(resolve, 150));

      await startPromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        '/test/claude',
        [
          '--input-format', 'stream-json',
          '--output-format', 'stream-json',
          '--verbose',
          '--session-id', 'test-session-id',
          '--dangerously-skip-permissions',
        ],
        expect.objectContaining({
          cwd: '/test/work',
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
        })
      );

      expect(manager.isProcessRunning()).toBe(true);
    });

    it('should not start if already running', async () => {
      const { process: mockProcess } = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess as any);

      const manager = new ProcessManager({
        claudeCliPath: '/test/claude',
        workFolder: '/test/work',
        sessionId: 'test-session-id',
      });

      const startPromise = manager.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;

      // Try to start again
      await manager.start();

      // Should only have been called once
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('should handle process spawn error', async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('Spawn failed');
      });

      const manager = new ProcessManager({
        claudeCliPath: '/test/claude',
        workFolder: '/test/work',
        sessionId: 'test-session-id',
      });

      await expect(manager.start()).rejects.toThrow('Failed to start Claude CLI process: Spawn failed');
      expect(manager.isProcessRunning()).toBe(false);
    });
  });

  describe('sendPrompt', () => {
    it('should throw if process is not running', async () => {
      const manager = new ProcessManager({
        claudeCliPath: '/test/claude',
        workFolder: '/test/work',
        sessionId: 'test-session-id',
      });

      await expect(manager.sendPrompt('test prompt')).rejects.toThrow('Process is not running');
    });

    it('should write NDJSON to stdin', async () => {
      const { process: mockProcess, stdin, stdout } = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess as any);

      const manager = new ProcessManager({
        claudeCliPath: '/test/claude',
        workFolder: '/test/work',
        sessionId: 'test-session-id',
        timeoutMs: 5000,
      });

      // Start the process
      const startPromise = manager.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;

      // Send a prompt
      const promptPromise = manager.sendPrompt('test prompt');

      // Wait a tick for write to be called
      await new Promise(resolve => setImmediate(resolve));

      // Verify stdin.write was called with correct NDJSON
      expect(stdin.write).toHaveBeenCalled();
      const writeCall = stdin.write.mock.calls[0][0] as string;
      const parsedInput = JSON.parse(writeCall.trim());
      expect(parsedInput).toEqual({
        type: 'user',
        message: {
          role: 'user',
          content: 'test prompt',
        },
      });

      // Simulate a response via stdout
      const response: ClaudeStreamMessage = {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Hello!' }],
          stop_reason: 'end_turn',
        },
      };

      // Push the response as a line to stdout
      stdout.push(JSON.stringify(response) + '\n');

      const result = await promptPromise;
      expect(result).toBe('Hello!');
    });

    it('should handle timeout', async () => {
      const { process: mockProcess } = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess as any);

      const manager = new ProcessManager({
        claudeCliPath: '/test/claude',
        workFolder: '/test/work',
        sessionId: 'test-session-id',
        timeoutMs: 100, // Short timeout for test
      });

      const startPromise = manager.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;

      // Send a prompt but don't respond
      await expect(manager.sendPrompt('test prompt')).rejects.toThrow('timed out');
    });

    it('should reject if already has pending request', async () => {
      const { process: mockProcess } = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess as any);

      const manager = new ProcessManager({
        claudeCliPath: '/test/claude',
        workFolder: '/test/work',
        sessionId: 'test-session-id',
        timeoutMs: 5000,
      });

      const startPromise = manager.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;

      // Start first request (don't await)
      manager.sendPrompt('first prompt').catch(() => {}); // Ignore rejection

      // Wait a tick
      await new Promise(resolve => setImmediate(resolve));

      // Try second request
      await expect(manager.sendPrompt('second prompt')).rejects.toThrow('A request is already pending');
    });
  });

  describe('stop', () => {
    it('should close stdin and send SIGTERM', async () => {
      const { process: mockProcess, stdin, processEmitter } = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess as any);

      const manager = new ProcessManager({
        claudeCliPath: '/test/claude',
        workFolder: '/test/work',
        sessionId: 'test-session-id',
      });

      const startPromise = manager.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;

      // Start stop
      const stopPromise = manager.stop();

      // Simulate process close
      processEmitter.emit('close', 0, null);

      await stopPromise;

      expect(stdin.end).toHaveBeenCalled();
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('kill', () => {
    it('should send SIGKILL to process', async () => {
      const { process: mockProcess } = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess as any);

      const manager = new ProcessManager({
        claudeCliPath: '/test/claude',
        workFolder: '/test/work',
        sessionId: 'test-session-id',
      });

      const startPromise = manager.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;

      manager.kill();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });
  });

  describe('process exit handling', () => {
    it('should reject pending request when process exits', async () => {
      const { process: mockProcess, processEmitter } = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess as any);

      const manager = new ProcessManager({
        claudeCliPath: '/test/claude',
        workFolder: '/test/work',
        sessionId: 'test-session-id',
        timeoutMs: 5000,
      });

      const startPromise = manager.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;

      // Start a request
      const promptPromise = manager.sendPrompt('test prompt');

      // Wait a tick
      await new Promise(resolve => setImmediate(resolve));

      // Simulate process exit
      processEmitter.emit('close', 1, null);

      await expect(promptPromise).rejects.toThrow('Process exited unexpectedly');
    });

    it('should call onProcessExit callback', async () => {
      const { process: mockProcess, processEmitter } = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess as any);

      const onExitCallback = vi.fn();

      const manager = new ProcessManager({
        claudeCliPath: '/test/claude',
        workFolder: '/test/work',
        sessionId: 'test-session-id',
        onProcessExit: onExitCallback,
      });

      const startPromise = manager.start();
      await new Promise(resolve => setTimeout(resolve, 150));
      await startPromise;

      // Simulate process exit
      processEmitter.emit('close', 0, null);

      expect(onExitCallback).toHaveBeenCalledWith(0, null);
    });
  });
});

describe('ProcessManagerPool', () => {
  let mockSpawn: ReturnType<typeof vi.mocked<typeof spawn>>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const childProcess = await import('node:child_process');
    mockSpawn = vi.mocked(childProcess.spawn);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize empty pool', () => {
      const pool = new ProcessManagerPool(
        '/test/claude',
        () => 'session-id',
        5000
      );

      expect(pool.getActiveCount()).toBe(0);
      expect(pool.getActiveWorkFolders()).toEqual([]);
    });
  });

  describe('getManager', () => {
    it('should create new manager for new workFolder', async () => {
      const { process: mockProcess } = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess as any);

      const getSessionId = vi.fn().mockReturnValue('session-for-folder');
      const pool = new ProcessManagerPool('/test/claude', getSessionId, 5000);

      const managerPromise = pool.getManager('/test/work');

      // Wait for spawn
      await new Promise(resolve => setTimeout(resolve, 200));

      const manager = await managerPromise;

      expect(manager.getWorkFolder()).toBe('/test/work');
      expect(manager.getSessionId()).toBe('session-for-folder');
      expect(getSessionId).toHaveBeenCalledWith('/test/work');
      expect(pool.getActiveCount()).toBe(1);
      expect(pool.getActiveWorkFolders()).toContain('/test/work');
    });

    it('should reuse existing manager for same workFolder', async () => {
      const { process: mockProcess } = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess as any);

      const pool = new ProcessManagerPool('/test/claude', () => 'session-id', 5000);

      const managerPromise1 = pool.getManager('/test/work');
      await new Promise(resolve => setTimeout(resolve, 200));
      const manager1 = await managerPromise1;

      const manager2 = await pool.getManager('/test/work');

      expect(manager1).toBe(manager2);
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('should create different managers for different workFolders', async () => {
      const { process: mockProcess1 } = createMockProcess();
      const { process: mockProcess2 } = createMockProcess();
      mockSpawn
        .mockReturnValueOnce(mockProcess1 as any)
        .mockReturnValueOnce(mockProcess2 as any);

      const pool = new ProcessManagerPool('/test/claude', (wf) => `session-${wf}`, 5000);

      const manager1Promise = pool.getManager('/test/work1');
      await new Promise(resolve => setTimeout(resolve, 200));
      const manager1 = await manager1Promise;

      const manager2Promise = pool.getManager('/test/work2');
      await new Promise(resolve => setTimeout(resolve, 200));
      const manager2 = await manager2Promise;

      expect(manager1).not.toBe(manager2);
      expect(manager1.getWorkFolder()).toBe('/test/work1');
      expect(manager2.getWorkFolder()).toBe('/test/work2');
      expect(pool.getActiveCount()).toBe(2);
    });
  });

  describe('removeManager', () => {
    it('should stop and remove manager', async () => {
      const { process: mockProcess, processEmitter } = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess as any);

      const pool = new ProcessManagerPool('/test/claude', () => 'session-id', 5000);

      const managerPromise = pool.getManager('/test/work');
      await new Promise(resolve => setTimeout(resolve, 200));
      await managerPromise;

      expect(pool.getActiveCount()).toBe(1);

      // Start removal
      const removePromise = pool.removeManager('/test/work');

      // Simulate process close
      processEmitter.emit('close', 0, null);

      await removePromise;

      expect(pool.getActiveCount()).toBe(0);
    });

    it('should do nothing for non-existent manager', async () => {
      const pool = new ProcessManagerPool('/test/claude', () => 'session-id', 5000);

      await expect(pool.removeManager('/non/existent')).resolves.toBeUndefined();
    });
  });

  describe('stopAll', () => {
    it('should stop all managers', async () => {
      const { process: mockProcess1, processEmitter: emit1 } = createMockProcess();
      const { process: mockProcess2, processEmitter: emit2 } = createMockProcess();
      mockSpawn
        .mockReturnValueOnce(mockProcess1 as any)
        .mockReturnValueOnce(mockProcess2 as any);

      const pool = new ProcessManagerPool('/test/claude', () => 'session-id', 5000);

      const m1Promise = pool.getManager('/test/work1');
      await new Promise(resolve => setTimeout(resolve, 200));
      await m1Promise;

      const m2Promise = pool.getManager('/test/work2');
      await new Promise(resolve => setTimeout(resolve, 200));
      await m2Promise;

      expect(pool.getActiveCount()).toBe(2);

      // Start stopAll
      const stopPromise = pool.stopAll();

      // Simulate both processes closing
      emit1.emit('close', 0, null);
      emit2.emit('close', 0, null);

      await stopPromise;

      expect(pool.getActiveCount()).toBe(0);
    });
  });
});
