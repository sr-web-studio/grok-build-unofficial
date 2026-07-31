# Full UI Inventory of Grok Build VS Code Extension Webview

> **Audit Context**: Repository `e:\projects\grok-build-unofficial`. Read-only audit of `webview/` and `src/shared/protocol.ts`.
> **Scope**: Exhaustive inventory of every user-visible UI component, transcript block type, chrome bar, modal overlay, CSS variable, icon, responsive constraint, and feature capability.

---

## 1. Component Tree

| File Path | Description / What it renders | Mounted Where | Props & Local State |
| :--- | :--- | :--- | :--- |
| `webview/main.ts:1-8` | Entry point. Mounts root Svelte app to DOM `#root`. | Browser DOM (`index.html`) | Props: None.<br>State: None. |
| `webview/ipc.ts:1-32` | Typed IPC module bridging host postMessage and webview draft state. | Imported by `App.svelte`, `Header.svelte`, `Composer.svelte`, `Notice.svelte`, `SetupCard.svelte`, `StatusLine.svelte` | Props: N/A.<br>State: `draft` in VS Code API state. |
| `webview/diff.ts:1-139` | Hand-rolled line diff calculation engine (LCS, prefix/suffix trimming, gap collapsing). | Imported by `DiffView.svelte` | Props: N/A.<br>State: N/A. |
| `webview/markdown.ts:1-334` | Hand-rolled GFM Markdown renderer with streaming text softening & HTML escaping. | Imported by `Markdown.svelte` | Props: N/A.<br>State: N/A. |
| `webview/App.svelte:1-1042` | Root Svelte component. Owns app layout, status state, transcript array, header, status bar, composer, and popover panels. | Mounted by `main.ts` in `#root` | Props: None.<br>State: `status`, `blocks`, `showThinking`, `autoExpandThinking`, `revision`, `sessions`, `rewindPoints`, `panel`, `worktreeName`, `sessionQuery`, `pendingDelete`, `renamingId`, `renameDraft`, `draft`, `focusSignal`, `commandResult`, `jumpVisible`. |
| `webview/components/About.svelte:1-134` | About modal content (version, CLI link, repo link, disclaimer). | `App.svelte:296` inside `.popover` | Props: `agentVersion?: string`, `onClose: () => void`.<br>State: None. |
| `webview/components/Approval.svelte:1-158` | Permission gate card for file write/create and terminal command execution requests. | `Transcript.svelte:344` | Props: `block: ApprovalBlock`, `onDecide: (requestId, decision) => void`.<br>State: None. |
| `webview/components/CommandResult.svelte:1-176` | Scrim modal displaying output of utility slash commands (e.g. `/context`, `/compact`). | `App.svelte:261` | Props: `result: CommandResult`, `onClose: () => void`.<br>State: None. |
| `webview/components/Composer.svelte:1-914` | Prompt input surface with autogrow textarea, image attachments preview, command autocomplete, queue list, mode/model/effort dropdowns, and Send/Stop buttons. | `App.svelte:540` | Props: `text` (bindable), `status`, `commands`, `queuedMessages`, `focusSignal`, `onCancel`, `onClearQueue`, `onPushQueue`, `onSetModel`, `onSetEffort`, `onSetPermissionMode`, `onRestart`.<br>State: `input`, `fileInput`, `picked`, `attachments`, `sending`, `sendError`. |
| `webview/components/DiffView.svelte:1-167` | Visual diff block displaying added (+ green), removed (- red), unchanged lines, gutters, gap markers, and expand/collapse toggle. | `Approval.svelte:44`, `ToolCard.svelte:148,160` | Props: `oldText: string \| null`, `newText: string`, `maxRows?: number`, `preview?: boolean`.<br>State: `expanded`. |
| `webview/components/Header.svelte:1-254` | Header toolbar with title, "Unofficial" tag, New Session, History, Rewind, Toggle Thinking, and overflow menu. | `App.svelte:264` | Props: `showThinking`, `onNewSession`, `onToggleHistory`, `onToggleRewind`, `onToggleThinking`, `onOpenUserConfig`, `onShowLog`, `onRestart`, `onAbout`, `isGitRepo?`.<br>State: `menuOpen`. |
| `webview/components/Icon.svelte:1-109` | SVG icon renderer using inlined Lucide SVG path data. | `Header`, `App`, `Composer`, `ToolCard`, `Thinking`, `Approval`, `Question`, `PlanDock`, `PlanProposal`, `Notice`, `SetupCard`, `CommandResult`, `About` | Props: `name: IconName`, `size?: number`.<br>State: None. |
| `webview/components/Markdown.svelte:1-330` | HTML container for rendered markdown prose with event-delegated copy-code button listeners. | `Transcript.svelte:288,332`, `Thinking.svelte:34`, `PlanProposal.svelte:27`, `CommandResult.svelte:45` | Props: `text: string`, `streaming?: boolean`.<br>State: `root` DOM element ref. |
| `webview/components/Notice.svelte:1-131` | System notice cards/stripes for info, warn, and error system events with log viewer trigger. | `Transcript.svelte:346` | Props: `block: NoticeBlock`, `onShowLog: () => void`.<br>State: None. |
| `webview/components/PlanDock.svelte:1-194` | Collapsible todo/plan checklist drawer mounted above the composer. | `App.svelte:536` | Props: `entries: PlanEntry[]`.<br>State: `open`. |
| `webview/components/PlanProposal.svelte:1-133` | Interactive plan proposal card with markdown body, feedback input, Approve, Request Changes, and Reject buttons. | `Transcript.svelte:340` | Props: `block: ProposedPlanBlock`, `onDecide: (requestId, approve, feedback?) => void`.<br>State: `feedback`, `showFeedback`. |
| `webview/components/Question.svelte:1-404` | Multi-step interactive user interview wizard card (`_x.ai/ask_user_question`). | `Transcript.svelte:342` | Props: `block: QuestionBlock`, `onAnswer: (requestId, response) => void`.<br>State: `step`, `picks`, `notes`, `otherOpen`, `otherInput`. |
| `webview/components/SetupCard.svelte:1-149` | Recovery card rendered when Grok CLI is missing or unauthenticated. | `Transcript.svelte:242` | Props: `hint: SetupHint`.<br>State: None. |
| `webview/components/StatusLine.svelte:1-364` | Status bar showing agent state dot/label, session title, worktree/folder, context window %, token counts, cost ($), version, and compact context trigger. | `App.svelte:280` | Props: `status: UiStatus`.<br>State: None. |
| `webview/components/Thinking.svelte:1-115` | Collapsible reasoning block showing streaming status, wall-clock duration (seconds), word count, and markdown reasoning. | `Transcript.svelte:282,336` | Props: `block: ThinkingBlock`, `autoExpand: boolean`.<br>State: `manual`. |
| `webview/components/ToolCard.svelte:1-407` | Execution card for tools (read, write, edit, terminal command, search, fetch, list) with live output, diff, and open file buttons. | `Transcript.svelte:338` | Props: `block: ToolBlock`, `cwd?`, `onOpenPath`, `onOpenDiff`, `stacked?`.<br>State: `manual`. |
| `webview/components/Transcript.svelte:1-694` | Main message stream container. Handles sticky user prompt bar, scroll-to-bottom trigger, history loading state, empty state, and message row grouping. | `App.svelte:499` | Props: `blocks`, `showThinking`, `autoExpandThinking`, `cwd?`, `revision`, `agentState`, `setupHint?`, `loadingHistory?`, `jumpVisible` (bindable), `onJumpReady`, `onApprove`, `onPlanDecision`, `onAnswerQuestion`, `onOpenPath`, `onOpenDiff`, `onShowLog`.<br>State: `scroller`, `stuck`, `stickyUserId`, `expandedUsers`. |
| `webview/components/TurnFooter.svelte:1-63` | Metadata footer rendered at the end of an assistant turn showing token usage breakdown, duration, cost, and stop reason. | `Transcript.svelte:348` | Props: `block: TurnBlock`.<br>State: None. |

---

## 2. Transcript Block Types

Exhaustive list of all 9 transcript block kinds defined in `src/shared/protocol.ts:81-218`:

| Block Kind | Source of Truth | Displayed Fields | Interactive Affordances | Visual States |
| :--- | :--- | :--- | :--- | :--- |
| **`text`** | `src/shared/protocol.ts:81-95`<br>`TextBlock` | `role` ('user' \| 'assistant'), `text`, `images` (`PromptImage[]`), `wasQueued`, `streaming`. | • **User message**: Expand/Collapse button if >160 chars or >3 lines (`Transcript.svelte:303`). Clickable sticky header when scrolled past (`Transcript.svelte:222`). Image thumbnails with hover title (`Transcript.svelte:312`).<br>• **Assistant message**: Rendered via `Markdown.svelte` with copy-code button on code blocks (`Markdown.svelte:279`). | • **User**: `.user` container with accent border and tinted background (`Transcript.svelte:580`). Queued badge (`.was-queued`) with warning ring (`Transcript.svelte:599`). Collapsed (`.collapsed`) vs expanded text (`Transcript.svelte:513`).<br>• **Assistant**: `.assistant` container (`Transcript.svelte:650`). Streaming caret animation (`.gb-caret`, `App.svelte:723`). |
| **`thinking`** | `src/shared/protocol.ts:104-110`<br>`ThinkingBlock` | `text`, `streaming`, `durationMs` (seconds), word count. | • Header expand/collapse toggle button (`Thinking.svelte:23`).<br>• Grouped inside assistant message when preceding response text (`Transcript.svelte:282`). | • **Streaming**: `.streaming` with active purple left border (`var(--gb-think)`), title "Thinking…", sparkles icon, pulsing caret.<br>• **Completed**: Collapsed by default unless opened; title "Thought", duration (e.g. `2.4s`), word count (e.g. `42 words`). |
| **`tool`** | `src/shared/protocol.ts:112-131`<br>`ToolBlock` | `label`, `name`, `toolKind`, `status`, `readOnly`, `input`, `locations`, `contents` (text/diff), `liveOutput`, `waiting`, `error`. | • Header expand/collapse toggle (`ToolCard.svelte:116`).<br>• "diff" button: opens VS Code side-by-side diff editor (`ToolCard.svelte:131`).<br>• "open" button: opens file at line in VS Code editor (`ToolCard.svelte:136`).<br>• Embedded line diff "Show more" / "Collapse" toggle (`DiffView.svelte:50,52`). | • **Running/Pending**: Spinner animation (`.spinner`), status icon (`ToolCard.svelte:117`).<br>• **Failed**: `.failed` red border (`var(--gb-danger)`), error text displayed (`ToolCard.svelte:156`).<br>• **Waiting**: "waiting" badge (`ToolCard.svelte:128`).<br>• **Mutating**: "writes" badge (`ToolCard.svelte:129`).<br>• **Stacked**: Contiguous tool cards collapse top margin (`ToolCard.svelte:181`).<br>• **Collapsed**: Shows single line tail / peek diff.<br>• **Expanded**: Full output pre block (`.cmd`, `.out`, `terminal` console tint). |
| **`plan`** | `src/shared/protocol.ts:133-136`<br>`PlanBlock` | `entries` (`PlanEntry[]` with `content`, `status`). | • Filtered out of chat transcript stream (`Transcript.svelte:75`). Rendered in `PlanDock.svelte` above composer.<br>• Drawer expand/collapse button (`PlanDock.svelte:32`). | • Progress count `N/M`, mini fill bar (`PlanDock.svelte:36`).<br>• Task statuses: `completed` (green check, strikethrough text), `in_progress` (blue pulsing dot), `pending` (empty box). |
| **`proposedPlan`** | `src/shared/protocol.ts:138-144`<br>`ProposedPlanBlock` | `requestId`, `content` (Markdown plan text), `decision` ('approved' \| 'rejected'). | • "Approve & start coding" primary button (`PlanProposal.svelte:38`).<br>• "Request changes" button (reveals feedback textarea, `PlanProposal.svelte:46`).<br>• "Send feedback" button (`PlanProposal.svelte:42`).<br>• "Reject" danger button (`PlanProposal.svelte:47`). | • **Active**: 2px blue frame (`var(--gb-plan)`), action buttons enabled.<br>• **Answered**: `.answered` opacity 0.8, verdict badge ("Approved" or "Rejected"), feedback form hidden. |
| **`question`** | `src/shared/protocol.ts:180-187`<br>`QuestionBlock` | `requestId`, `questions` (`AskQuestion[]`), `answered`, `response` (`QuestionResponse`). | • Multi-step tab/dot navigation buttons (`Question.svelte:88`).<br>• Option choice buttons (radio for single-select, checkbox for multi-select, `Question.svelte:115`).<br>• "Other…" choice toggle and text input (`Question.svelte:135,143`).<br>• "Back", "Next", "Send" action buttons (`Question.svelte:160-166`).<br>• "Skip" button ("Let Grok continue without answers", `Question.svelte:168`). | • 2px purple frame (`var(--gb-think)`).<br>• **Active**: Step wizard dots, radio/checkbox control fills, option preview code box (`.preview`).<br>• **Answered**: `.answered` opacity 0.8, verdict "Answered", hint "Sent to Grok" or "Skipped". |
| **`approval`** | `src/shared/protocol.ts:189-194`<br>`ApprovalBlock` | `request` (`ApprovalRequest` with `kind`, `title`, `path`, `command`, `cwd`, `alwaysScope`, `oldText`, `newText`), `decision` (`ApprovalDecision`). | • Command actions: "Run", "Always allow", "Reject", "Never" (`Approval.svelte:51-62`).<br>• Write actions: "Apply", "Accept all edits", "Reject" (`Approval.svelte:51-57`).<br>• Embedded line diff for write requests (`Approval.svelte:44`). | • **Pending**: 2px warning frame (`var(--gb-warn)`), warning icon.<br>• **Answered**: `.answered` opacity 0.75, verdict badge ("Allowed once", "Allowed for the session", "Rejected", "Rejected for the session").<br>• **Rejected**: `.rejected` red frame (`var(--gb-danger)`). |
| **`notice`** | `src/shared/protocol.ts:196-199`<br>`NoticeBlock` | `level` ('info' \| 'warn' \| 'error'), `text` (title + monospace detail). | • "View log" / "log" button (`Notice.svelte:29,40`): posts `showLog` message to host to reveal VS Code output channel. | • **error**: Full card with red border (`var(--gb-danger)`), info icon, title, monospace detail block, "View log" button.<br>• **warn**: Inline banner with yellow border (`var(--gb-warn)`), warning icon, "log" link.<br>• **info**: Inline banner with rule border, info icon. |
| **`turn`** | `src/shared/protocol.ts:203-206`<br>`TurnBlock` | `stopReason`, `usage` (`inputTokens`, `outputTokens`, `cachedReadTokens`, `reasoningTokens`, `costUsdTicks`, `apiDurationMs`). | • None (informational summary row). | • Top border rule separator.<br>• Abnormal stop reason highlighted in yellow (`.stop`, `TurnFooter.svelte:59`).<br>• Token counts (`↑ 1.2k ↓ 450`), duration in seconds (`3.5s`), cost formatted as `$0.0012`. |

---

## 3. Chrome

### Header / Toolbar (`webview/components/Header.svelte:1-254`, `App.svelte:264-278`)
- **Brand Title**: "Grok Build UI" (`.gb-kicker`, `Header.svelte:44`) + "Unofficial" badge (`.gb-tag`, `Header.svelte:45`).
- **Toolbar Icon Buttons**:
  1. `New Session` (`plus` icon, `Header.svelte:49`): Sends `{ type: 'newSession' }`.
  2. `Session History` (`clock` icon, `Header.svelte:52`): Toggles history popover panel, sends `{ type: 'listSessions' }`.
  3. `Rewind` (`rewind` icon, `Header.svelte:55`): Toggles rewind/worktree popover panel, sends `{ type: 'listRewindPoints' }`. Disabled tooltip if not a git repository.
  4. `Toggle Thinking` (`sparkles` icon, `Header.svelte:62`): Toggles `showThinking` state, sends `{ type: 'toggleThinking', show }`. Dimmed when off (`.off`).
  5. `More Options` (`ellipsis` icon, `Header.svelte:70`): Toggles dropdown overflow menu (`menuOpen`).
- **Overflow Menu Items** (`Header.svelte:90-126`):
  - `Open user config` (`settings` icon): Sends `{ type: 'openUserConfig' }` (opens `~/.grok/config.toml`).
  - `MCP servers` (`server` icon, badge: "config only"): Disabled with tooltip ("Grok manages MCP servers itself...").
  - `Select skills…` (`layers` icon): Disabled with tooltip ("Leader-only TUI feature...").
  - Divider line.
  - `Output log` (`list` icon): Sends `{ type: 'showLog' }`.
  - `Restart agent` (`restart` icon, danger tone): Sends `{ type: 'restartAgent' }`.
  - Divider line.
  - `About` (`sparkles` icon): Toggles About popover panel.

### Status Line (`webview/components/StatusLine.svelte:1-364`, `App.svelte:280`)
- **State Indicator Dot & Label** (`StatusLine.svelte:56-66`): Colored state dot (`.idle` green, `.thinking` blue pulsing, `.awaitingApproval` yellow, `.starting` blue, `.stopped` gray) + fixed-width label slot (`ready`, `working` with animated 3-dot ellipsis, `waiting for you`, `starting…`, `stopped`).
- **Session Title** (`StatusLine.svelte:68-74`): Session title (`sessionTitle`) or "new session" italic fallback.
- **Workspace Folder** (`StatusLine.svelte:76`): Basename of active working directory (`cwd`).
- **Context Window Badge** (`StatusLine.svelte:81-91`): Displays `ctx N%` with color coding (`ok` green <70%, `warn` yellow 70-89%, `hot` red >=90%). Clicking triggers `/context` slash command.
- **Compact Context Button** (`StatusLine.svelte:93-112`): Appears when context is in `warn` or `hot` state. Triggers `{ type: 'compactContext' }`.
- **Token Counters** (`StatusLine.svelte:114-118`): Total tokens (`1.2M tok`, `15k tok`) with tooltip detailing cached reads.
- **Turn Cost** (`StatusLine.svelte:119-121`): Cumulative session cost formatted as `$0.045`.
- **Agent Version** (`StatusLine.svelte:122`): CLI version string (e.g. `0.2.112`).
- **Status Error Strip** (`StatusLine.svelte:125-130`): Short error banner below status line (`.error`, `.soft`).

### Composer (`webview/components/Composer.svelte:1-914`, `App.svelte:540-553`)
- **Textarea Input** (`Composer.svelte:452-460`): Autogrow height between 39px (2 lines) and 220px. Placeholder changes when agent is busy (`Queue a follow-up…` vs `Ask, paste a screenshot, or / for commands…`).
- **Attachments Preview Bar** (`Composer.svelte:423-451`): Thumbnails for staged images (up to 4 visible), `+N` overflow button to drop hidden images, remove button (`x`) on each thumbnail.
- **Paste & Compression Handling** (`Composer.svelte:289-354, 356-369`): Clipboard paste listener captures images, downscales screenshots via HTML canvas to max 1280px edge JPEG (quality 0.72) to prevent IPC failure.
- **Command Autocomplete Popup** (`Composer.svelte:389-398`): Triggered by `/` at start of input. Displays up to 8 matching commands with names and descriptions. Keyboard navigation (`ArrowUp`/`ArrowDown`/`Enter`/`Tab`).
- **Queue Banner** (`Composer.svelte:401-420`): Displayed above composer when `queuedCount > 0`. Shows badge count, "Waiting to send" title, "Send all now" link, "Clear" link, and list of queued messages with preview text and individual "Send" buttons.
- **Keybindings**:
  - `Enter` (without Shift): Submit prompt / interject message.
  - `Shift+Enter`: Insert newline.
  - `Esc`: Cancel current turn when busy (`onCancel()`), disarm armed session deletion, or close active popover panel.
  - `ArrowUp` / `ArrowDown` / `Tab` / `Enter`: Autocomplete popup selection.

### Toolbar Row Under Composer (`webview/components/Composer.svelte:467-538`)
- **Attach Image Button** (`Composer.svelte:480-488`): `image` icon button opening native file picker (`accept="image/*"`).
- **Permission Mode Dropdown** (`Composer.svelte:490-499`):
  - `Ask` (`default`): Approve every write & command (neutral).
  - `Accept edits` (`acceptEdits`): Writes auto-apply, commands ask (warn tone).
  - `Plan` (`plan`): Read-only until plan approved (plan tone).
  - `Bypass` (`bypassPermissions`): No prompts; agent writes & runs freely (danger tone).
- **Model Select Dropdown** (`Composer.svelte:501-513`): Populated from `status.models`.
- **Reasoning Effort Dropdown** (`Composer.svelte:515-525`): Rendered when the selected model defines `reasoningEfforts`.
- **Action Buttons** (`Composer.svelte:529-537`):
  - `Restart`: Shown when agent state is `stopped`.
  - `Stop`: Shown when agent state is busy (`thinking` / `awaitingApproval`).
  - `Send` / `Queue` / `Start` / `Sending…`: Main action button.

### Plan Dock Drawer (`webview/components/PlanDock.svelte:1-194`, `App.svelte:535-537`)
- In-flow drawer mounted above composer. Collapsed by default. Header displays chevron icon, "PLAN" kicker, count `done/total`, mini progress fill bar, and current step summary. Expands upward into a task list with check icons and pulsing progress dots.

### Scroll to Latest Pill (`App.svelte:522-533`)
- Floating pill anchored at bottom right of chat stream pane (`.chat-jump`). Displayed when scrolled up from bottom. Contains `arrowDown` icon and "Latest" label. Click triggers `scrollToBottom()`.

### Empty / First-Run State (`webview/components/Transcript.svelte:243-255`)
- Rendered when transcript `visible.length === 0` and no setup hint is active:
  - "Unofficial - Community UI for the Grok Build CLI — not affiliated with xAI."
  - "Ask Grok to do something in this workspace."
  - Shortcut hints: <kbd>Enter</kbd> sends, <kbd>Shift</kbd>+<kbd>Enter</kbd> adds line, paste screenshot, <kbd>Esc</kbd> stops turn.

---

## 4. Modals / Overlays

| Modal / Overlay Name | Trigger | Content & Input Fields | Buttons / Actions | Dismissal Mechanisms |
| :--- | :--- | :--- | :--- | :--- |
| **Session History Popover** | Clock icon in Header (`Header.svelte:52`) or `toggleHistory()`. | Search input filter (`Search sessions…`), list of recent sessions with session title, current pill, and relative timestamp (`when(updatedAt)`). | • Close `x` button (`App.svelte:301`).<br>• Search clear `x` button (`App.svelte:315`).<br>• Session title item button (loads session, `App.svelte:366`).<br>• Rename button (`edit` icon, opens inline form with text input, save check, cancel x, `App.svelte:331-364`).<br>• Delete button (`trash` icon, arms in-place to confirm check + cancel x, `App.svelte:386-414`). | • Backdrop click (`App.svelte:289`).<br>• Escape key (`App.svelte:168`).<br>• Header close button.<br>• Selecting a session. |
| **Rewind & Worktree Popover** | Rewind icon in Header (`Header.svelte:55`) or `toggleRewind()`. | List of rewind checkpoints (prompt label, relative timestamp), worktree name text input (`worktree name (optional)`). | • Close `x` button (`App.svelte:425`).<br>• Checkpoint item button (triggers `rewind(pointId)`).<br>• Worktree "Create" button (`App.svelte:453`).<br>• Worktree "Move session" button (`App.svelte:462`).<br>• Worktree "Open…" button (`App.svelte:470`).<br>• Worktree "Apply…" button (`App.svelte:471`).<br>• Worktree "Remove…" danger button (`App.svelte:479`). | • Backdrop click (`App.svelte:289`).<br>• Escape key (`App.svelte:168`).<br>• Header close button.<br>• Selecting a rewind point or worktree action. |
| **About Popover** | Overflow menu "About" item (`Header.svelte:122`) or `onAbout()`. | Extension title & "Unofficial" tag, community disclaimer paragraph, facts grid (Agent version, CLI domain, Repository URL). | • Close `x` button (`About.svelte:18`).<br>• `grok.x.ai` link button (`openExternal`).<br>• `GitHub` link button (`openExternal`). | • Backdrop click (`App.svelte:289`).<br>• Escape key (`App.svelte:168`).<br>• Close `x` button. |
| **Slash Command Result Modal** | Host sends `commandResult` message (`App.svelte:152`). | Header showing typed command (e.g. `/context`), title, spinner if pending, rendered Markdown body (`CommandResult.svelte:45`). | • Header close `x` button (`CommandResult.svelte:40`).<br>• Footer "Done" button (`CommandResult.svelte:48`). | • Scrim background click (`CommandResult.svelte:21`).<br>• Escape key.<br>• Header `x` button.<br>• Footer "Done" button. |
| **Context Compact Overlay** | "Compact" button on StatusLine when context >70% (`StatusLine.svelte:93,102`). | Status line warning badge. | • "Compact" button (triggers `{ type: 'compactContext' }`). | • Immediate message post to host host process. |
| **New Chat Action** | Plus icon in Header (`Header.svelte:49`). | Direct IPC action. | • Plus icon button (sends `{ type: 'newSession' }`). | • N/A (clears transcript state). |
| **Worktree QuickPick Trigger** | Rewind popover worktree buttons ("Move", "Open", "Apply", "Remove"). | Triggers VS Code native QuickPick UI in extension host. | • QuickPick options list. | • Host native QuickPick dismissal. |
| **User Config File Trigger** | Overflow menu "Open user config" (`Header.svelte:91`). | Direct IPC action. | • Menu item click (sends `{ type: 'openUserConfig' }`). | • Opens `~/.grok/config.toml` in editor. |

---

## 5. Styling Inventory

### CSS Architecture
- **No external `.css` files exist in the repository.**
- Component CSS is scoped inside `<style>` blocks in each `.svelte` file.
- Global resets, typography rules, scrollbar styles, focus rings, custom utility classes (`.gb-kicker`, `.gb-tag`, `.gb-meta`, `.gb-btn`, `.gb-caret`), and CSS variables live inside `:global(:root)` and `:global(body)` in `webview/App.svelte:564-735`.

### Complete List of `--vscode-*` CSS Variables Referenced (60 Unique Variables)

Every `--vscode-*` variable used across `webview/` with exact file and line locations:

1. `--vscode-badge-background`: `webview/App.svelte:667`, `webview/components/Header.svelte:244`
2. `--vscode-badge-foreground`: `webview/App.svelte:668`, `webview/components/Header.svelte:245`
3. `--vscode-button-background`: `webview/App.svelte:700,773`, `webview/components/CommandResult.svelte:163`, `webview/components/Composer.svelte:868`, `webview/components/SetupCard.svelte:126`
4. `--vscode-button-border`: `webview/App.svelte:687`
5. `--vscode-button-foreground`: `webview/App.svelte:701,776`, `webview/components/CommandResult.svelte:164`, `webview/components/Composer.svelte:869`, `webview/components/Question.svelte:308`, `webview/components/SetupCard.svelte:127`
6. `--vscode-button-hoverBackground`: `webview/App.svelte:705`, `webview/components/CommandResult.svelte:173`, `webview/components/SetupCard.svelte:131`
7. `--vscode-button-secondaryBackground`: `webview/App.svelte:689`, `webview/components/Composer.svelte:884`
8. `--vscode-button-secondaryForeground`: `webview/App.svelte:690`, `webview/components/Composer.svelte:885`
9. `--vscode-button-secondaryHoverBackground`: `webview/App.svelte:695`
10. `--vscode-charts-blue`: `webview/App.svelte:591`
11. `--vscode-charts-green`: `webview/App.svelte:590`, `webview/components/Markdown.svelte:206`
12. `--vscode-charts-purple`: `webview/App.svelte:592`
13. `--vscode-charts-yellow`: `webview/App.svelte:589`
14. `--vscode-checkbox-background`: `webview/components/Question.svelte:297`
15. `--vscode-checkbox-border`: `webview/components/Question.svelte:284`
16. `--vscode-checkbox-foreground`: `webview/components/Question.svelte:298`
17. `--vscode-descriptionForeground`: `webview/App.svelte:585`
18. `--vscode-diffEditor-insertedTextBackground`: `webview/components/DiffView.svelte:100`
19. `--vscode-diffEditor-removedTextBackground`: `webview/components/DiffView.svelte:104`
20. `--vscode-dropdown-background`: `webview/components/Composer.svelte:784,822,846,852`
21. `--vscode-dropdown-border`: `webview/components/Composer.svelte:782,824`
22. `--vscode-dropdown-foreground`: `webview/components/Composer.svelte:823`
23. `--vscode-editor-background`: `webview/App.svelte:583,614,774`, `webview/components/CommandResult.svelte:73`, `webview/components/Composer.svelte:608,734`, `webview/components/DiffView.svelte:63`, `webview/components/Question.svelte:308`, `webview/components/Thinking.svelte:52`, `webview/components/Transcript.svelte:379,449,501`
24. `--vscode-editor-font-family`: `webview/App.svelte:595`
25. `--vscode-editor-selectionBackground`: `webview/App.svelte:630`
26. `--vscode-editorLineNumber-foreground`: `webview/components/DiffView.svelte:117`
27. `--vscode-editorWarning-foreground`: `webview/App.svelte:589`
28. `--vscode-editorWidget-background`: `webview/App.svelte:583`
29. `--vscode-errorForeground`: `webview/App.svelte:588`
30. `--vscode-focusBorder`: `webview/App.svelte:624,904,964`, `webview/components/Composer.svelte:680,791`
31. `--vscode-font-family`: `webview/App.svelte:594,611`, `webview/components/StatusLine.svelte:256`
32. `--vscode-font-size`: `webview/App.svelte:612`
33. `--vscode-foreground`: `webview/App.svelte:613,776,856,943`, `webview/components/CommandResult.svelte:141`, `webview/components/Composer.svelte:569,715,735,789,885`, `webview/components/Header.svelte:173,219`, `webview/components/Markdown.svelte:191`, `webview/components/PlanDock.svelte:76`, `webview/components/Question.svelte:259,298`, `webview/components/SetupCard.svelte:88,102,138`, `webview/components/StatusLine.svelte:255,289,341`, `webview/components/Thinking.svelte:78`, `webview/components/ToolCard.svelte:209,286`, `webview/components/Transcript.svelte:595,662`
34. `--vscode-gitDecoration-addedResourceForeground`: `webview/components/DiffView.svelte:77`
35. `--vscode-gitDecoration-deletedResourceForeground`: `webview/components/DiffView.svelte:81`
36. `--vscode-icon-foreground`: `webview/components/Header.svelte:173`
37. `--vscode-input-background`: `webview/App.svelte:906,957,1010`, `webview/components/Composer.svelte:675`, `webview/components/PlanProposal.svelte:115`, `webview/components/Question.svelte:297,365`
38. `--vscode-input-border`: `webview/App.svelte:958,1012`, `webview/components/Composer.svelte:673`, `webview/components/PlanProposal.svelte:117`, `webview/components/Question.svelte:371`
39. `--vscode-input-foreground`: `webview/App.svelte:907,973,1011`, `webview/components/Composer.svelte:750`, `webview/components/PlanProposal.svelte:116`, `webview/components/Question.svelte:366`
40. `--vscode-list-activeSelectionBackground`: `webview/components/Composer.svelte:581`, `webview/components/Question.svelte:274`
41. `--vscode-list-activeSelectionForeground`: `webview/components/Composer.svelte:582`, `webview/components/Question.svelte:275`
42. `--vscode-list-hoverBackground`: `webview/App.svelte:863,873`, `webview/components/DiffView.svelte:156`, `webview/components/Header.svelte:226`, `webview/components/PlanDock.svelte:83`, `webview/components/Question.svelte:270`, `webview/components/ToolCard.svelte:219,305,325`
43. `--vscode-menu-background`: `webview/App.svelte:817`, `webview/components/Header.svelte:203`
44. `--vscode-menu-border`: `webview/App.svelte:818`, `webview/components/Header.svelte:204`
45. `--vscode-menu-foreground`: `webview/components/Header.svelte:219`
46. `--vscode-menu-selectionBackground`: `webview/components/Header.svelte:226`
47. `--vscode-menu-selectionForeground`: `webview/components/Header.svelte:227`
48. `--vscode-panel-background`: `webview/components/ToolCard.svelte:392`
49. `--vscode-panel-border`: `webview/App.svelte:581`
50. `--vscode-scrollbarSlider-background`: `webview/App.svelte:643`
51. `--vscode-scrollbarSlider-hoverBackground`: `webview/App.svelte:647`
52. `--vscode-sideBar-background`: `webview/App.svelte:614`, `webview/components/Transcript.svelte:378,448`
53. `--vscode-terminal-background`: `webview/components/ToolCard.svelte:392`
54. `--vscode-terminal-foreground`: `webview/components/ToolCard.svelte:393`
55. `--vscode-textBlockQuote-background`: `webview/components/Transcript.svelte:587`
56. `--vscode-textBlockQuote-border`: `webview/components/Markdown.svelte:249`
57. `--vscode-textCodeBlock-background`: `webview/App.svelte:584`
58. `--vscode-textLink-foreground`: `webview/App.svelte:587`
59. `--vscode-toolbar-hoverBackground`: `webview/App.svelte:714,942,1035`, `webview/components/About.svelte:131`, `webview/components/CommandResult.svelte:142`, `webview/components/Header.svelte:181`, `webview/components/Markdown.svelte:202`
60. `--vscode-widget-border`: `webview/App.svelte:580,581`

### Hardcoded Colors, Sizes, and Font Token Metrics

- **Hardcoded Colors & RGBA Values**:
  - Scrim dark backdrop: `color-mix(in srgb, #000 45%, transparent)` (`CommandResult.svelte:62`)
  - Green fallback: `#4caf50` (`App.svelte:590`, `Markdown.svelte:206`)
  - Yellow fallback: `#c9a227` (`App.svelte:589`)
  - Blue fallback: `#4a9eff` (`App.svelte:591`)
  - Purple fallback: `#b180d7` (`App.svelte:592`)
  - Git added green fallback: `#4ec97b` (`DiffView.svelte:77`)
  - Git deleted red fallback: `#e15c5c` (`DiffView.svelte:81`)
  - Rule fallbacks: `rgba(128, 128, 128, 0.28)`, `rgba(128, 128, 128, 0.45)` (`App.svelte:580-581`)
  - Sunken surface fallback: `rgba(128, 128, 128, 0.1)` (`App.svelte:584`)
  - Hover background fallback: `rgba(128, 128, 128, 0.2)` (`App.svelte:714,942,1035`, `About.svelte:131`, `CommandResult.svelte:142`, `Header.svelte:181`, `Markdown.svelte:202`)
  - Box shadow: `0 6px 20px rgba(0, 0, 0, 0.28)` (`App.svelte:600`), `0 2px 12px rgba(0, 0, 0, 0.18)` (`Transcript.svelte:451`)
  - Diff background fallbacks: `rgba(78, 201, 123, 0.14)`, `rgba(225, 92, 92, 0.14)` (`DiffView.svelte:100,104`)

- **Hardcoded Spacing, Sizes & Radii**:
  - `--gb-radius`: `6px` (`App.svelte:565`)
  - `--gb-radius-sm`: `4px` (`App.svelte:566`)
  - `--gb-radius-lg`: `8px` (`App.svelte:567`)
  - `--gb-gap`: `8px`, `--gb-gap-tight`: `5px`, `--gb-space`: `10px`, `--gb-space-lg`: `14px` (`App.svelte:568-571`)
  - `--gb-stack-gap`: `8px` (between transcript cards), `--gb-stack-turn`: `12px` (turn boundaries, `App.svelte:577-578`)
  - Popover max height: `65vh` (`App.svelte:815`)
  - Modal dimensions: `width: min(100%, 360px)`, `max-height: min(70vh, 420px)` (`CommandResult.svelte:66-67`)
  - Composer input min height: `39px`, max height `220px` (`Composer.svelte:43,44,743,747`)
  - Image thumbnail size: `36px x 36px` (`Composer.svelte:691-692`)
  - Sticky header thumbnail: `22px x 22px` (`Transcript.svelte:477-478`)

- **Hardcoded Font Sizes & Typography**:
  - `--gb-kicker-size`: `11px` (`App.svelte:596`)
  - `--gb-meta-size`: `11px` (`App.svelte:597`)
  - Tag labels (`.gb-tag`): `10px`, font-weight 700 (`App.svelte:661`, `Header.svelte:242`)
  - Monospace code & diff font sizes: `10px`, `11px`, `11.5px`, `12px`, `13px` (`DiffView.svelte:59,72`, `ToolCard.svelte:277,333,360,380`, `Composer.svelte:752`, `PlanProposal.svelte:120`, `Question.svelte:262,374,385`, `SetupCard.svelte:98,117`)

---

## 6. Iconography

- **Icon System**: Hand-curated **Lucide** (https://lucide.dev) glyph paths inlined directly into `webview/components/Icon.svelte:12-71`.
- **Rationale**: Webview Content Security Policy (`font-src ${cspSource}`) prevents external webfont loading, and VS Code Codicons are not natively exposed to webviews. Inlined SVG paths allow zero-dependency rendering in `currentColor` that automatically inherits active theme colors.
- **Exhaustive Icon Catalog (25 Icons)**:
  1. `plus`: New session toolbar button (`Header.svelte:50`).
  2. `clock`: Session history toolbar button (`Header.svelte:53`).
  3. `rewind`: Rewind toolbar button (`Header.svelte:60`).
  4. `restart`: Restart agent button (`Header.svelte:118`, `SetupCard.svelte:43`).
  5. `sparkles`: Toggle thinking button (`Header.svelte:68`), About menu item (`Header.svelte:123`), Thought block header (`Thinking.svelte:24`), Question card header (`Question.svelte:85`).
  6. `ellipsis`: More options menu button (`Header.svelte:77`).
  7. `settings`: Open user config menu item (`Header.svelte:92`).
  8. `server`: MCP servers menu item (`Header.svelte:100`).
  9. `layers`: Select skills menu item (`Header.svelte:109`), Plan proposal card header (`PlanProposal.svelte:20`).
  10. `list`: Output log menu item (`Header.svelte:114`), Search tool kind (`ToolCard.svelte:15`).
  11. `warning`: Approval card warning icon (`Approval.svelte:32`), Notice warning level (`Notice.svelte:36`).
  12. `info`: Notice info level & error card icon (`Notice.svelte:24,36`).
  13. `edit`: Session rename button (`App.svelte:380`), Edit/Write tool cards (`ToolCard.svelte:10-13`).
  14. `terminal`: Terminal command tool cards (`ToolCard.svelte:9`).
  15. `file`: Fallback file tool cards (`ToolCard.svelte:83`).
  16. `search`: Session search input (`App.svelte:306`), Search tool cards (`ToolCard.svelte:14,16`).
  17. `chevron`: Plan dock drawer toggle (`PlanDock.svelte:33`), Thought collapse toggle (`Thinking.svelte:31`).
  18. `check`: Session rename/delete confirm (`App.svelte:354,395`), Plan step completed (`PlanDock.svelte:45`), Question check mark (`Question.svelte:126,137`).
  19. `trash`: Session delete button (`App.svelte:412`).
  20. `close`: Close popovers, modals, attachments (`App.svelte:301,316,399,425`, `About.svelte:18`, `CommandResult.svelte:41`, `Composer.svelte:433`, `ToolCard.svelte:121`).
  21. `image`: Attach image button (`Composer.svelte:487`).
  22. `paperclip`: Staged attachment icon (`Icon.svelte:59`).
  23. `arrowDown`: Scroll-to-latest jump button (`App.svelte:530`).
  24. `send`: Prompt send icon (`Icon.svelte:63`).
  25. `copy`: Copy code button in Markdown blocks (`Markdown.svelte:270`, `Icon.svelte:65`).

---

## 7. Responsive Constraints

- **Minimum Sidebar Width**:
  - Explicitly handles narrow sidebars down to **280px–300px** (`App.svelte:137,794`, `DiffView.svelte:94`, `Markdown.svelte:324`).
  - Flex wrapping (`flex-wrap: wrap; row-gap: 6px`) applied to Header toolbar (`Header.svelte:143-145`), Composer dropdown row (`Composer.svelte:799-804`), and Approval/Setup action button groups (`Approval.svelte:145`, `SetupCard.svelte:107`) to prevent clipping.
  - Strict text truncation (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`) enforced on session titles, workspace folder names, model dropdowns, tool target paths, and search items.
- **Code & Line Diff Text Wrapping Rules**:
  - Line diffs and code blocks do NOT scroll horizontally in narrow sidebars; lines use `white-space: pre-wrap; overflow-wrap: anywhere;` (`DiffView.svelte:94-96,135`, `Markdown.svelte:241-242`, `ToolCard.svelte:363-364,383-384`). Gutters stay pinned on the left while wrapped code lines hang neatly under the line box.
- **Table Responsiveness**:
  - GFM Markdown tables scroll horizontally within an isolated container (`display: block; max-width: 100%; overflow-x: auto;`, `Markdown.svelte:272-275`) without blowing out the sidebar width.
- **Overlay & Popover Clamping**:
  - Header popovers (`.popover`) clamped to `max-height: 65vh; overflow-y: auto; left: 8px; right: 8px;` (`App.svelte:809-821`).
  - Command result modal clamped to `width: min(100%, 360px); max-height: min(70vh, 420px);` (`CommandResult.svelte:65-76`).
- **Editor-Area Panel Compatibility**:
  - Root container scales fluidly with `height: 100vh; display: flex; flex-direction: column;` (`App.svelte:736-741`). When opened as a full editor tab, the message stream and composer expand to fill available horizontal space while controls and dropdowns maintain max-width limits.

---

## 8. Feature List to Preserve

A flat checklist of every user-facing capability visible in the webview UI:

- [ ] **Streaming Response Rendering**: Live streaming token output with animated caret (`.gb-caret`) and Copilot/Claude-style streaming markdown softening.
- [ ] **Reasoning / Thinking Collapse**: Collapsible thought blocks displaying streaming status, wall-clock duration in seconds, word count, and markdown body.
- [ ] **Tool Call Execution Cards**: Contiguous cards for file reads, writes, edits, searches, lists, and terminal commands with live output, status indicators, and stacked layout support.
- [ ] **Inline Line Diffs**: Added (+ green) and removed (- red) line diff rendering with line number gutters, gap markers, and expand/collapse controls.
- [ ] **One-Click File Opening**: Direct "open" action button on tool cards to launch target file in VS Code editor at exact line number.
- [ ] **One-Click Diff Opening**: Direct "diff" action button on tool cards to open native VS Code side-by-side diff editor.
- [ ] **Terminal Command Cards**: Live stdout/stderr streaming with console terminal styling (`.out.terminal`).
- [ ] **Permission Gate Approvals**: 4-mode approval cards for file writes and commands offering Run/Apply once, Always allow/Accept all, Reject, and Never decisions.
- [ ] **Permission Mode Selector**: Composer dropdown to dynamically switch modes (Ask / Accept edits / Plan / Bypass).
- [ ] **Model Selector Dropdown**: Dynamic model switcher populated from host Grok CLI capabilities.
- [ ] **Reasoning Effort Selector**: Dropdown selector for reasoning effort modes (e.g. low / medium / high) when supported by selected model.
- [ ] **Interactive User Interview Wizard**: Multi-step question cards (`_x.ai/ask_user_question`) with single-select radio options, multi-select checkboxes, custom "Other…" text input, and Skip option.
- [ ] **Proposed Plan Review**: Plan review card with full markdown body, Approve & Start Coding button, Request Changes feedback form, and Reject button.
- [ ] **Active Plan Checklist Dock**: In-flow collapsible task drawer mounted above composer showing progress meter (`done/total`), completed checks, and pulsing active step dot.
- [ ] **Image Staging & Attachment**: Staging screenshots/images via file picker button or direct clipboard paste, with thumbnail previews, overflow handling, removal buttons, and downscaling compression to 1280px JPEG.
- [ ] **Slash Command Autocomplete**: Popup menu triggered by `/` in composer listing available commands with descriptions and arrow key navigation.
- [ ] **Slash Command Utility Modal**: Overlay scrim modal displaying output for slash commands (e.g. `/context`, `/compact`).
- [ ] **Session History Management**: Popover drawer to search past sessions, switch active session, inline rename session title, and armed delete confirmation.
- [ ] **Rewind Checkpoints**: Popover drawer listing prompt checkpoints to roll back conversation transcript and agent state to a previous prompt index.
- [ ] **Git Worktree Sandboxing**: UI controls to Create, Move session, Open, Apply, and Remove git worktree sandboxes.
- [ ] **Pinned Sticky User Prompt Bar**: Top overlay bar displaying pinned user prompt text and thumbnail when scrolling up past earlier turns.
- [ ] **Scroll-to-Latest Floating Pill**: Floating "Latest" jump button appearing on bottom right when scrolled up from recent messages.
- [ ] **Draft Persistence**: Automatic saving and reloading of un-sent composer draft text across webview hide/show state cycles (`saveDraft`/`loadDraft`).
- [ ] **Autogrow Composer Textarea**: Dynamic textarea resizing from 39px (2 lines) to 220px.
- [ ] **Queued Messages Strip**: Queue banner above composer showing waiting message count, "Send all now", "Clear", and per-item "Send" action buttons.
- [ ] **Status HUD Bar**: Header bar displaying agent state dot/label, session title, working directory folder, context window % badge, token totals, turn cost ($), and CLI version.
- [ ] **Context Pressure & One-Click Compact**: Warning/Hot indicator when context >70% with direct "Compact" button to compact context.
- [ ] **Setup & Recovery Cards**: Friendly guidance card for missing CLI, unauthenticated state, or start failure with direct install URL link and retry trigger.
- [ ] **Output Log Viewer Trigger**: Quick action to reveal VS Code output channel log from header menu or notice cards.
- [ ] **Agent Restart Trigger**: Action button to restart background Grok CLI process from header menu, composer, or setup card.
- [ ] **Copy Code Button**: One-click copy control on fenced code blocks with instant "Copied" feedback state.
- [ ] **External Link Opening**: Direct opening of external HTTPS URLs in default browser (`openExternal`).
