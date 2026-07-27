# Grok Build CLI over ACP — what the wire actually looks like

Everything here is derived from live recordings against **Grok Build CLI v0.2.112** on Windows
(`recordings/01-hello` … `recordings/09-perm-noauto`, produced by `tools/acp-probe.mjs`), plus
grok's own persisted session logs. Nothing in this file is copied from the third-party
`pawelhuryn.grok-vscode-phuryn` extension (FSL-1.1-MIT) — only protocol method/field names were
read from it for interop, which is not copyrightable expression.

Recordings are gitignored: they contain machine paths and echo the local MCP config. The probe
redacts secret-shaped strings before writing, but treat them as local-only anyway.

## 1. Launching the agent

```
grok [--permission-mode MODE] [--allow RULE] [--deny RULE] agent [-m MODEL] [--reasoning-effort E] [--always-approve] [--no-leader] stdio
```

Argument order matters and is not obvious:

- `--permission-mode`, `--allow`, `--deny` are **global** flags → before `agent`.
- `-m/--model`, `--reasoning-effort`, `--always-approve`, `--no-leader` belong to **`agent`** →
  between `agent` and `stdio`. Putting them after `stdio` fails with
  `error: unexpected argument '--reasoning-effort' found` — `stdio` only accepts
  `--debug`, `--debug-file`, `--leader-socket`.
- `--permission-mode` values: `default, acceptEdits, auto, dontAsk, bypassPermissions, plan`.
- On Windows the binary is a shim, so `spawn` needs `shell: true`.
- Without `--no-leader` grok attaches to the shared leader process at `~/.grok/leader.sock`.
  For an editor extension the shared leader is actually desirable (session list stays in sync
  with the TUI); for reproducible recordings it is not.
- `GROK_HOME` relocates the whole config/auth dir — confirmed honoured (a deliberate type error
  in `$GROK_HOME/config.toml` aborts startup), which makes isolated experiments possible.

Transport is plain JSON-RPC 2.0, one object per line, over stdin/stdout. stderr carries human
log lines and must never be parsed as protocol.

## 2. Handshake

`initialize` → `{ protocolVersion: 1, clientCapabilities: { fs: { readTextFile, writeTextFile }, terminal }, clientInfo }`

Response highlights:

- `agentCapabilities.loadSession: true`, `promptCapabilities: { image: false, audio: false, embeddedContext: true }`,
  `mcpCapabilities: { http: true, sse: true }`
- `authMethods: [cached_token, grok.com]`
- `_meta`: `grokShell`, `agentVersion`, `agentId`, `agentInstanceId`, `hostname`,
  `modelState` (default `grok-4.5`, 500 000 ctx, agentType `grok-build-plan`, reasoning efforts
  high/medium/low), `availableCommands`, `cancelRewind: true`, `sessionRecap: true`,
  `voiceMode: true`, `x.ai/fs_notify`, `x.ai/hooks`, `x.ai/capabilities.toolOverrides`

`session/new` → `{ cwd, mcpServers: [] }`. Response:

```json
{
  "sessionId": "019f9a55-…",
  "models": { "currentModelId": "grok-4.5", "availableModels": [ … ] },
  "_meta": {
    "currentWorkingDirectory": "…",
    "codebaseIndexed": [],
    "isGitRepo": false, "gitRoot": null, "showNonGitWarning": false,
    "feedbackEnabled": true,
    "x.ai/sessionConfig": { "options": [
      { "id": "grok-4.5", "category": "model", "label": "Grok 4.5", "selected": true },
      { "id": "low", "category": "mode", "label": "Low Effort", "description": "…", "selected": true }
    ] },
    "x.ai/sessionDetail": { "sessionId": "…", "kind": "build", "cwd": "…", "currentModelId": "…" }
  }
}
```

Note: **no standard ACP `modes` object and no `configOptions`.** Model + reasoning effort come
through `_meta["x.ai/sessionConfig"]` with `category: "model" | "mode"` (here "mode" means
reasoning effort, *not* permission mode). Each `availableModels[]` entry carries
`_meta.totalContextTokens`, `_meta.supportsReasoningEffort`, `_meta.reasoningEfforts[]`.

## 3. The update stream (`session/update`)

All observed `sessionUpdate` values are snake_case (the published protocol docs paraphrase these
inaccurately — trust the wire):

`user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk`, `tool_call`,
`tool_call_update`, `tool_call_delta_chunk`, `plan`, `available_commands_update`,
`turn_completed`, `pending_interaction`, `interaction_resolved`, `session_summary_generated`,
`image_compressed`, `model_changed`.

### Assistant text and thinking

```json
{ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": "hello" } }
{ "sessionUpdate": "agent_thought_chunk", "content": { "type": "text", "text": "The" } }
```

Both stream token-by-token (literally one word/fragment per frame), so the UI needs
accumulate-and-render, not per-frame layout. `user_message_chunk` echoes our own prompt back with
`_meta: { modelId, promptIndex }` — useful for rebuilding a transcript on `session/load`.

### Tool calls — three-stage lifecycle

1. `tool_call_delta_chunk` — earliest signal, arrives while arguments are still streaming:
   `{ tool_call_id, tool_index, name }`. Good for an instant "Read…" placeholder.
2. `tool_call` — the call exists: `{ toolCallId, title, rawInput, _meta["x.ai/tool"] }`.
3. `tool_call_update` — one or more, ending with `status: "completed"`.

`_meta["x.ai/tool"]` is the richest source for rendering:

```json
{ "version": 1, "name": "read_file", "kind": "read", "namespace": "grok_build",
  "label": "Read", "read_only": true, "input": { "path": "…", "limit": 5 } }
```

Observed `kind`: `read | edit | execute | search | fetch | think | other | permission`.
Observed tool names: `read_file`, `write`, `search_replace`, `run_terminal_command`, `list_dir`,
`web_fetch`, `web_search`, `todo_write`, `task`, `grep`.
`rawInput.variant` gives grok's internal tag (`ReadFile`, `Write`, `Bash`, …).

A read completing:

```json
{ "sessionUpdate": "tool_call_update", "toolCallId": "call-…-0", "status": "completed",
  "content": [ { "type": "content", "content": { "type": "text", "text": "1→line one\n…" } } ],
  "rawOutput": { "type": "ReadFile", "FileContent": {
    "content": "1→line one\n…", "content_concise": "…", "absolute_path": "…",
    "offset": null, "limit": 5, "raw_output": "line one\n…", "total_lines": 4 } } }
```

`content` is display-ready (line-numbered `1→` prefixes, already truncated via
`content_concise`); `rawOutput` is the machine version. An edit instead carries a ready-made
diff — no need to compute one:

```json
{ "kind": "edit", "title": "Write `…\\hello.js`",
  "content": [ { "type": "diff", "path": "…\\hello.js", "oldText": "", "newText": "console.log(\"hello world\");\n" } ],
  "locations": [ { "path": "…\\hello.js" } ] }
```

An execute:

```json
{ "kind": "execute", "title": "Execute `node hello.js`",
  "content": [ { "type": "content", "content": { "type": "text", "text": "Run hello.js with Node" } } ],
  "rawInput": { "variant": "Bash", "command": "node hello.js", "description": "Run hello.js with Node", "is_background": false } }
```

`locations[]` is what lets the UI make a tool card click through to the file.
ToolCallContent variants seen in the wild: `content`, `diff`, `text`, `image`.

### Turn end and cost

```json
{ "sessionUpdate": "turn_completed", "prompt_id": "…", "stop_reason": "end_turn",
  "usage": { "inputTokens": 19762, "outputTokens": 36, "totalTokens": 19798,
             "cachedReadTokens": 5376, "reasoningTokens": 31, "modelCalls": 1,
             "apiDurationMs": 2188, "costUsdTicks": 306008000,
             "modelUsage": { "grok-4.5-build": { … } }, "numTurns": 1 } }
```

`costUsdTicks` is USD × 1e9 (306 008 000 ≈ $0.306). Enough for a real context/cost HUD without
any extra API calls. `session/prompt` then returns `{ stopReason: "end_turn" }`.

`session_summary_generated` gives a short auto-title ("Read notes.txt First Line Only") — free
session naming for a history list.

## 4. The agent calls back into us — and that is the whole leverage

Because the client advertises `fs` + `terminal` capabilities, **every** file mutation and shell
command is routed back through the client. Traced order in `recordings/02-tools`:

| # | frame | note |
|---|---|---|
| 56 | `tool_call read_file` | |
| 60 | `fs/read_text_file` | agent asks *us* to read |
| 129 | `tool_call write` | |
| 133 | `fs/read_text_file` | pre-read (ENOENT is normal for a new file) |
| 135 | `fs/write_text_file` | agent asks *us* to write |
| 208 | `tool_call search_replace` | |
| 212 | `fs/read_text_file` → 214 `fs/write_text_file` | edits also go through us |
| 266 | `tool_call run_terminal_command` | |
| 270 | `terminal/create` → 272 `wait_for_exit` → 274 `output` → 276 `release` | full lifecycle |

Consequences for the extension:

- Reads can be served from **unsaved editor buffers**, so the agent sees what Salim sees.
- Writes can be applied as a `WorkspaceEdit` → native undo, dirty-buffer diffs, and the option
  to hold the change for review before touching disk.
- Commands run in a real integrated terminal we own.
- **We can gate anything.** A write or a command cannot happen unless we answer the callback, so
  a Claude-Code-style approval prompt is implementable client-side regardless of what grok's own
  permission machinery does.

`fs/read_text_file` supports `line` + `limit`. Responding with a JSON-RPC error (e.g. ENOENT) is
handled gracefully by the agent.

## 5. Permission requests: the honest state of things

`session/request_permission` **was never emitted**, in nine recordings across every
configuration tried:

| attempt | setup | result |
|---|---|---|
| 03 | real config | auto-approved |
| 04 | `--permission-mode default` | auto-approved |
| 05 | isolated `GROK_HOME`, `yolo=false`, `features.support_permission=true` | auto-approved |
| 06 | + project `.claude/settings.json` `defaultMode: "default"` | auto-approved |
| 07 | + faked `HOME`/`USERPROFILE` so no `~/.claude/settings.json` at all | auto-approved |
| 08 | dangerous payload (file write **and** `curl -o page.html`) | auto-approved |
| 09 | + `features.default_auto_mode = false` | auto-approved |

What arrives instead, immediately before the tool runs and immediately after:

```json
{ "sessionUpdate": "pending_interaction", "tool_call_id": "call-…-0", "kind": "permission" }
{ "sessionUpdate": "interaction_resolved", "tool_call_id": "call-…-0" }
```

i.e. grok raises its permission checkpoint and resolves it internally in the same breath. The
binary links `agent-client-protocol-0.10.4`, so the method name exists in its serde tables, but
nothing in v0.2.112's ACP path was observed to raise it, and there is no `session/request_permission`
or `optionId` in any of 45 real session logs on this machine.

**Design conclusion:** do not build the approval UX on top of `session/request_permission`.
Implement it where we are actually in control — the `fs/write_text_file` and `terminal/create`
callbacks — and additionally handle `session/request_permission` defensively for the day it
starts firing. Its contract (ACP 0.10.4) is:

```
request:  { sessionId, toolCall: ToolCallUpdate, options: [ { optionId, name, kind } ] }
          kind ∈ allow_once | allow_always | reject_once | reject_always
response: { outcome: { outcome: "selected", optionId } }  |  { outcome: { outcome: "cancelled" } }
```

`pending_interaction` / `interaction_resolved` remain useful as a "waiting on approval" spinner
state keyed by `tool_call_id`.

Grok's own gating knobs, for reference: `--always-approve`, `--allow` / `--deny` rules with
`Bash(...)`, `Edit(...)`, `Write(...)`, `Read(...)`, `Grep(...)`, `WebFetch(...)`,
`MCPTool(...)` prefixes, `[features] support_permission`, and — only when no TOML config exists
— `.claude/settings.json` permissions.

## 6. xAI extension surface (`_x.ai/*`)

Everything in this section was re-checked against grok **0.2.112** with `tools/probe-methods.mjs`
(free, no prompt) and `tools/verify-live.mjs` (asserts; `--no-prompt` for a free re-run). Two
rules govern the whole surface:

1. **The `_` prefix is mandatory on the wire.** The binary's string table stores the names
   without it, so grep for `x.ai/rewind/points`, but send `_x.ai/rewind/points`. The bare form
   answers `-32601` — confirmed with `x.ai/git/worktree/list`.
2. **There are two channels.** grok's TUI talks to its backend over a private *leader* channel
   that also carries method names an ACP client cannot reach. A name existing in the binary
   proves nothing; only a probe does. `--leader` does not help — the ACP dispatcher is the same.

Not callable by an ACP client (all `-32601`, with and without `--leader`):

| name | why it looks callable | what we do instead |
| --- | --- | --- |
| `_x.ai/queue/interject` | the TUI splices text into a live turn | client-side queue, sent as the next prompt |
| `_x.ai/queue/clear` | pairs with the above | the queue is ours, so clearing it is local |
| `_x.ai/toggle_plan_mode` | plan mode is a real grok feature | permission gate + a prompt preamble |
| `_x.ai/permissions/reset` | grok has per-session approvals | our gate owns approvals; reset is local |
| `_x.ai/git/worktree/status` | sits in the same family as the rest | it is a **notification**, not a method |

Notifications the agent sends that a Claude-Code-grade UI will want:

- `_x.ai/session_notification` — wraps `pending_interaction`, `interaction_resolved`,
  `turn_completed`, `session_summary_generated`, `model_changed` (carries the *effective*
  reasoning effort)
- `_x.ai/session/prompt_complete`, `_x.ai/session/update`, `_x.ai/sessions/changed`
- `_x.ai/models/update`, `_x.ai/settings/update`, `_x.ai/announcements/update`
- `_x.ai/queue/changed`
- `_x.ai/mcp/init_progress`, `_x.ai/mcp/server_status`, `_x.ai/mcp/servers_updated`, `_x.ai/mcp_initialized`
- `_x.ai/git/worktree/status` — the async half of `worktree/create`: `{status:"progress",
  message}` then `{status:"created", worktreePath, commit, sourceGitRoot, copied…}`. Observed
  sequence: `progress → created`.

Requests the agent can make of the client:

- `_x.ai/exit_plan_mode` — plan text in `planContent ?? plan ?? input.plan`.
  Known CLI quirk: the tool result always reports "approved" regardless of the real choice; the
  actual verdict shows up in the next user message. Plan-mode UI must not trust the tool result,
  and must enforce the user's verdict itself (we cancel the turn and re-prompt with the feedback).
- `_x.ai/ask_user_question` — confirmed live with `tools/probe-ask-question.mjs`.

  ```jsonc
  // request
  { "questions": [ { "question": "Which colour should the banner be?",
                     "options": [ { "label": "Red", "description": "Red banner colour",
                                    "preview": "…optional, single-select only…" } ],
                     "multiSelect": false } ],
    "mode": "default" }
  ```

  The reply deserialises into the Rust enum `AskUserQuestionExtResponse`, which serde tags
  **internally on `outcome`**. Returning a bare `{answers}` fails the tool call with
  ``missing field `outcome` `` — that was the original bug. Three variants exist in the binary
  (`accepted`, `skip_interview`, `chat_about_this`); the first two are verified:

  ```jsonc
  // response — answers are keyed by the question *text*; a value is a string, or an
  // array of strings when multiSelect is true.
  { "outcome": "accepted",
    "answers":     { "Which colour should the banner be?": "Red",
                     "Which extras should ship?": ["Logo", "Icon"] },
    "annotations": { "Which colour should the banner be?": { "notes": "…", "preview": "…" } } }

  { "outcome": "skip_interview" }   // grok proceeds with "(No answer provided)"
  ```

  Both `notes` and the chosen `preview` are echoed into grok's context — it renders them as
  `Question <q>: Selected option(s) <a>`, `selected preview:`, `user notes:`. Request field names
  are camelCase on the wire (`multiSelect`), unlike most of the `_x.ai` surface.

Methods the client **can** call (every one below returned a result under probe). Watch the
wrapping: some answer `{"result": …}` *inside* the JSON-RPC `result`, so the payload needs
unwrapping twice, and some do not. Field casing is inconsistent too — request params are
camelCase, several response bodies are snake_case.

Sessions and history:

- `_x.ai/sessions/list` `{cwd}` → **double-wrapped** `{result:{sessions:[{sessionId, title, cwd,
  isWorktree, modelId, activity, lastChangeUnixMs, …}]}}`.
- `_x.ai/session/list` → double-wrapped, richer rows (`summary`, `updatedAt`, `numMessages`,
  `branch`, `repoName`, `gitRootDir`). An alternate spelling, not a duplicate.
- `_x.ai/session_summaries/session_list` `{workspace_directory, limit}` → **not** wrapped:
  `{session_summaries:[{info:{id,cwd}, session_summary, created_at, updated_at, num_messages,
  num_chat_messages, …}]}`. `workspace_list_recent` returns the same rows as a bare array.
  The extension merges these with the on-disk store (§7), first writer wins.
- `_x.ai/session/info` → double-wrapped, and the only accurate context gauge:
  `{turns, turnIndex, context:{used, total, systemPromptTokens, …}, model, apiBackend}`.
- `_x.ai/session/search` `{query}` → double-wrapped `{results:[{sessionId, cwd, summary, score,
  matchedFields}]}` — full-text across *all* sessions, not just this cwd.
- `_x.ai/session/rename` `{title}` → `{success:true}`. `_x.ai/prompt_history` `{cwd}` →
  `{prompts:[…]}` (composer history). `_x.ai/session/usage` → `{usage:{inputTokens, …}}`.
- **No delete.** Nothing in the probed surface removes a session, so the extension's history
  delete removes the store directory itself (§7) and remembers the id — a resident session is
  still reported by `sessions/list` after its files are gone, until the agent restarts.
- `_x.ai/commands/list` → the same `availableCommands` the update stream pushes, on demand.
  `_x.ai/skills/list` `{cwd}` → double-wrapped `{skills:[…]}`.

Rewind:

- `_x.ai/rewind/points` → `{rewind_points:[{prompt_index, prompt_preview, created_at,
  num_file_snapshots, has_file_changes}]}` — snake_case, not wrapped.
- `_x.ai/rewind/execute` `{sessionId, targetPromptIndex}` — camelCase param, taken from the
  point's snake_case `prompt_index`. Nothing else is required. Because transcript blocks carry
  `_meta.promptIndex`, the client truncates its own transcript by dropping every block with
  `promptIndex >= targetPromptIndex`.

Worktrees (all double-wrapped; the repo must be a git repo):

- `create` `{sourcePath, name, branch}` → `{status:"creating", worktreePath, sourceGitRoot}` and
  then finishes asynchronously via the `worktree/status` notification above.
- `resume_session` `{sourceCwd}` → synchronous, and does more than `create`: it makes a tree
  *and* copies the chat into a new session rooted there — `{sessionId, worktreePath,
  effectiveCwd, parentSessionId, chatMessagesCopied, codeRestored}`.
- `list` → `[{id, path, source_repo, repo_name, kind, creation_mode, git_ref, head_commit,
  session_id, created_at, status:"alive", metadata:{label,user_provided}}]`. Filter by
  `source_repo`, comparing loosely: grok mixes `/` and `\` and drive-letter case in that field.
- `remove` `{worktreePath, force:true}` → `{removed:true, resolvedPath}`. `show` `{idOrPath}` →
  `null` for a path that is not a worktree; `db/path` → `~/.grok/worktrees.db`.

In the binary's method table but **not** exercised yet, so treat the shapes as unknown:
`_x.ai/git/worktree/apply` (the extension calls it and renders whatever comes back),
`_x.ai/git/worktree/gc`, `_x.ai/compact_conversation`, `_x.ai/session/fork`,
`_x.ai/yolo_mode_changed`.

Standard client methods to keep supporting: `session/cancel` (a **notification** — no reply),
`session/load` (`loadSession: true`, so history restore is possible), `session/set_model`
`{ sessionId, modelId }`, and `session/set_mode` `{ sessionId, modeId }`.

There is **no** `session/set_config_option`. Reasoning effort is not a separate knob: grok
publishes the efforts as `session._meta["x.ai/sessionConfig"].options[]` entries with
`category: "mode"`, and the currently active one is the entry with `selected: true`. So the
setter for reasoning effort is `session/set_mode`, and the setter for the model is
`session/set_model`.

## 7. Free corpus: grok already records everything

`~/.grok/sessions/<url-encoded-cwd>/<uuid>/` holds `updates.jsonl` (the exact ACP update
stream), plus `chat_history.jsonl`, `events.jsonl`, `rewind_points.jsonl`, `summary.json`,
`system_prompt.txt`, `terminal/`, `assets/`. Useful both for fixtures and for a
"resume previous session" list without needing our own storage.

## 8. Claude Code compatibility already built in

Grok reads `CLAUDE.md`, `.claude/skills/`, `.claude/agents/`, `~/.claude.json` MCP servers, and
(only as a fallback when no TOML config exists) `.claude/settings.json` permissions. An extension
does not need to reimplement any of that.
