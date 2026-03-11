#!/bin/bash

# Define the destination directory for the Gemini CLI skill
DEST_DIR="$HOME/.gemini/skills/claude-mcp"
DEST_FILE="$DEST_DIR/SKILL.md"

# Get the directory of this script, then go up one level to the project root
PROJECT_ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." >/dev/null 2>&1 && pwd )"
SOURCE_FILE="$PROJECT_ROOT/assets/gemini-skill.md"

# Check if the source file exists
if [ ! -f "$SOURCE_FILE" ]; then
    echo "Error: Source skill file not found at $SOURCE_FILE"
    exit 1
fi

# Create the destination directory if it doesn't exist
mkdir -p "$DEST_DIR"

# Copy the file
cp "$SOURCE_FILE" "$DEST_FILE"

if [ $? -eq 0 ]; then
    echo "✅ Successfully installed Claude Code MCP skill for Gemini CLI."
    echo "   Location: $DEST_FILE"
    echo ""
    echo "   To use it, type '/skill claude-mcp' in your Gemini CLI session,"
    echo "   or ask Gemini to 'activate the claude-mcp skill'."
else
    echo "❌ Failed to install the skill."
    exit 1
fi
