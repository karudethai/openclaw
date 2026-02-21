# Restarting the Development Server

When working on OpenClaw, you may occasionally need to restart the development servers containing the gateway and UI, especially when they become unresponsive or when you've made significant configuration changes.

This guide provides instructions on how to manually kill old processes and start fresh ones.

## 1. Killing Old Processes

Sometimes, stopping the processes with `Ctrl+C` isn't enough, and background processes may linger. You can force-kill them based on your operating system.

### Windows (PowerShell)

**Find lingering processes:**
```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*vite*" -or $_.CommandLine -like "*ui:dev*" -or $_.CommandLine -like "*gateway*" } | Select-Object ProcessId, Name, CommandLine
```

**Kill the lingering processes:**
You can manually run `Stop-Process -Id <ProcessId> -Force` for each ID found above, or kill them all automatically using this one-liner:
```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*node*" -and ($_.CommandLine -like "*vite*" -or $_.CommandLine -like "*ui:dev*" -or $_.CommandLine -like "*gateway*") } | Invoke-CimMethod -MethodName Terminate
```

### macOS / Linux (Bash)

**Find lingering processes:**
```bash
ps aux | grep -iE 'vite|ui:dev|gateway' | grep -v grep
```

**Kill the lingering processes:**
```bash
pkill -f 'vite|ui:dev|gateway'
```

## 2. Starting Fresh Processes

Open two separate terminal windows/tabs, and run these commands from the root directory of the `openclaw` repository.

### Terminal 1: the Gateway
Start the OpenClaw development gateway. It's recommended to skip channels (like Discord, Slack, external WebSockets) when you're just testing local UI changes.

**Windows (PowerShell):**
```powershell
$env:OPENCLAW_SKIP_CHANNELS=1; $env:CLAWDBOT_SKIP_CHANNELS=1; npm run gateway:dev
# (If npm scripts are restricted, you can run: node scripts/run-node.mjs --dev gateway)
```

**macOS / Linux:**
```bash
OPENCLAW_SKIP_CHANNELS=1 CLAWDBOT_SKIP_CHANNELS=1 npm run gateway:dev
```

### Terminal 2: the Control UI
Start the Vite development server for the control UI. Note that making changes to the control UI source files usually automatically hot-reloads without needing a restart.

**All Platforms:**
```bash
npm run ui:dev
```

## 3. Re-connecting the UI to the Gateway

When both processes are running, navigate to the local Control UI (default is `http://localhost:5173/`).

You may need to provide the connection details. Usually these are auto-detected by the Gateway running locally (on `ws://127.0.0.1:19001`), but if you are asked to provide authentication:

*   **Gateway URL**: `ws://127.0.0.1:19001`
*   **Token / Password**: Check your `.openclaw-dev/openclaw.json` (or `~/.openclaw/openclaw.json` in production) file under `gateway.auth.token` or `gateway.auth.password`.
    For example: `22ca76f19e0d6bfbb7e47639205ae2187608a4dac17c2634`

## 4. Configuring Provider API Keys

When the development gateway restarts, especially with a fresh environment, OpenClaw **must** have valid API keys for models (e.g., Anthropic) properly set internally.

Make sure you've correctly added your API keys to the applicable `auth-profiles.json` file to make sure it functions properly.

For detailed instructions on configuring the Anthropic API key correctly, please see [api-keys.md](api-keys.md).
