# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

An unofficial VS Code extension that wraps the **Grok Build CLI** (xAI) via the **Agent Client Protocol (ACP)** — JSON-RPC 2.0 over stdio. It surfaces a sidebar chat UI with streaming responses, file write/terminal command approval gates, git worktree sandboxing, session history, and rewind.

## Commands

```bash
npm install          # Install dependencies
npm run build        # One-time production bundle (host + webview)
npm run watch        # Incremental rebuild on file changes
npm run typecheck    # tsc --noEmit + svelte-check
npm run smoke        # Integration smoke test (launches real VS Code)
npm run package      # Build .vsix (typecheck → prod bundle → vsce package)
```

**Run the extension**: Press `F5` in VS Code — launches Extension Development Host with auto-build.

**Webview UI harness** (no VS Code needed):

```bash
npm run build && python -m http.server 5599
# open http://127.0.0.1:5599/tools/webview-harness/index.html
```

**Protocol debugging tools** in `tools/`:

```bash
node tools/acp-probe.mjs           # Record raw ACP conversation
node tools/probe-methods.mjs       # Test which _x.ai/* methods respond
node tools/verify-live.mjs --no-prompt   # Assert ACP shapes
```

## Architecture

Dual-bundle build via `esbuild.mjs`:

- **`dist/extension.js`** — CommonJS, Node.js, runs in VS Code extension host
- **`dist/webview.js`** — ESM, browser context, injected into VS Code webview

Two separate `tsconfig.json` files: root (host) and `tsconfig.webview.json` (webview).

### Key Source Directories

| Path                         | Responsibility                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| `src/extension.ts`           | Activation, command registration                                                            |
| `src/acp/client.ts`          | `AcpClient` — spawns `grok agent stdio`, routes JSON-RPC over stdin/stdout                  |
| `src/acp/types.ts`           | Wire types (ContentBlock, ToolCall, JsonRpcFrame, etc.)                                     |
| `src/host/session.ts`        | `GrokSession` — core state machine; owns transcript blocks, approval gates, worktrees       |
| `src/host/panel.ts`          | `ChatViewProvider` — webview lifecycle, host↔webview message routing                        |
| `src/host/permissions.ts`    | `PermissionGate` — 4-mode approval logic (default / acceptEdits / plan / bypassPermissions) |
| `src/host/fsBridge.ts`       | Handles ACP `fs/*` callbacks (read/write file)                                              |
| `src/host/terminalBridge.ts` | Handles ACP `terminal/*` callbacks                                                          |
| `src/shared/protocol.ts`     | Typed union contracts: `HostMessage` and `WebviewMessage`                                   |
| `webview/App.svelte`         | Root Svelte 5 component — state, IPC, layout                                                |
| `webview/ipc.ts`             | `send()` and `onHostMessage()` typed IPC helpers                                            |

### Data Flow: User Prompt → Agent Response

1. User types in `Composer.svelte`, presses Enter
2. Webview posts `WebviewMessage { type: 'prompt', text }` via `ipc.send()`
3. `ChatViewProvider` receives it, calls `session.prompt(text)`
4. `GrokSession` sends JSON-RPC `messages/add` to `AcpClient` over stdin
5. Grok process streams ACP notifications (text chunks, tool calls) over stdout
6. `GrokSession` normalizes snake_case → TypeScript types, mutates `blocks[]`
7. Panel posts `HostMessage` (`blockAdd` / `blockPatch`) to webview
8. `App.svelte` applies updates; Svelte 5 runes re-render reactively

### Permission Gate Flow

When the agent calls `fs/write_text_file` or a terminal command:

- `PermissionGate.checkWrite()` / `checkCommand()` returns `allow | ask | deny`
- If `ask`: an `ApprovalBlock` is added to the transcript; the write promise is suspended until `session.answerApproval()` resolves it
- Learned decisions are stored per file path / command prefix for the session

### Worktrees

`session.worktree('create', name)` runs `git worktree add`, updates the agent's `cwd`, and restarts the ACP session in the new worktree. `apply` merges changes back; `remove` cleans up.

## Known Protocol Limitations

Grok's TUI uses private leader-only ACP methods not available to external clients:

- **`_x.ai/queue/interject`** returns -32601 → queued interjections land as the next prompt instead
- **`_x.ai/toggle_plan_mode`** unreachable → plan mode is implemented client-side via PermissionGate + prompt preamble
- No `_x.ai/queue/clear` or `_x.ai/permissions/reset` over ACP

See `docs/acp-findings.md` for full protocol notes and wire shapes.

## VS Code Settings

All under `grokBuild.*`. Key ones:

- `permissionMode`: `default | acceptEdits | plan | bypassPermissions`
- `logProtocol`: set to `true` to log JSON-RPC frames to the **Grok Build** output channel
- `applyEditsAsWorkspaceEdit`: apply writes via VS Code workspace edit API (enables native undo)
- `readUnsavedBuffers`: serve `fs/read_text_file` from open editor buffers

## Runtime Requirements

- VS Code 1.125+
- Node.js 20+ (build only)
- Grok Build CLI 0.2.112+ (must be authenticated; `grok` on PATH)
