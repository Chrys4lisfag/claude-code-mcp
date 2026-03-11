# Claude Code MCP Skill

This skill allows Gemini CLI to interact with Anthropic's Claude Code agent via the Claude Code MCP server. It tells Gemini when and how to delegate tasks to Claude for superior code generation, refactoring, and multi-step complex tasks.

## Use when:
- You are asked to write a complex script or refactor an entire application.
- You need a dedicated agent to execute multiple steps in the background without overwhelming Gemini's context.
- The user asks you to "ask Claude" or "use Claude Code".

## Instructions:

1. You have access to the `claude_code` tool provided by the Claude Code MCP server.
2. The `claude_code` tool expects a `prompt` (string) and a `workFolder` (string).
3. Always provide the absolute path to the current working directory in `workFolder` so Claude operates in the correct context.
4. Pass the user's requirements exactly as described, but be sure to frame them as clear instructions.
5. Example tool call:
   ```json
   {
     "prompt": "Refactor the authentication logic in src/auth.js to use async/await and update all tests to match.",
     "workFolder": "/absolute/path/to/project"
   }
   ```
6. Wait for Claude Code to complete the task. The tool will return Claude's response.
7. Present the results or summary to the user. Do not attempt to manually redo the changes if Claude has already made them.

## Setup Instructions for Gemini CLI users:
1. Ensure the Claude Code MCP server is configured in your `mcp.json`.
2. Save this file to `~/.gemini/skills/claude-mcp/SKILL.md`.
3. In Gemini CLI, run `/skill claude-mcp` or simply ask Gemini to activate the Claude MCP skill.
