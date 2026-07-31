/**
 * The contract between the extension host and the webview.
 *
 * The host owns the authoritative transcript and streams granular patches; the webview is a
 * pure renderer plus input surface. That split keeps the UI cheap to redesign — every visual
 * decision lives in webview/, and nothing in here needs to change to move things around.
 */

import type {
  AvailableCommand,
  PlanEntry,
  ToolCallContent,
  ToolCallStatus,
  ToolKind,
  ToolLocation,
  TurnUsage,
} from '../acp/types'

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'bypassPermissions'

/** `resume` creates a worktree *and* copies the current chat into a session rooted there. */
export type WorktreeAction = 'create' | 'resume' | 'list' | 'apply' | 'remove'

export type ApprovalDecision = 'once' | 'always' | 'reject' | 'rejectAlways'

/** What the extension is gating. `agentPermission` is grok's own request, forwarded verbatim. */
export type ApprovalKind = 'write' | 'command' | 'agentPermission'

export interface ApprovalRequest {
  requestId: string
  kind: ApprovalKind
  title: string
  /** For writes: the file being changed. */
  path?: string
  /** For writes: a diff the UI can render directly. */
  oldText?: string
  newText?: string
  /** For commands. */
  command?: string
  cwd?: string
  /** The "allow always" scope this decision would remember, e.g. `Write(src/**)`, `Bash(npm test:*)`. */
  alwaysScope?: string
  /** Options as sent by the agent, when this originated from session/request_permission. */
  agentOptions?: { optionId: string; name: string; kind: string }[]
  toolCallId?: string
}

export interface TranscriptBlockBase {
  id: string
  ts: number
  /**
   * Which prompt in the session produced this block (`_meta.promptIndex`). Rewind targets a
   * prompt index, so this is what lets us truncate the transcript to match the agent.
   */
  promptIndex?: number
}

/** Image the user attached/pasted. Host may save to disk and set `path`. */
export interface PromptImage {
  id: string
  mimeType: string
  /**
   * Full image base64 for the agent (may be stripped from transcript UI messages to keep IPC small).
   */
  data: string
  /**
   * Tiny JPEG/PNG base64 for chat thumbnails only — always small enough to round-trip in blockAdd.
   */
  preview?: string
  name?: string
  /** Absolute path once the host wrote the file into the workspace. */
  path?: string
  /** webview.asWebviewUri string, filled by the panel when posting to the webview. */
  webviewUri?: string
}

export interface TextBlock extends TranscriptBlockBase {
  kind: 'text'
  role: 'user' | 'assistant'
  text: string
  streaming: boolean
  /**
   * True while a message is waiting in the composer queue (should not appear in the transcript).
   * Kept for back-compat; the live queue is `UiStatus.queuedMessages`.
   */
  queued?: boolean
  /** Sent after sitting in the queue (or force-pushed) — shown as a badge in the transcript. */
  wasQueued?: boolean
  /** Screenshots / pasted images on this user message. */
  images?: PromptImage[]
}

/** A follow-up waiting in the composer until the current turn ends (or Send now). */
export interface QueuedMessage {
  id: string
  text: string
  images?: PromptImage[]
}

export interface ThinkingBlock extends TranscriptBlockBase {
  kind: 'thinking'
  text: string
  streaming: boolean
  /** Wall time spent streaming this block, filled in when it closes. */
  durationMs?: number
}

export interface ToolBlock extends TranscriptBlockBase {
  kind: 'tool'
  toolCallId: string
  /** grok's internal tool name, e.g. `read_file`, `search_replace`, `run_terminal_command`. */
  name: string
  /** Human label from `_meta["x.ai/tool"].label`, e.g. "Read", "Run Command". */
  label: string
  toolKind: ToolKind | 'unknown'
  title: string
  status: ToolCallStatus
  readOnly: boolean
  input?: Record<string, unknown>
  locations: ToolLocation[]
  contents: ToolCallContent[]
  /** Live stdout/stderr while a command runs, before grok reports the final content. */
  liveOutput?: string
  /** True between `pending_interaction` and `interaction_resolved`, or while we hold an approval. */
  waiting: boolean
  error?: string
}

export interface PlanBlock extends TranscriptBlockBase {
  kind: 'plan'
  entries: PlanEntry[]
}

export interface ProposedPlanBlock extends TranscriptBlockBase {
  kind: 'proposedPlan'
  requestId: string
  content: string
  /** Set once answered; the card stays in the transcript as a record. */
  decision?: 'approved' | 'rejected'
}

export interface AskQuestionOption {
  label: string
  description?: string
  /** Longer content grok wants shown while the option is focused. Single-select questions only. */
  preview?: string
}

/** One question from `_x.ai/ask_user_question`, normalised by the host. */
export interface AskQuestion {
  question: string
  header?: string
  multiSelect: boolean
  options: AskQuestionOption[]
}

/** What grok echoes back per question: the free-text note, and the preview of the pick. */
export interface QuestionAnnotation {
  notes?: string
  preview?: string
}

/**
 * Mirrors grok's `AskUserQuestionExtResponse` — a serde enum *internally tagged* on `outcome`.
 * Sending anything without that tag fails the tool call with "missing field `outcome`".
 * Answers are keyed by the question text; a value is a string, or an array for multi-select.
 */
export type QuestionResponse =
  | {
      outcome: 'accepted'
      answers: Record<string, string | string[]>
      annotations: Record<string, QuestionAnnotation>
    }
  | { outcome: 'skip_interview' }

export interface QuestionBlock extends TranscriptBlockBase {
  kind: 'question'
  requestId: string
  questions: AskQuestion[]
  answered: boolean
  /** Set once answered, so the card can show what was sent instead of the live form. */
  response?: QuestionResponse
}

export interface ApprovalBlock extends TranscriptBlockBase {
  kind: 'approval'
  request: ApprovalRequest
  /** Set once answered; keeps an audit trail in the transcript. */
  decision?: ApprovalDecision
}

export interface NoticeBlock extends TranscriptBlockBase {
  kind: 'notice'
  level: 'info' | 'warn' | 'error'
  text: string
}

export interface TurnBlock extends TranscriptBlockBase {
  kind: 'turn'
  stopReason?: string
  usage?: TurnUsage
}

export type TranscriptBlock =
  | TextBlock
  | ThinkingBlock
  | ToolBlock
  | PlanBlock
  | ProposedPlanBlock
  | QuestionBlock
  | ApprovalBlock
  | NoticeBlock
  | TurnBlock

/** A reasoning effort is an ACP *mode*: `id` is what `session/set_mode` takes. */
export interface ReasoningEffort {
  id: string
  label: string
  description?: string
}

export interface ModelInfo {
  modelId: string
  name: string
  contextTokens?: number
  supportsReasoningEffort?: boolean
  reasoningEfforts?: ReasoningEffort[]
}

export interface SessionSummary {
  sessionId: string
  title: string
  cwd: string
  updatedAt: number
}

export interface RewindPoint {
  id: string
  label: string
  ts?: number
}

export type AgentState =
  | 'stopped'
  | 'starting'
  | 'idle'
  | 'thinking'
  | 'awaitingApproval'

export interface UiStatus {
  agentState: AgentState
  agentVersion?: string
  sessionId?: string
  /**
   * Human title for the open session (auto-summary from grok, or a rename). Shown in the status
   * line so the user can tell which conversation is live without opening history.
   */
  sessionTitle?: string
  cwd?: string
  isGitRepo?: boolean
  permissionMode: PermissionMode
  currentModelId?: string
  reasoningEffort?: string
  models: ModelInfo[]
  availableCommands: AvailableCommand[]
  /** Cumulative across the session, so the HUD survives multiple turns. */
  totals: {
    inputTokens: number
    outputTokens: number
    cachedReadTokens: number
    reasoningTokens: number
    costUsd: number
    turns: number
  }
  /** Context window size (from model or session/info). */
  contextTokens?: number
  /**
   * Tokens used in context (prefer live `_x.ai/session/info`; falls back to last turn total).
   */
  lastTurnTotalTokens?: number
  queuedCount: number
  /** Live queue shown above the composer — not in the transcript until sent. */
  queuedMessages: QueuedMessage[]
  /**
   * Active todo/plan checklist for the session (from ACP `plan` updates). Rendered above the
   * composer, not as a transcript card.
   */
  planEntries?: PlanEntry[]
  /**
   * True while session/load is replaying history. UI should show a loading shell and skip
   * auto-scroll thrash until a single full state flush arrives.
   */
  loadingHistory?: boolean
  /** Short status-line error; prefer `setupHint` for missing-CLI / auth guidance. */
  error?: string
  /**
   * Friendly setup card when the agent cannot start (CLI missing, not signed in, etc.).
   * Cleared automatically once `ensureStarted` succeeds.
   */
  setupHint?: SetupHint
}

/** User-facing recovery for a stopped agent that needs install / auth / retry. */
export interface SetupHint {
  kind: 'missing-cli' | 'not-authenticated' | 'start-failed'
  title: string
  detail: string
  /** Official install / product page (open in external browser). */
  installUrl?: string
}

/**
 * Result of a slash/utility command (`/context`, `/compact`, …). Shown in a modal so it does
 * not pollute the chat transcript.
 */
export interface CommandResult {
  id: string
  /** What the user typed, e.g. `/context`. */
  command: string
  title: string
  /** Plain or light markdown body. */
  body: string
  kind: 'info' | 'success' | 'warn' | 'error'
  ts: number
}

export interface UiState {
  status: UiStatus
  blocks: TranscriptBlock[]
  showThinking: boolean
  autoExpandThinking: boolean
}

/**
 * Where a block carrying `anchorId` belongs. The anchor is a tool call id; the block goes just
 * after that tool's card, past anything already parked there. Host and webview both call this so
 * the two transcripts stay index-for-index identical.
 */
export function insertionIndex(
  blocks: TranscriptBlock[],
  anchorId: string | undefined,
): number {
  if (!anchorId) return blocks.length
  const at = blocks.findIndex(
    (b) => b.kind === 'tool' && b.toolCallId === anchorId,
  )
  if (at < 0) return blocks.length
  let i = at + 1
  while (
    i < blocks.length &&
    (blocks[i].kind === 'approval' || blocks[i].kind === 'question')
  )
    i++
  return i
}

// ---------------------------------------------------------------- host → webview

export type HostMessage =
  | { type: 'state'; state: UiState }
  | {
      type: 'blockAdd'
      block: TranscriptBlock
      /**
       * Place the block next to the tool card it belongs to instead of at the end. grok announces
       * several tool calls before it asks permission for the first one, so a tail append would
       * show the approval below tools it has nothing to do with.
       */
      anchorId?: string
    }
  | {
      type: 'blockPatch'
      id: string
      patch: Record<string, unknown>
      /** Appended to the block's `text` — avoids resending a long stream on every chunk. */
      appendText?: string
      /** Appended to a tool block's `liveOutput`. */
      appendOutput?: string
    }
  | { type: 'blockRemove'; id: string }
  | { type: 'status'; status: UiStatus }
  | { type: 'clear' }
  | { type: 'sessions'; sessions: SessionSummary[] }
  | { type: 'rewindPoints'; points: RewindPoint[] }
  | { type: 'insertText'; text: string }
  | { type: 'focusInput' }
  /** Slash / utility command finished — show in a modal, not as chat bubbles. */
  | { type: 'commandResult'; result: CommandResult }
  /** Resolved webview palette (`followVsCode` is already resolved on the host). */
  | { type: 'theme'; theme: 'dark' | 'light' }

// ---------------------------------------------------------------- webview → host

export type WebviewMessage =
  | { type: 'ready' }
  /** Persist an explicit dark/light choice to `grokBuild.theme` (never `followVsCode`). */
  | { type: 'setTheme'; theme: 'dark' | 'light' }
  /**
   * Upload one image before prompt. Prefer this over inlining base64 on `prompt` — large
   * postMessage payloads are dropped silently by VS Code.
   */
  | {
      type: 'stageImage'
      id: string
      mimeType: string
      data: string
      /** Tiny thumb for the chat bubble after full `data` is stripped. */
      preview?: string
      name?: string
    }
  | {
      type: 'prompt'
      text: string
      images?: PromptImage[]
      stagedImageIds?: string[]
    }
  | {
      type: 'interject'
      text: string
      images?: PromptImage[]
      stagedImageIds?: string[]
    }
  | { type: 'clearQueue' }
  /**
   * Force the queue into Grok now. Stops the current turn (if any), then sends either every
   * waiting message or the one identified by `blockId` first (others stay queued).
   */
  | { type: 'pushQueue'; blockId?: string }
  | { type: 'cancel' }
  | { type: 'approve'; requestId: string; decision: ApprovalDecision }
  | {
      type: 'planDecision'
      requestId: string
      approve: boolean
      feedback?: string
    }
  | { type: 'answerQuestion'; requestId: string; response: QuestionResponse }
  | { type: 'setPermissionMode'; mode: PermissionMode }
  | { type: 'setModel'; modelId: string }
  | { type: 'setReasoningEffort'; effort: string }
  | { type: 'newSession' }
  | { type: 'listSessions' }
  | { type: 'loadSession'; sessionId: string }
  /** Remove a saved session from grok's store; the host answers with a refreshed `sessions` list. */
  | { type: 'deleteSession'; sessionId: string }
  /** Rename via `_x.ai/session/rename`. Host refreshes `sessions` and, if current, `status.sessionTitle`. */
  | { type: 'renameSession'; sessionId: string; title: string }
  | { type: 'listRewindPoints' }
  | { type: 'rewind'; pointId: string }
  | { type: 'worktree'; action: WorktreeAction; name?: string }
  | { type: 'openPath'; path: string; line?: number }
  /** Open the edit a tool card is showing in VS Code's diff editor, before vs. current. */
  | { type: 'openDiff'; blockId: string }
  | { type: 'restartAgent' }
  | { type: 'showLog' }
  /** Open ~/.grok/config.toml — the CLI's own settings file, which we never parse ourselves. */
  | { type: 'openUserConfig' }
  | { type: 'toggleThinking'; show: boolean }
  /** Open an https URL in the system browser (install docs, etc.). */
  | { type: 'openExternal'; url: string }
  /** Run a Grok slash/utility command without (ideally) polluting the chat. */
  | { type: 'slashCommand'; text: string }
  /** Compact the conversation context window via ACP when available. */
  | { type: 'compactContext' }
  /** Refresh context used/total from `_x.ai/session/info`. */
  | { type: 'refreshContext' }
