import { getSharedMock } from './persistent-mock.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function verifyMockExists(binaryName: string): boolean {
  const mockPath = join('/tmp', 'claude-code-test-mock', binaryName);
  return existsSync(mockPath);
}

export async function ensureMockExists(mockArg?: any): Promise<void> {
  const mockObj = mockArg || await getSharedMock();
  if (!verifyMockExists(mockObj.binaryName)) {
    await mockObj.setup();
  }
}