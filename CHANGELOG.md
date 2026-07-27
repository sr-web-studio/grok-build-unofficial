# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Permission mode, model, and reasoning effort now **persist** (Global + Workspace settings) and are re-applied after every agent start
- Terminal / tool output strips **ANSI colour codes** (`gh`, npm, etc.) so cards stay readable
- Renaming one session no longer bleeds onto the open untitled session
- Reload / reopen resumes the **last real session** instead of minting a new blank untitled every time
- Thinking blocks no longer paint over the following “Grok” bubble
- `todo_write` / “plan write” tool cards are hidden; the checklist is the source of truth

### Added

- **Jump to latest** floating button when you scroll up in the transcript
- **Image attach / paste** in the composer (saved under `.grok-attachments/`; path is injected into the prompt because current Grok CLI ACP reports `promptCapabilities.image: false`)
- **Plan dock** above the composer (collapsed by default with count/status)
- **Queue panel** above the input (not in the transcript); Send / Send all now; chat only gets a **queued** badge after send

## [0.1.0] — 2026-07-27

### Added

- First public release: ACP-driven sidebar chat for the Grok Build CLI
- Streaming assistant markdown, collapsible thinking, tool cards, diffs, todos
- Client-side permission gate: Ask / Accept edits / Plan / Bypass
- Session history list with **rename** (`_x.ai/session/rename`) and store-based delete
- Status line shows **current session title** (auto-summary or rename)
- Clearer **You** / **Grok** message roles in the transcript
- Rewind checkpoints and git worktree create / resume / apply / remove
- Editor integration: unsaved buffer reads, workspace-edit writes, real terminals
- Protocol log channel with secret redaction
- Webview UI harness and ACP probe tools for development

### Notes

- Unofficial community client; not affiliated with xAI
- Requires authenticated Grok Build CLI 0.2.112+
