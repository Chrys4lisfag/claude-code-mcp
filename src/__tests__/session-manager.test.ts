import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:fs
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

// Mock node:crypto
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('node:crypto');
  return {
    ...actual,
    randomUUID: vi.fn(),
  };
});

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { SessionManager, type SessionData } from '../session-manager.js';

describe('SessionManager', () => {
  let mockExistsSync: ReturnType<typeof vi.mocked<typeof existsSync>>;
  let mockReadFileSync: ReturnType<typeof vi.mocked<typeof readFileSync>>;
  let mockWriteFileSync: ReturnType<typeof vi.mocked<typeof writeFileSync>>;
  let mockUnlinkSync: ReturnType<typeof vi.mocked<typeof unlinkSync>>;
  let mockRandomUUID: ReturnType<typeof vi.mocked<typeof randomUUID>>;

  beforeEach(async () => {
    const fs = await import('node:fs');
    mockExistsSync = vi.mocked(fs.existsSync);
    mockReadFileSync = vi.mocked(fs.readFileSync);
    mockWriteFileSync = vi.mocked(fs.writeFileSync);
    mockUnlinkSync = vi.mocked(fs.unlinkSync);

    const crypto = await import('node:crypto');
    mockRandomUUID = vi.mocked(crypto.randomUUID);

    // Clear all mocks
    vi.clearAllMocks();

    // Default mock implementations
    mockExistsSync.mockReturnValue(false);
    mockRandomUUID.mockReturnValue('test-uuid-1234-5678-9012-abcd-efgh' as `${string}-${string}-${string}-${string}-${string}`);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should use default TTL when not specified', () => {
      const manager = new SessionManager();
      expect(manager.getTtlMs()).toBe(24 * 60 * 60 * 1000); // 24 hours
    });

    it('should use custom TTL when specified', () => {
      const customTtl = 1000 * 60 * 60; // 1 hour
      const manager = new SessionManager({ ttlMs: customTtl });
      expect(manager.getTtlMs()).toBe(customTtl);
    });

    it('should use default session file name', () => {
      const manager = new SessionManager();
      const result = manager.getSessionFilePath('/test/folder');
      // Check that it contains the session file name (path separators vary by OS)
      expect(result).toContain('.claude-mcp-session');
      expect(result).toContain('test');
      expect(result).toContain('folder');
    });

    it('should use custom session file name when specified', () => {
      const manager = new SessionManager({ sessionFileName: '.my-session' });
      const result = manager.getSessionFilePath('/test/folder');
      expect(result).toContain('.my-session');
    });
  });

  describe('getSessionFilePath', () => {
    it('should return correct path for workFolder', () => {
      const manager = new SessionManager();
      const result = manager.getSessionFilePath('/home/user/project');
      expect(result).toContain('.claude-mcp-session');
      expect(result).toContain('home');
      expect(result).toContain('user');
      expect(result).toContain('project');
    });

    it('should handle Windows-style paths', () => {
      const manager = new SessionManager();
      // Note: join() will normalize the path based on the OS
      const result = manager.getSessionFilePath('C:\\Users\\test');
      expect(result).toContain('.claude-mcp-session');
    });
  });

  describe('loadSession', () => {
    it('should return null when session file does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const manager = new SessionManager();

      const result = manager.loadSession('/test/folder');

      expect(result).toBeNull();
      // Check that existsSync was called with a path containing the session file name
      expect(mockExistsSync).toHaveBeenCalled();
      const calledPath = mockExistsSync.mock.calls[0][0] as string;
      expect(calledPath).toContain('.claude-mcp-session');
    });

    it('should load and return valid session data', () => {
      const now = Date.now();
      const sessionData: SessionData = {
        sessionId: 'existing-session-id',
        createdAt: now - 1000, // Created 1 second ago
        lastUsedAt: now - 500,
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(sessionData));

      const manager = new SessionManager();
      const result = manager.loadSession('/test/folder');

      expect(result).toEqual(sessionData);
    });

    it('should return null and delete expired session', () => {
      const ttlMs = 1000 * 60; // 1 minute
      const sessionData: SessionData = {
        sessionId: 'expired-session-id',
        createdAt: Date.now() - ttlMs - 1000, // Created more than TTL ago
        lastUsedAt: Date.now() - 1000,
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(sessionData));

      const manager = new SessionManager({ ttlMs });
      const result = manager.loadSession('/test/folder');

      expect(result).toBeNull();
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('should return null and delete corrupted session file', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('not valid json');

      const manager = new SessionManager();
      const result = manager.loadSession('/test/folder');

      expect(result).toBeNull();
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('should return null and delete session with invalid structure', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ invalid: 'data' }));

      const manager = new SessionManager();
      const result = manager.loadSession('/test/folder');

      expect(result).toBeNull();
      expect(mockUnlinkSync).toHaveBeenCalled();
    });
  });

  describe('saveSession', () => {
    it('should write session data to file', () => {
      const sessionData: SessionData = {
        sessionId: 'new-session-id',
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      };

      const manager = new SessionManager();
      manager.saveSession('/test/folder', sessionData);

      // Check that writeFileSync was called with correct content structure
      expect(mockWriteFileSync).toHaveBeenCalled();
      const calledPath = mockWriteFileSync.mock.calls[0][0] as string;
      const calledContent = mockWriteFileSync.mock.calls[0][1] as string;
      const calledEncoding = mockWriteFileSync.mock.calls[0][2];

      expect(calledPath).toContain('.claude-mcp-session');
      expect(calledContent).toBe(JSON.stringify(sessionData, null, 2));
      expect(calledEncoding).toBe('utf-8');
    });

    it('should not throw when write fails', () => {
      mockWriteFileSync.mockImplementation(() => {
        throw new Error('Write failed');
      });

      const manager = new SessionManager();
      const sessionData: SessionData = {
        sessionId: 'new-session-id',
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      };

      // Should not throw
      expect(() => manager.saveSession('/test/folder', sessionData)).not.toThrow();
    });
  });

  describe('deleteSession', () => {
    it('should delete session file when it exists', () => {
      mockExistsSync.mockReturnValue(true);

      const manager = new SessionManager();
      manager.deleteSession('/test/folder');

      expect(mockUnlinkSync).toHaveBeenCalled();
      const calledPath = mockUnlinkSync.mock.calls[0][0] as string;
      expect(calledPath).toContain('.claude-mcp-session');
    });

    it('should not throw when file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const manager = new SessionManager();
      expect(() => manager.deleteSession('/test/folder')).not.toThrow();
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it('should not throw when delete fails', () => {
      mockExistsSync.mockReturnValue(true);
      mockUnlinkSync.mockImplementation(() => {
        throw new Error('Delete failed');
      });

      const manager = new SessionManager();
      expect(() => manager.deleteSession('/test/folder')).not.toThrow();
    });
  });

  describe('getOrCreateSession', () => {
    it('should create new session when no existing session', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      mockExistsSync.mockReturnValue(false);
      mockRandomUUID.mockReturnValue('new-gene-rate-uuid-1234-5678' as `${string}-${string}-${string}-${string}-${string}`);

      const manager = new SessionManager();
      const result = manager.getOrCreateSession('/test/folder');

      expect(result.sessionId).toBe('new-gene-rate-uuid-1234-5678');
      expect(result.createdAt).toBe(now);
      expect(result.lastUsedAt).toBe(now);
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('should return existing valid session and update lastUsedAt', () => {
      const originalTime = Date.now() - 1000;
      const currentTime = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(currentTime);

      const existingSession: SessionData = {
        sessionId: 'existing-session-id',
        createdAt: originalTime - 5000,
        lastUsedAt: originalTime,
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(existingSession));

      const manager = new SessionManager();
      const result = manager.getOrCreateSession('/test/folder');

      expect(result.sessionId).toBe('existing-session-id');
      expect(result.lastUsedAt).toBe(currentTime);
      expect(mockWriteFileSync).toHaveBeenCalled(); // Should save updated lastUsedAt
    });
  });

  describe('touchSession', () => {
    it('should update lastUsedAt for existing session', () => {
      const currentTime = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(currentTime);

      const existingSession: SessionData = {
        sessionId: 'existing-session-id',
        createdAt: currentTime - 10000,
        lastUsedAt: currentTime - 5000,
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(existingSession));

      const manager = new SessionManager();
      manager.touchSession('/test/folder');

      expect(mockWriteFileSync).toHaveBeenCalled();
      const calledContent = mockWriteFileSync.mock.calls[0][1] as string;
      expect(calledContent).toContain(`"lastUsedAt": ${currentTime}`);
    });

    it('should do nothing when session does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const manager = new SessionManager();
      manager.touchSession('/test/folder');

      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });

  describe('isSessionValid', () => {
    it('should return true for session within TTL', () => {
      const manager = new SessionManager({ ttlMs: 60000 }); // 1 minute
      const session: SessionData = {
        sessionId: 'test',
        createdAt: Date.now() - 30000, // 30 seconds ago
        lastUsedAt: Date.now(),
      };

      expect(manager.isSessionValid(session)).toBe(true);
    });

    it('should return false for expired session', () => {
      const manager = new SessionManager({ ttlMs: 60000 }); // 1 minute
      const session: SessionData = {
        sessionId: 'test',
        createdAt: Date.now() - 120000, // 2 minutes ago
        lastUsedAt: Date.now(),
      };

      expect(manager.isSessionValid(session)).toBe(false);
    });
  });
});
