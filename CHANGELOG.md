# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] — 2026-08-03

Three approval-gate bugs found in daily use.

### Fixed

- **Bypass now means bypass.** The mode is enforced at `askApproval` itself, the one place an
  approval card can be born, so no call site can turn "never ask" into a prompt. Every ask that does
  happen logs its mode and kind to the **Grok Build** output channel
- **The agent's own permission request obeys the mode** — allowed in Bypass, rejected in Plan — and is
  answered by matching the option's `kind` and wording instead of blindly taking the first option,
  which could reject what the user allowed and make the agent ask again
- **Approve buttons take one click.** An unanswered approval, question, or plan now suspends
  auto-scroll and is scrolled into view exactly once, so the transcript no longer shifts between
  `mousedown` and `mouseup` and drops the click. The buttons also latch on the first press, so a
  second click cannot send a contradictory answer

### Changed

- **An approval card anchored to a visible tool row shows only its title and its buttons.** The
  command, the file, and the diff are already rendered directly above; repeating them turned one tool
  call into a wall of text. Cards with no tool row above them still show the full detail

## [0.2.1] — 2026-08-02

Tool rows got quieter. A few days of real use showed the always-on previews making short answers
look enormous — mostly because the agent reads a lot of files.

### Changed

- **READ rows are the link alone** — no inline preview. Reading a file is a step, not an answer, and
  a handful of full file views made a three-line reply look enormous. `open` still jumps the editor
  to the line the read started at
- **WRITE and EDIT previews are a peek** — 8 rows, and the inline expand is gone. `diff` and `open`
  are the way to read the whole change; the preview only has to make it recognisable
- **Terminal output is capped shorter** (9rem) and **keeps its expand** — it is the one tool output
  with no editor to open instead

### Fixed

- The code preview's pixel height cap clipped its last row whenever a horizontal scrollbar claimed
  space inside the box

## [0.2.0] — 2026-07-31

A full UI rethink. The webview now owns its look instead of inheriting the editor theme, and every
tool call is readable at a glance. **No features were removed.**

### Added

- **Own design system** — xAI-monochrome palette as CSS custom properties, bundled variable **Inter**
  and **JetBrains Mono**, one shared button set, authored **light and dark** themes
- **`grokBuild.theme`** setting (`dark` | `light` | `followVsCode`, default `dark`) plus a **header
  theme toggle** — light mode is designed, not derived
- **Always-on tool previews** — READ and WRITE render a real code view (line numbers, mono, inset
  background, no wrap) capped at 11 rows with a fade and an expand/collapse toggle; EDIT shows its
  diff without a click
- **Copy control** below both user and assistant messages, and an always-visible copy button on every
  fenced code block
- **Dismiss button** on the plan dock, keyed to the plan's steps so progress keeps it hidden and a new
  plan brings it back

### Changed

- Tool rows share one skin with a fixed verb column and a common left edge, so targets line up;
  adjacent rows sit contiguous
- Terminal rows drop the empty verb slot and give those pixels to the command, which can be expanded
  into a wrapped full-width block
- Approval cards put the verb in the title and the file on one clickable workspace-relative line
- Thought bodies are dimmer and hairline-indented, so a thought no longer reads like an answer
- Empty session is a centered wordmark and one line of text; session history and rewind lists tightened
- VSIX shrank from 796 KB / 24 files to 275 KB / 16 files — fonts are bundled into `dist/` once

### Fixed

- The **"Latest" pill** stayed pinned to the end of the transcript and scrolled away after the first
  message; it now floats above the composer
- Grok's `N→` line prefixes were printed on top of the preview's own gutter — they are stripped, the
  real file line is shown, and **`open` jumps the editor to that line**
- An unmapped tool kind rendered its label twice (`ASK USER Ask User`)
- Question option descriptions were ellipsised away, session rows inherited centered UA button text,
  and the header wordmark overlapped the icon buttons at narrow widths

## [0.1.3] — 2026-07-29

### Changed

- Softer chat chrome: light radius tokens, clearer card spacing rhythm (tools / thoughts / turns)
- Roomier assistant **markdown** (line-height, paragraphs, lists, code blocks, tables)
- Turn usage footer and thinking blocks aligned with the same vertical scale

## [0.1.2] — 2026-07-28

### Added

- **Slash commands** (`/context`, `/compact`, `/usage`, and other Grok `/` commands) open a **result modal** instead of chat bubbles; queued if a turn is running
- **Context HUD** colour (ok / warn / hot) with a **Compact** button when pressure is high
- Live context refresh via `_x.ai/session/info` after turns and session start

### Fixed

- `/compact` shows an immediate progress modal; empty `{}` API payloads no longer appear as raw JSON

## [0.1.1] — 2026-07-28

### Fixed

- Code block **Copy** / **Copied** labels no longer show at the same time (CSS toggle instead of broken `hidden`)

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
