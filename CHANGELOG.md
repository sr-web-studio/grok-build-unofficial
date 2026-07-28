# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-07-27

### Added

- First public release: ACP-driven sidebar chat for the Grok Build CLI
- Streaming assistant markdown (batched paints + incomplete-syntax softening), collapsible thinking, tool cards, diffs
- **Copy** control on fenced code blocks
- Client-side permission gate: Ask / Accept edits / Plan / Bypass
- Session history list with **rename** (`_x.ai/session/rename`) and store-based delete
- Status line shows **current session title** (auto-summary or rename) with a non-shifting busy cue
- Clearer **You** / **Grok** message roles; sticky last-user pin (single-line)
- **Image attach / paste** (workspace `.grok-attachments/`; path notes for the agent when ACP image blocks are unavailable)
- **Plan dock** (turn-scoped; cleared when a turn ends)
- **Queue panel** above the input; Send / Send all now; **queued** badge after flush
- **Jump to latest** when scrolled up
- Rewind checkpoints and git worktree create / resume / apply / remove
- Editor integration: unsaved buffer reads, workspace-edit writes, real terminals
- Protocol log channel with secret redaction
- Soft cloud / binary path hints for agent file I/O (no hard block)
- **Setup card** when the CLI is missing or not signed in (link to grok.x.ai + Retry)
- First public Marketplace listing: `sr-web-studio.grok-build-unofficial`

### Fixed

- Permission mode, model, and reasoning effort **persist** and re-apply after agent start
- Terminal / tool output strips **ANSI** so cards stay readable
- Session rename no longer bleeds onto the open untitled session
- Reload resumes the **last real session** instead of minting a blank untitled every time
- Tool cards wait for path/args before paint (no empty `READ` flash); failures show short human lines, not stack dumps
- User image thumbs keep aspect ratio; attachment path notes stay out of the user bubble
- Status-line busy cue no longer shoves session title / folder

### Notes

- Unofficial community client; not affiliated with xAI
- Requires authenticated Grok Build CLI 0.2.112+
