# Configuring API Keys

This guide explains how to properly configure API keys for OpenClaw profiles, particularly for the active development session.

When restarting the OpenClaw development environment or creating a new agent, the prompt may silently fail or the subagent may not spawn correctly if the API key for the selected AI provider is missing from the respective agent's configuration files.

## Updating the Auth Profile

OpenClaw stores agent-specific authentication credentials in `auth-profiles.json`. 

If you are working with the `dev` agent and need to add an Anthropic API token, you must manually edit the relevant `.json` file located in the `.openclaw-dev` directory at your user's home path.

**Path:** `C:\Users\i\.openclaw-dev\agents\dev\agent\auth-profiles.json`

### Sourcing the Token from Claude Code (`credentials.json`)

If you are a Claude Code user or have authenticated to Claude via OAuth on your local machine, your credentials are typically stored inside `credentials.json` (e.g. `C:\Users\i\Downloads\credentials.json`).

If you open `credentials.json`, look for the `claudeAiOauth` section. You will need three things: `accessToken`, `refreshToken`, and `expiresAt`.

### Example Configuration (Anthropic OAuth)

Because Claude Code uses temporary OAuth session tokens (instead of static API keys), you must provide the access token, the refresh token, and its expiration time so OpenClaw can automatically refresh it when it expires (which happens frequently).

Here is the correct structure showing how to declare a refreshable Anthropic OAuth token profile:

```json
{
  "version": 1,
  "profiles": {
    "anthropic:default": {
      "type": "oauth",
      "provider": "anthropic",
      "access": "sk-ant-oat01-your-actual-oauth-access-token-here",
      "refresh": "sk-ant-ort01-your-actual-refresh-token-here",
      "expires": 1771626176112
    }
  }
}
```

### Steps (Manual Edit)

⚠️ **Important Warning**: When saving this file on Windows, you **must ensure your text editor saves it as UTF-8 *without* a Byte-Order Mark (BOM)**. Alternatively, do not use PowerShell's `Out-File` cmdlets, as they often inject an invisible `﻿` (BOM) character that will silently fail the OpenClaw parser.

1. Find and open your `credentials.json` file.
2. Open `C:\Users\i\.openclaw-dev\agents\dev\agent\auth-profiles.json` in your text editor.
3. Ensure the JSON object contains a `profiles` object.
4. Inside `profiles`, add a new property named `"anthropic:default"`.
5. Define the object with `type` set to `"oauth"`, `provider` set to `"anthropic"`, and populate the `access`, `refresh` and `expires` properties using the values from `credentials.json`. 
6. Save the file (ensuring **UTF-8 No BOM** encoding).
7. The OpenClaw Gateway will automatically recognize and refresh the token when needed!

### Automated Method (Node.js)

Because of the BOM risks on Windows, the safest way to programmatically inject the credentials is by using a Node script that reads `credentials.json` directly and extracts the necessary OAuth fields safely without encoding issues.

Run this directly in PowerShell or CMD from any directory:

```bash
node -e "const fs = require('fs'); const auth = JSON.parse(fs.readFileSync('C:\\Users\\i\\Downloads\\credentials.json', 'utf8')).claudeAiOauth; const data = {version: 1, profiles: {'anthropic:default': {provider: 'anthropic', type: 'oauth', access: auth.accessToken, refresh: auth.refreshToken, expires: auth.expiresAt}}}; fs.writeFileSync('C:\\Users\\i\\.openclaw-dev\\agents\\dev\\agent\\auth-profiles.json', JSON.stringify(data, null, 2), 'utf8'); console.log('Successfully injected OAuth credentials!');"
```
