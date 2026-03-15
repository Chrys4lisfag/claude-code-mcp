import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

export class FileLogger {
  private logFilePath: string;

  constructor(workFolder: string) {
    this.logFilePath = join(workFolder, '.claude-mcp.log');
  }

  log(event: string, details?: any): void {
    const timestamp = new Date().toISOString();
    let logMessage = `[${timestamp}] ${event}`;
    
    if (details !== undefined) {
      if (typeof details === 'object') {
        try {
          logMessage += `\n${JSON.stringify(details, null, 2)}`;
        } catch (e) {
          logMessage += `\n[Error serializing details: ${e}]`;
        }
      } else {
        logMessage += `\n${details}`;
      }
    }
    
    logMessage += '\n';

    try {
      appendFileSync(this.logFilePath, logMessage, 'utf8');
    } catch (error) {
      // Silently fail if we can't write to the log file to prevent crashing the server
      console.error(`[FileLogger] Failed to write to log file ${this.logFilePath}: ${error}`);
    }
  }
}
