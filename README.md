# Grok Build (unofficial)

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/sr-web-studio.grok-build-unofficial?label=VS%20Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=sr-web-studio.grok-build-unofficial)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A focused chat UI for [VS Code](https://code.visualstudio.com/) that drives the **[Grok Build CLI](https://grok.x.ai/)** over the [Agent Client Protocol](https://agentclientprotocol.com) (ACP).

Streaming replies, thinking, tool cards, diffs, approvals, plans, session history, rewind, and git worktrees — in a sidebar that uses your editor for files and terminals.

> **Unofficial community project.** Not affiliated with, endorsed by, or sponsored by xAI.  
> “Grok” and related marks belong to their owners. This extension is a **client UI only** — you need a separate, authenticated [Grok Build CLI](https://grok.x.ai/) install.

## Install

| Channel                 | How                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VS Code Marketplace** | [Grok Build (unofficial)](https://marketplace.visualstudio.com/items?itemName=sr-web-studio.grok-build-unofficial) · id `sr-web-studio.grok-build-unofficial` |
| **Open VSX**            | [open-vsx.org](https://open-vsx.org/extension/sr-web-studio/grok-build-unofficial) · same id (VSCodium, etc.)                                                 |
| **VSIX**                | [GitHub Releases](https://github.com/sr-web-studio/grok-build-unofficial/releases) · `code --install-extension grok-build-unofficial-*.vsix`                  |

### Requirements

- **VS Code 1.125+**
- **[Grok Build CLI](https://grok.x.ai/) 0.2.112+**, signed in (`grok` works in a terminal)
- `grok` on your `PATH`, or set `grokBuild.cliPath` in settings

If the CLI is missing, the sidebar shows a short setup card with a link to install and a **Retry** button — no stack dumps.

## Quick start

1. Install the extension and open a workspace folder.
2. Open **Grok Build** from the activity bar (`Ctrl+Shift+G` / `Cmd+Shift+G`).
3. The agent starts on first open; the first folder is the session `cwd`.
4. Type a prompt and press **Enter**. Writes and shell commands ask for approval by default.

**Command Palette → “Grok Build”:**

| Command               | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| New Session           | Fresh conversation                                     |
| Add Selection to Chat | `Ctrl+Alt+G` / `Cmd+Alt+G` with a selection            |
| Restart Agent Process | Respawn `grok agent stdio`                             |
| Show Protocol Log     | Redacted JSON-RPC (when `grokBuild.logProtocol` is on) |

## Features

- **Streaming chat** — batched token paint, incomplete-markdown softening, code blocks with **Copy**
- **Thinking** — collapsible reasoning stream
- **Tool cards** — stable headers (wait for path/args), diffs, terminal output; short human errors on failure
- **Permissions** (enforced by _this_ extension at the fs/terminal boundary):

  | Mode            | Behaviour                             |
  | --------------- | ------------------------------------- |
  | Ask (`default`) | Approve every write and command       |
  | Accept edits    | Writes auto-apply; commands still ask |
  | Plan            | Read-only; plan preamble on prompts   |
  | Bypass          | No prompts                            |

- **Sessions** — history, rename, delete (store cleanup), auto titles
- **Plan dock** — turn-scoped checklist above the composer
- **Queue** — type while busy; send later or force-push
- **Slash commands** — `/context`, `/compact`, `/usage` (and other Grok `/` commands) open a **result modal**, not chat bubbles; queued if a turn is running
- **Context HUD** — colour-coded pressure; **Compact** when ≥70%
- **Rewind** + **git worktrees** — sandboxed branches, apply back
- **Editor integration** — unsaved buffers for reads, workspace-edit writes (native undo), real terminals
- **Cloud / binary paths** — soft hints for the agent, not hard blocks

## Settings

All under `grokBuild.*`:

| Setting                     | Default     | Purpose                        |
| --------------------------- | ----------- | ------------------------------ |
| `cliPath`                   | `grok`      | CLI binary if not on `PATH`    |
| `permissionMode`            | `default`   | Approval gate                  |
| `model` / `reasoningEffort` | CLI default | Launch knobs                   |
| `showThinking`              | `true`      | Stream reasoning into chat     |
| `readUnsavedBuffers`        | `true`      | Serve open editors to reads    |
| `applyEditsAsWorkspaceEdit` | `true`      | Writes via VS Code edit API    |
| `useSharedLeader`           | `true`      | Attach to grok’s shared leader |
| `logProtocol`               | `false`     | Log redacted frames to Output  |

## Develop

```bash
npm install
npm run build          # dist/extension.js + dist/webview.js
npm run watch          # rebuild on save
npm run typecheck
npm run smoke          # real VS Code host checks (no paid turn required)
npm run package        # production .vsix
```

**F5** in this folder (**Run Extension**), or:

```bash
code --extensionDevelopmentPath=/path/to/grok-build-unofficial /path/to/workspace
```

Webview harness (no VS Code):

```bash
npm run build && python -m http.server 5599
# http://127.0.0.1:5599/tools/webview-harness/index.html
```

Protocol probes live in `tools/` (`acp-probe`, `probe-methods`, `verify-live`). Notes: [docs/acp-findings.md](docs/acp-findings.md).

`recordings/` is gitignored. Never commit `.env`, `*.vsix`, or `~/.grok/auth.json`.

## Protocol limits

Some TUI-only ACP methods are unreachable (`-32601`). Client-side workarounds:

- Queued text sends as the **next** prompt (no live interject)
- Plan mode is **permission gate + preamble** (not grok’s private plan toggle)
- Session **rename** works; **delete** cleans grok’s on-disk store for that id

## Security

The extension spawns local `grok` and can write files / run commands **with your approval** (or automatically in Accept edits / Bypass). Read [SECURITY.md](SECURITY.md) before Bypass on untrusted workspaces.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome.

## License

[MIT](LICENSE) © [SR Web Studio](https://github.com/sr-web-studio)

## Maintainers

Marketplace / Open VSX / tags: [docs/PUBLISHING.md](docs/PUBLISHING.md).
