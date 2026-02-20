# Configuring API Keys

This guide explains how to properly configure API keys for OpenClaw profiles, particularly for the active development session.

When restarting the OpenClaw development environment or creating a new agent, the prompt may silently fail or the subagent may not spawn correctly if the API key for the selected AI provider is missing from the respective agent's configuration files.

## Updating the Auth Profile

OpenClaw stores agent-specific authentication credentials in `auth-profiles.json`. 

If you are working with the `dev` agent and need to add an Anthropic API token, you must manually edit the relevant `.json` file located in the `.openclaw-dev` directory at your user's home path.

**Path:** `C:\Users\i\.openclaw-dev\agents\dev\agent\auth-profiles.json`

### Sourcing the Token from Claude Code (`credentials.json`)

If you are a Claude Code user or have authenticated to Claude via OAuth on your local machine, your session token is typically stored inside `credentials.json` (e.g. `C:\Users\i\Downloads\credentials.json`).

If you open `credentials.json`, look for the `claudeAiOauth` section and copy the `accessToken` value (it typically starts with `sk-ant-oat01-`). You can plug this directly into OpenClaw!

### Example Configuration (Anthropic Token)

Because this is a temporary OAuth session token and not a static API key, you should set the `type` property to `"token"` instead of `"api_key"`.

Here is the correct structure showing how to declare an Anthropic OAuth token:

```json
{
  "version": 1,
  "profiles": {
    "anthropic:default": {
      "type": "token",
      "provider": "anthropic",
      "token": "sk-ant-oat01-your-actual-oauth-access-token-here"
    }
  }
}
```

### Steps (Manual Edit)

⚠️ **Important Warning**: When saving this file on Windows, you **must ensure your text editor saves it as UTF-8 *without* a Byte-Order Mark (BOM)**. Alternatively, do not use PowerShell's `Out-File` cmdlets, as they often inject an invisible `﻿` (BOM) character that will silently fail the OpenClaw parser.

1. Find and open your `credentials.json` file. Copy the long `accessToken` string under `claudeAiOauth`.
2. Open `C:\Users\i\.openclaw-dev\agents\dev\agent\auth-profiles.json` in your text editor.
3. Ensure the JSON object contains a `profiles` object.
4. Inside `profiles`, add a new property named `"anthropic:default"`.
5. Define the object with `type` set to `"token"`, `provider` set to `"anthropic"`, and `token` containing your copied access token.
6. Save the file (ensuring **UTF-8 No BOM** encoding).
7. The OpenClaw Gateway will automatically recognize the new token!

### Automated Method (Node.js)

Because of the BOM risks on Windows, the safest way to programmatically inject the token is using a quick Node.js snippet from PowerShell or CMD, ensuring strings are encoded perfectly:

```bash
node -e "const fs = require('fs'); const data = {version: 1, profiles: {'anthropic:default': {provider: 'anthropic', type: 'token', token: 'INSERT_YOUR_TOKEN_HERE'}}}; fs.writeFileSync('C:\\Users\\i\\.openclaw-dev\\agents\\dev\\agent\\auth-profiles.json', JSON.stringify(data, null, 2), 'utf8');"
```
*(Replace `INSERT_YOUR_TOKEN_HERE` with your actual OAuth token)*
