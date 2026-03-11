@echo off
setlocal

:: Define the destination directory for the Gemini CLI skill
set "DEST_DIR=%USERPROFILE%\.gemini\skills\claude-mcp"
set "DEST_FILE=%DEST_DIR%\SKILL.md"

:: Get the project root (one level up from this script's directory)
set "PROJECT_ROOT=%~dp0.."
set "SOURCE_FILE=%PROJECT_ROOT%\assets\gemini-skill.md"

:: Check if the source file exists
if not exist "%SOURCE_FILE%" (
    echo Error: Source skill file not found at %SOURCE_FILE%
    exit /b 1
)

:: Create the destination directory if it doesn't exist
if not exist "%DEST_DIR%" (
    mkdir "%DEST_DIR%"
)

:: Copy the file
copy /Y "%SOURCE_FILE%" "%DEST_FILE%" >nul

if %ERRORLEVEL% equ 0 (
    echo ✅ Successfully installed Claude Code MCP skill for Gemini CLI.
    echo    Location: %DEST_FILE%
    echo.
    echo    To use it, type '/skill claude-mcp' in your Gemini CLI session,
    echo    or ask Gemini to 'activate the claude-mcp skill'.
) else (
    echo ❌ Failed to install the skill.
    exit /b 1
)
endlocal
