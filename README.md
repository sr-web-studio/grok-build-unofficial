# Grok Build (unofficial)

A Claude Code-style chat UI for [VS Code](https://code.visualstudio.com/), driving the
**[Grok Build CLI](https://grok.x.ai/)** over the
[Agent Client Protocol](https://agentclientprotocol.com) (ACP).

Streaming responses, thinking, tool cards, inline diffs, approval gates, plan mode, session
history (with rename), rewind, and git worktrees — in a sidebar panel that uses the editor as the
agent’s filesystem and terminal.

> **Unofficial.** This project is **not affiliated with, endorsed by, or sponsored by xAI**.
> “Grok” and related marks belong to their respective owners. You need a working, authenticated
> Grok Build CLI install; this extension is only a client UI.

## Install

| Channel                 | How                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VS Code Marketplace** | Search **“Grok Build (unofficial)”** or install by id `srwebstudio.grok-build-unofficial` _(after first publish)_                                          |
| **Open VSX**            | Same extension id for VSCodium / compatible editors _(after first publish)_                                                                                |
| **VSIX**                | Download from [GitHub Releases](https://github.com/sr-web-studio/grok-build-unofficial/releases) → `code --install-extension grok-build-unofficial-*.vsix` |

### Requirements

- VS Code **1.125+** (or a compatible editor for Open VSX)
- [Grok Build CLI](https://grok.x.ai/) **0.2.112+**, authenticated (`grok` once in a terminal)
- `grok` on your `PATH`, or set **`grokBuild.cliPath`** in settings

## Quick start

1. Install the extension and open a workspace folder.
2. Click the **Grok Build** icon in the activity bar (or `Ctrl+Shift+G` / `Cmd+Shift+G`).
3. The agent starts on first view; the first workspace folder becomes the session `cwd`.
4. Type a prompt and press **Enter**. File writes and shell commands ask for approval (default mode).

Useful commands (Command Palette → “Grok Build”):

- **New Session** — start a fresh conversation
- **Add Selection to Chat** — `Ctrl+Alt+G` / `Cmd+Alt+G` with an editor selection
- **Show Protocol Log** — JSON-RPC frames (secrets redacted) when `grokBuild.logProtocol` is on
- **Restart Agent Process** — respawn `grok agent stdio`

## Features

- **Streaming chat** with collapsible thinking and per-turn token/cost footer
- **Tool cards** with argument summaries, live command output, and unified diffs for writes
- **Permission modes** (enforced by _this_ extension at the fs/terminal boundary):

  | Mode            | Behaviour                                                         |
  | --------------- | ----------------------------------------------------------------- |
  | Ask (`default`) | Approve every file write and every command                        |
  | Accept edits    | Writes apply automatically; commands still ask                    |
  | Plan            | Read-only; writes/commands refused; plan-mode preamble on prompts |
  | Bypass          | Nothing is asked                                                  |

- **Session history** for the current folder — open, **rename**, delete (store cleanup)
- **Status line** shows agent state, **current session title**, folder, context %, tokens, cost
- **Rewind** to earlier prompts (optionally with worktrees)
- **Git worktrees** — create / resume / apply / remove sandboxed copies
- **Editor integration** — unsaved buffers for reads, workspace-edit writes (native undo), real terminals

## Settings

All under `grokBuild.*`. Highlights:

| Setting                     | Default     | Purpose                                          |
| --------------------------- | ----------- | ------------------------------------------------ |
| `cliPath`                   | `grok`      | Path to the CLI if not on `PATH`                 |
| `permissionMode`            | `default`   | Approval gate mode                               |
| `model` / `reasoningEffort` | CLI default | Launch-time model knobs                          |
| `showThinking`              | `true`      | Stream reasoning into the transcript             |
| `readUnsavedBuffers`        | `true`      | Serve open editor buffers to `fs/read_text_file` |
| `applyEditsAsWorkspaceEdit` | `true`      | Apply writes via VS Code edit API                |
| `useSharedLeader`           | `true`      | Attach to grok’s shared leader (sync with TUI)   |
| `logProtocol`               | `false`     | Log redacted JSON-RPC to the output channel      |

## Develop

```bash
npm install
npm run build          # dist/extension.js + dist/webview.js
npm run watch          # rebuild on save
npm run typecheck
npm run smoke          # boots real VS Code; host-side checks (no paid turn)
npm run package        # typecheck → prod bundle → .vsix
```

Press **F5** in this folder (**Run Extension**) or:

```bash
code --extensionDevelopmentPath=/path/to/grok-build-unofficial /path/to/some-workspace
```

Webview UI harness (no VS Code):

```bash
npm run build && python -m http.server 5599
# open http://127.0.0.1:5599/tools/webview-harness/index.html
```

Protocol tooling lives in `tools/` (`acp-probe`, `probe-methods`, `verify-live`). See
[docs/acp-findings.md](docs/acp-findings.md).

`recordings/` is gitignored: raw ACP traffic can contain machine paths and prompt content. Never
commit `~/.grok/auth.json` or similar secrets.

## Known protocol limits

Grok’s TUI reaches some private methods over a leader channel that external ACP clients cannot use.
These return `-32601` and are worked around client-side:

- **Interjection lands one turn late** — `_x.ai/queue/interject` is unreachable; queued text is sent as the next prompt
- **Plan mode is client-side** — permission gate + prompt preamble (not grok’s own plan toggle)
- No `_x.ai/queue/clear` or `_x.ai/permissions/reset` over ACP

Session **rename** _is_ supported (`_x.ai/session/rename`). Session **delete** is not; the extension
removes grok’s on-disk session store for that id instead.

## Security

This extension spawns a local `grok` process and can write files and run shell commands **with your
approval** (or automatically in Bypass / Accept-edits modes). Review [SECURITY.md](SECURITY.md)
before using Bypass in untrusted workspaces.

## License

[MIT](LICENSE) © SR Web Studio

## Publishing

Maintainer notes for Marketplace + Open VSX: [docs/PUBLISHING.md](docs/PUBLISHING.md).
