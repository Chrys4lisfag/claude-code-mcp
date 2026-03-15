import { tmpdir } from "node:os";
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Mock Claude CLI for testing
 * This creates a fake Claude CLI that can be used during testing
 */
export class ClaudeMock {
  private mockPath: string;
  private responses = new Map<string, string>();

  constructor(binaryName: string = 'claude') {
    // Always use /tmp directory for mocks in tests
    this.mockPath = join(tmpdir(), 'claude-code-test-mock', binaryName);
  }

  /**
   * Setup the mock Claude CLI
   */
  async setup(): Promise<void> {
    const dir = dirname(this.mockPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Create a simple JS script that echoes responses
    const mockScript = `#!/usr/bin/env node
// Mock Claude CLI for testing

const args = process.argv.slice(2);
let prompt = "";
let verbose = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '-p' || args[i] === '--prompt') {
    prompt = args[i + 1] || "";
    i++; // Skip next argument as it's the prompt value
  } else if (args[i] === '--verbose') {
    verbose = true;
  } else if (args[i] === '--version') {
    console.log("Mock Claude CLI v1.0.0");
    process.exit(0);
  }
}

if (prompt.includes("create") || prompt.includes("Create")) {
  console.log("Created file successfully");
} else if (prompt.includes("git") && prompt.includes("commit")) {
  console.log("Committed changes successfully");
} else if (prompt.includes("error")) {
  console.error("Error: Mock error response");
  process.exit(1);
} else {
  console.log("Command executed successfully");
}
`;

    writeFileSync(this.mockPath, mockScript);
    
    // Create Windows wrapper
    if (process.platform === 'win32') {
      const fileName = this.mockPath.split(/[\\\\/]/).pop();
      writeFileSync(this.mockPath + '.cmd', `@node "%~dp0\\${fileName}" %*`);
    }

    writeFileSync(this.mockPath, mockScript);
    // Make executable
    const { chmod } = await import('node:fs/promises');
    await chmod(this.mockPath, 0o755);
  }

  /**
   * Cleanup the mock Claude CLI
   */
  async cleanup(): Promise<void> {
    const { rm } = await import('node:fs/promises');
    await rm(this.mockPath, { force: true });
    if (process.platform === 'win32') {
      await rm(this.mockPath + '.cmd', { force: true });
    }
  }

  /**
   * Add a mock response for a specific prompt pattern
   */
  addResponse(pattern: string, response: string): void {
    this.responses.set(pattern, response);
  }
}