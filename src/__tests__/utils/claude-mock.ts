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

  public readonly binaryName: string;

  constructor(binaryName: string = 'claude') {
    this.binaryName = binaryName;
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
let outputFormat = "text";
let inputFormat = "text";

for (let i = 0; i < args.length; i++) {
  if (args[i] === '-p' || args[i] === '--prompt') {
    prompt = args[i + 1] || "";
    i++;
  } else if (args[i] === '--verbose') {
    verbose = true;
  } else if (args[i] === '--version') {
    console.log("Mock Claude CLI v1.0.0");
    process.exit(0);
  } else if (args[i] === '--output-format') {
    outputFormat = args[i + 1];
    i++;
  } else if (args[i] === '--input-format') {
    inputFormat = args[i + 1];
    i++;
  }
}

function handlePrompt(p) {
  let resultText = "Command executed successfully";
  if (p.includes("create") || p.includes("Create")) {
    resultText = "Created file successfully";
  } else if (p.includes("git") && p.includes("commit")) {
    resultText = "Committed changes successfully";
  } else if (p.includes("error")) {
    console.error("Error: Mock error response");
    process.exit(1);
  }
  
  if (outputFormat === "stream-json") {
    const msg = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: resultText }],
        stop_reason: 'end_turn',
      }
    };
    console.log(JSON.stringify(msg));
  } else {
    console.log(resultText);
  }
}

if (inputFormat === "stream-json" && !prompt) {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });
  rl.on('line', (line) => {
    try {
      const inputObj = JSON.parse(line);
      if (inputObj && inputObj.message && inputObj.message.content) {
        handlePrompt(inputObj.message.content);
      }
    } catch (e) {
      console.error("Failed to parse input json");
    }
  });
} else {
  handlePrompt(prompt);
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