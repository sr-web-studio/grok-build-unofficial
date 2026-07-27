# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
