import { tmpdir } from "node:os";
import { ClaudeMock } from './claude-mock.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

let sharedMock: ClaudeMock | null = null;
let mockName: string | null = null;

export async function getSharedMock(): Promise<ClaudeMock> {
  if (!sharedMock) {
    mockName = `claudeMocked-${randomUUID()}`;
    sharedMock = new ClaudeMock(mockName);
  }
  
  // Always ensure mock exists
  const mockPath = join(tmpdir(), 'claude-code-test-mock', mockName!);
  if (!existsSync(mockPath)) {
    console.error(`[DEBUG] Mock not found at ${mockPath}, creating it...`);
    await sharedMock.setup();
  } else {
    console.error(`[DEBUG] Mock already exists at ${mockPath}`);
  }
  
  return sharedMock;
}

export async function cleanupSharedMock(): Promise<void> {
  if (sharedMock) {
    await sharedMock.cleanup();
    sharedMock = null;
  }
}