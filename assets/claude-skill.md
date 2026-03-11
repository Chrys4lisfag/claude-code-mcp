# Claude Code MCP Skill

This skill allows Gemini CLI to collaborate with Anthropic's Claude Code agent via the Claude Code MCP server. It transforms the dynamic into a two-developer team, where Gemini acts as the lead developer and Claude as the expert peer reviewer and collaborator.

## Core Principles: The Two-Developer Team

- **You are the Lead Developer:** You are responsible for driving the task, creating the initial plans, and writing the final code.
- **Claude is your Peer Reviewer & Collaborator:** Do not just blindly delegate the whole task to Claude. Instead, consult with Claude to verify your plans, find gaps in your knowledge, and review complex code.
- **Session Memory is Active:** The Claude MCP server is configured with persistent session memory. Claude remembers what you discussed earlier in the session, so you don't need to re-explain the entire context in every prompt. Just continue the conversation.
- **Mutual Verification:** Treat Claude's suggestions as expert advice, but always verify them yourself before applying them.

## When to use this skill:

- When you are unsure where to start and need a second opinion.
- When you have created a complex plan and need it reviewed for gaps or architectural flaws.
- When dealing with highly complex domains (e.g., LLVM, assembly, Windows internals, reverse engineering).
- When you have gathered initial information and want Claude to analyze it for deeper insights.
- When you need a final code review before concluding a task.

## Expected Workflows:

### 1. The Planning & Verification Pipeline
1. **Gemini Plans:** Create an initial plan for the user's task based on your analysis of the codebase.
2. **Consult Claude:** Use the `claude_code` tool to send the task details and your proposed plan to Claude. Ask Claude to review the plan, identify any gaps, and suggest improvements.
3. **Verify Claude's Feedback:** Review Claude's suggestions. Decide if they are reasonable and applicable to the current context.
4. **Execute:** Write the code yourself based on the verified, finalized plan.
5. **Final Review:** Send the completed code or a summary of the complex changes to Claude for a final review. Verify any final corrections Claude suggests.

### 2. The Information Gathering Pipeline
1. **Gemini Searches:** Use your native search and read tools to gather context about the codebase.
2. **Consult Claude:** Send the findings to Claude. Ask, "Based on this context, what else should I look for?" or "Can you provide deeper insights into how this system works?"
3. **Act on Insights:** Use Claude's insights to perform more targeted searches or refine your understanding.

## Tool Usage Instructions:

1. You have access to the `claude_code` tool provided by the Claude Code MCP server.
2. The `claude_code` tool expects a `prompt` (string) and a `workFolder` (string).
3. Always provide the absolute path to the current working directory in `workFolder` so Claude operates in the correct context.
4. Keep your prompts conversational but professional, as if chatting with a colleague.
5. Example tool call for a review:
   ```json
   {
     "prompt": "Hey Claude, I'm planning to implement persistent session management. My plan is to store the session ID in a .claude-mcp-session file and pass it to the CLI. What edge cases am I missing here?",
     "workFolder": "/absolute/path/to/project"
   }
   ```

## Setup Instructions for Gemini CLI users:

To automatically install this skill, run the installation script from this repository:
- **macOS/Linux:** `npm run install-skill` or `./scripts/install-skill.sh`
- **Windows:** `npm run install-skill` or `.\scripts\install-skill.bat`

Once installed, you can activate it in Gemini CLI by running `/skill claude-skill` or by asking Gemini to "activate the claude-skill skill".
