import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'

import { AcpClient, RpcError } from '../acp/client'
import { redact } from '../acp/redact'
import type {
  AgentModel,
  AvailableCommand,
  ContentBlock,
  CreateTerminalParams,
  InitializeResponse,
  NewSessionResponse,
  PlanEntry,
  PromptResponse,
  ReadTextFileParams,
  RequestPermissionParams,
  SessionNotification,
  SessionUpdate,
  ToolCallContent,
  ToolCallUpdatePayload,
  ToolKind,
  TurnUsage,
  WriteTextFileParams,
} from '../acp/types'
import { insertionIndex } from '../shared/protocol'
import type {
  ApprovalDecision,
  ApprovalRequest,
  AskQuestion,
  HostMessage,
  ModelInfo,
  NoticeBlock,
  PermissionMode,
  SetupHint,
  CommandResult,
  PromptImage,
  QuestionResponse,
  QueuedMessage,
  RewindPoint,
  SessionSummary,
  TextBlock,
  ThinkingBlock,
  ToolBlock,
  TranscriptBlock,
  UiState,
  UiStatus,
  WorktreeAction,
} from '../shared/protocol'
import { showAgentDiff } from './diffView'
import {
  agentCloudToolHint,
  cloudDriveHint,
  isCloudPath,
  pathKey,
  FsBridge,
} from './fsBridge'
import { PermissionGate } from './permissions'
import { TerminalBridge } from './terminalBridge'

const CONFIG_SECTION = 'grokBuild'

/**
 * Extension methods are `_` + the name grok uses internally (ACP's extension convention). The
 * underscore is required: the bare `x.ai/...` form is rejected as an unknown method.
 *
 * Every entry here was confirmed callable against grok 0.2.112 by `tools/probe-methods.mjs`;
 * re-run it after a grok upgrade. Names that exist in the binary but are *not* callable by an
 * ACP client — `queue/interject`, `toggle_plan_mode`, `permissions/reset`, `git/worktree/status`
 * — are deliberately absent; grok's own TUI reaches those over its private leader channel.
 */
const X = {
  rewindPoints: '_x.ai/rewind/points',
  rewindExecute: '_x.ai/rewind/execute',
  sessionsList: '_x.ai/sessions/list',
  sessionSummaries: '_x.ai/session_summaries/session_list',
  sessionRename: '_x.ai/session/rename',
  sessionInfo: '_x.ai/session/info',
  sessionUsage: '_x.ai/session/usage',
  compactConversation: '_x.ai/compact_conversation',
  worktreeCreate: '_x.ai/git/worktree/create',
  worktreeResume: '_x.ai/git/worktree/resume_session',
  worktreeList: '_x.ai/git/worktree/list',
  worktreeRemove: '_x.ai/git/worktree/remove',
  worktreeApply: '_x.ai/git/worktree/apply',
} as const

/**
 * Plan mode has no protocol switch: grok exposes `enter_plan_mode` / `exit_plan_mode` as
 * model-side tools and `session/new` advertises no ACP modes, so the only lever a client has is
 * the prompt plus the write/command gate in `PermissionGate`. Prepended to every turn while the
 * mode is active — the transcript still shows the user's own text.
 */
const PLAN_MODE_PREAMBLE = [
  '<system-reminder>',
  'Plan mode is active. Research and read freely, but do not modify files and do not run shell',
  'commands — the client blocks both and the attempt will fail. When you know what you would do,',
  'call exit_plan_mode with the plan so the user can approve it.',
  '</system-reminder>',
].join('\n')

export interface SessionDeps {
  cwd: string
  post: (msg: HostMessage) => void
  log: (line: string) => void
  /** Remember which session to resume for this workspace after reload. */
  getLastSessionId?: () => string | undefined
  setLastSessionId?: (sessionId: string | undefined) => void
}

interface Deferred<T> {
  resolve: (v: T) => void
  reject: (e: Error) => void
}

interface QueuedInterjection {
  id: string
  text: string
  images?: PromptImage[]
}

interface WorktreeEntry {
  id: string
  path: string
  label: string
  status: string
  commit: string
}

function rpcFail(code: number, message: string): Error {
  return Object.assign(new Error(message), { rpc: { code, message } })
}

/** Append agent-facing cloud recovery hint when the path/cwd is on Drive/OneDrive/etc. */
function withCloudToolHint(filePathOrCwd: string, message: string): string {
  if (!isCloudPath(filePathOrCwd)) return message
  if (message.includes('CLOUD_PATH_HINT')) return message
  return `${message}\n\n${agentCloudToolHint(filePathOrCwd)}`
}

function settings() {
  const c = vscode.workspace.getConfiguration(CONFIG_SECTION)
  return {
    cliPath: c.get<string>('cliPath') || 'grok',
    permissionMode: (c.get<string>('permissionMode') ||
      'default') as PermissionMode,
    model: c.get<string>('model') || undefined,
    reasoningEffort: c.get<string>('reasoningEffort') || undefined,
    showThinking: c.get<boolean>('showThinking') ?? true,
    autoExpandThinking: c.get<boolean>('autoExpandThinking') ?? false,
    readUnsavedBuffers: c.get<boolean>('readUnsavedBuffers') ?? true,
    applyEditsAsWorkspaceEdit:
      c.get<boolean>('applyEditsAsWorkspaceEdit') ?? true,
    useSharedLeader: c.get<boolean>('useSharedLeader') ?? true,
    terminalOutputByteLimit: c.get<number>('terminalOutputByteLimit') ?? 65536,
    logProtocol: c.get<boolean>('logProtocol') ?? false,
  }
}

/**
 * Owns one grok agent process and the transcript derived from it.
 *
 * The webview never talks to the agent directly: every UI action lands on a method here, and
 * every wire update is normalised into a transcript block before it goes out. That keeps the
 * protocol quirks (snake_case updates, `_x.ai/*` methods, grok's internally-resolved permission
 * checkpoint) in one place.
 */
export class GrokSession implements vscode.Disposable {
  private client: AcpClient | undefined
  private sessionId: string | undefined
  private starting: Promise<void> | undefined

  private readonly gate: PermissionGate
  private readonly fs: FsBridge
  private readonly terminals: TerminalBridge

  private blocks: TranscriptBlock[] = []
  private status: UiStatus
  private blockSeq = 0
  private approvalSeq = 0

  private openText: TextBlock | undefined
  private openThinking: ThinkingBlock | undefined
  private thinkingStartedAt = 0
  private currentPromptIndex: number | undefined

  private readonly toolBlocks = new Map<string, ToolBlock>()
  /**
   * Early tool signals held until there is something worth showing (path, command, …).
   * Prevents the empty "READ" flash before "READ file.txt".
   */
  private readonly toolHolds = new Map<
    string,
    {
      name?: string
      /** Latest payload while we wait for a displayable target. */
      payload?: ToolCallUpdatePayload
      timer?: ReturnType<typeof setTimeout>
    }
  >()
  private readonly terminalToBlock = new Map<string, string>()
  private lastExecuteBlockId: string | undefined
  private lastMutatingToolCallId: string | undefined
  /** The tool call still in flight, so cards it raises (approvals, questions) can sit under it. */
  private lastToolCallId: string | undefined

  private readonly approvals = new Map<
    string,
    { request: ApprovalRequest; d: Deferred<ApprovalDecision> }
  >()
  private readonly planRequests = new Map<
    string,
    Deferred<{ approve: boolean; feedback?: string }>
  >()
  private readonly questionRequests = new Map<
    string,
    Deferred<QuestionResponse>
  >()

  private turnActive = false
  private cancelling = false
  /**
   * Slash/utility mode: agent text is buffered into a modal result instead of chat bubbles.
   */
  private utilityMode = false
  private utilityCommand = ''
  private utilityBuffer = ''
  /** Run after the in-flight turn (slash commands queued while busy). */
  private pendingSlash: string | undefined
  private readonly interjections: QueuedInterjection[] = []
  /**
   * Next prompt to run after the current turn is cancelled (force-push one queued message).
   * Remaining interjections stay queued and flush afterward.
   */
  private forceNext:
    | { text: string; images?: PromptImage[]; wasQueued?: boolean }
    | undefined
  /**
   * Images staged from the webview one-by-one (avoids giant prompt postMessages). Cleared after
   * the next prompt/interject consumes them.
   */
  private readonly stagedImages = new Map<string, PromptImage>()
  /**
   * While true, transcript mutations stay local — session/load replays thousands of updates and
   * streaming each one to the webview freezes the UI with scroll thrash.
   */
  private replayingHistory = false
  /**
   * Paths successfully read via `fs/read_text_file` this session. Existing files must be read
   * before write (Claude-style) — also hydrates Google Drive placeholders before edit.
   */
  private readonly readPaths = new Set<string>()
  private rawRewindPoints = new Map<string, Record<string, unknown>>()
  private worktreeNotice: NoticeBlock | undefined
  private readonly knownSessions = new Map<string, SessionSummary>()
  /**
   * Sessions the user has deleted. grok keeps a deleted session resident in memory until it
   * restarts, so `_x.ai/sessions/list` would hand it straight back after the store entry is gone.
   */
  private readonly deletedSessions = new Set<string>()
  /**
   * Whether a prompt has been sent in the current session. `+` reuses an unused session instead of
   * asking for another one — otherwise every click left a blank session behind in grok's store.
   */
  private sessionUsed = false

  constructor(private readonly deps: SessionDeps) {
    const s = settings()
    this.gate = new PermissionGate(s.permissionMode)
    this.fs = new FsBridge({
      readUnsavedBuffers: () => settings().readUnsavedBuffers,
      applyAsWorkspaceEdit: () => settings().applyEditsAsWorkspaceEdit,
    })
    this.terminals = new TerminalBridge({
      defaultCwd: deps.cwd,
      outputByteLimit: () => settings().terminalOutputByteLimit,
      onOutput: (terminalId, chunk) => this.onTerminalOutput(terminalId, chunk),
      onExit: () => undefined,
      log: deps.log,
    })
    this.status = {
      agentState: 'stopped',
      cwd: deps.cwd,
      permissionMode: s.permissionMode,
      reasoningEffort: s.reasoningEffort,
      models: [],
      availableCommands: [],
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        cachedReadTokens: 0,
        reasoningTokens: 0,
        costUsd: 0,
        turns: 0,
      },
      queuedCount: 0,
      queuedMessages: [],
    }
  }

  private syncQueueStatus(): void {
    this.status.queuedCount = this.interjections.length
    this.status.queuedMessages = this.interjections.map(
      (i): QueuedMessage => ({
        id: i.id,
        text: i.text,
        images: i.images,
      }),
    )
    this.pushStatus()
  }

  private rememberSession(sessionId: string | undefined): void {
    this.deps.setLastSessionId?.(sessionId)
  }

  // ------------------------------------------------------------------ lifecycle

  getState(): UiState {
    const s = settings()
    return {
      status: this.status,
      blocks: this.blocks,
      showThinking: s.showThinking,
      autoExpandThinking: s.autoExpandThinking,
    }
  }

  private pushStatus(): void {
    // Status is allowed during replay so the loading spinner can stay honest.
    this.deps.post({ type: 'status', status: this.status })
  }

  private beginHistoryReplay(): void {
    // Clear the webview first (replaying mute would suppress the clear post).
    this.replayingHistory = false
    this.clearTranscript()
    this.readPaths.clear()
    this.replayingHistory = true
    this.status.loadingHistory = true
    this.status.planEntries = undefined
    this.status.agentState = 'starting'
    this.pushStatus()
  }

  private endHistoryReplay(): void {
    this.replayingHistory = false
    this.status.loadingHistory = false
    this.closeStreams()
    // One full snapshot replaces the muted stream of blockAdd/patch during load.
    this.deps.post({ type: 'state', state: this.getState() })
    this.pushStatus()
  }

  async ensureStarted(): Promise<void> {
    if (this.client?.running && this.sessionId) return
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = undefined
      })
    }
    return this.starting
  }

  private async start(): Promise<void> {
    const s = settings()
    this.status.agentState = 'starting'
    this.status.error = undefined
    this.status.setupHint = undefined
    this.pushStatus()

    const client = new AcpClient({
      cliPath: s.cliPath,
      cwd: this.deps.cwd,
      // The gate lives in this extension, so grok itself must not second-guess us. Anything the
      // user has not approved never reaches grok's tools in the first place.
      permissionMode: 'bypassPermissions',
      model: s.model,
      reasoningEffort: s.reasoningEffort,
      useSharedLeader: s.useSharedLeader,
      log: this.deps.log,
      onFrame: (dir, frame) => {
        if (settings().logProtocol)
          this.deps.log(
            `${dir === 'out' ? '→' : '←'} ${redact(JSON.stringify(frame))}`,
          )
      },
      onStderr: (chunk) => this.deps.log(`[grok stderr] ${chunk.trimEnd()}`),
      onExit: (code, signal) => this.onAgentExit(code, signal),
    })
    this.client = client
    client.onRequest((method, params) =>
      this.handleAgentRequest(method, params),
    )
    client.onNotification((method, params) =>
      this.handleAgentNotification(method, params),
    )
    client.start()

    try {
      const init = await client.request<InitializeResponse>('initialize', {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
        clientInfo: { name: 'grok-build-unofficial', version: '0.1.0' },
      })
      this.status.agentVersion = init._meta?.agentVersion
      if (init._meta?.availableCommands)
        this.status.availableCommands = init._meta.availableCommands
      // Seed model/effort menus before session/load — load does not always populate `models`,
      // which left the UI stuck on "loading…" after resume.
      this.seedModelsFromInit(init)
      this.pushStatus()

      // Prefer resuming the last real conversation for this folder — `session/new` always
      // leaves a blank untitled session in grok's store if we call it on every panel open.
      const resumed = await this.tryResumeSession(client)
      if (!resumed) {
        const session = await client.request<NewSessionResponse>(
          'session/new',
          {
            cwd: this.deps.cwd,
            mcpServers: [],
          },
        )
        this.applySessionResponse(session)
        // Brand-new blank session is not "used" yet; don't pin it as last until a prompt lands.
      }
      // Never block the idle transition on a hung set_model — menus already have seed data.
      await Promise.race([
        this.applyPreferredConfig(),
        new Promise<void>((r) => setTimeout(r, 2500)),
      ])
    } catch (err) {
      const message =
        err instanceof RpcError
          ? `${err.rpc.message} (code ${err.rpc.code})`
          : (err as Error).message
      this.deps.log(`agent start failed: ${message}`)
      this.status.agentState = 'stopped'
      this.status.setupHint = classifyStartFailure(message, s.cliPath)
      // Short line for the status strip — full technical text stays in the log / setup card.
      this.status.error = this.status.setupHint.title
      this.pushStatus()
      // No raw stack notice in chat — Setup card is the recovery path.
      client.dispose()
      this.client = undefined
      throw err
    }

    this.status.agentState = 'idle'
    this.status.error = undefined
    this.status.setupHint = undefined
    this.pushStatus()
    this.deps.log(
      `session ready: ${this.sessionId} (grok ${this.status.agentVersion ?? '?'})`,
    )
    void this.refreshContext()
    const driveHint = cloudDriveHint(this.deps.cwd)
    if (driveHint) this.addNotice('info', driveHint)
  }

  private applySessionResponse(session: NewSessionResponse): void {
    this.sessionId = session.sessionId
    this.sessionUsed = false
    this.status.sessionId = session.sessionId
    // Fresh sessions have no summary yet; keep a known title if we already saw this id.
    this.status.sessionTitle = this.knownSessions.get(session.sessionId)?.title
    this.status.cwd = session._meta?.currentWorkingDirectory ?? this.deps.cwd
    this.status.isGitRepo = session._meta?.isGitRepo
    this.status.models = (session.models?.availableModels ?? []).map(
      toModelInfo,
    )
    this.status.currentModelId = session.models?.currentModelId
    const current = session.models?.availableModels?.find(
      (m) => m.modelId === session.models?.currentModelId,
    )
    this.status.contextTokens = current?._meta?.totalContextTokens
    // `category: "mode"` options are reasoning efforts, not ACP modes — see docs/acp-findings.md.
    const selectedEffort = session._meta?.['x.ai/sessionConfig']?.options?.find(
      (o) => o.category === 'mode' && o.selected,
    )
    // Prefer the user's saved effort/model over whatever the agent advertised for a fresh session.
    const preferred = settings()
    this.status.reasoningEffort =
      preferred.reasoningEffort ||
      selectedEffort?.id ||
      current?._meta?.reasoningEffort ||
      this.status.reasoningEffort
    this.status.permissionMode = preferred.permissionMode
    this.gate.setMode(preferred.permissionMode)
  }

  /**
   * Resume last session for this cwd (workspaceState) or the most recent on-disk session with
   * messages. Avoids creating a fresh untitled entry on every VS Code reload.
   */
  private async tryResumeSession(client: AcpClient): Promise<boolean> {
    const candidates: string[] = []
    const remembered = this.deps.getLastSessionId?.()
    if (remembered) candidates.push(remembered)
    const onDisk = await readSessionsFromDisk(this.deps.cwd, this.deps.log)
    onDisk.sort((a, b) => b.updatedAt - a.updatedAt)
    for (const s of onDisk) {
      if (!candidates.includes(s.sessionId)) candidates.push(s.sessionId)
    }
    for (const sessionId of candidates) {
      try {
        this.beginHistoryReplay()
        // load can return the same shape as session/new (models + meta) — apply if present.
        const loaded = await client.request<NewSessionResponse>(
          'session/load',
          {
            sessionId,
            cwd: this.deps.cwd,
            mcpServers: [],
          },
        )
        if (loaded?.sessionId) {
          // Preserve seed models if load omits the list (common).
          const seededModels = this.status.models
          const seededModelId = this.status.currentModelId
          this.applySessionResponse(loaded)
          if (this.status.models.length === 0 && seededModels.length > 0) {
            this.status.models = seededModels
            this.status.currentModelId =
              seededModelId ?? seededModels[0]?.modelId
          }
        } else {
          this.sessionId = sessionId
          this.status.sessionId = sessionId
        }
        this.sessionUsed = true
        const known = this.knownSessions.get(sessionId)
        const disk = onDisk.find((s) => s.sessionId === sessionId)
        this.status.sessionTitle =
          known?.title && known.title !== '(untitled)'
            ? known.title
            : disk?.title && disk.title !== '(untitled)'
              ? disk.title
              : (this.status.sessionTitle ?? known?.title)
        this.rememberSession(this.sessionId ?? sessionId)
        this.deps.log(
          `resumed session ${this.sessionId ?? sessionId} (${this.blocks.length} blocks)`,
        )
        this.endHistoryReplay()
        return true
      } catch (err) {
        this.deps.log(`resume ${sessionId} failed: ${(err as Error).message}`)
        this.replayingHistory = false
        this.status.loadingHistory = false
        this.clearTranscript()
      }
    }
    return false
  }

  /** Fill model/effort dropdowns from initialize when session/load skips the models object. */
  private seedModelsFromInit(init: InitializeResponse): void {
    if (this.status.models.length > 0) return
    const ms = init._meta?.modelState as
      | {
          currentModelId?: string
          availableModels?: AgentModel[]
          defaultModelId?: string
          models?: AgentModel[]
        }
      | undefined
    const raw =
      ms?.availableModels ??
      ms?.models ??
      (Array.isArray(ms) ? (ms as AgentModel[]) : undefined)
    if (raw?.length) {
      this.status.models = raw.map(toModelInfo)
      this.status.currentModelId =
        ms?.currentModelId ?? ms?.defaultModelId ?? raw[0]?.modelId
      const cur = this.status.models.find(
        (m) => m.modelId === this.status.currentModelId,
      )
      this.status.contextTokens = cur?.contextTokens
      if (!this.status.reasoningEffort && cur?.reasoningEfforts?.length) {
        this.status.reasoningEffort =
          cur.reasoningEfforts.find((e) => e.id === 'high')?.id ??
          cur.reasoningEfforts[0]?.id
      }
      return
    }
    // Last resort so the UI never sits on "loading…" with an empty list.
    const fallbackId =
      settings().model ||
      (typeof ms?.currentModelId === 'string' ? ms.currentModelId : '') ||
      'grok-4.5'
    this.status.models = [
      {
        modelId: fallbackId,
        name: fallbackId,
        supportsReasoningEffort: true,
        reasoningEfforts: [
          { id: 'high', label: 'High Effort' },
          { id: 'medium', label: 'Medium Effort' },
          { id: 'low', label: 'Low Effort' },
        ],
      },
    ]
    this.status.currentModelId = fallbackId
    this.status.reasoningEffort =
      settings().reasoningEffort || this.status.reasoningEffort || 'high'
  }

  /**
   * Re-apply user VS Code settings after session/new (agent defaults otherwise win every restart).
   * Model / effort are written Global so they stick across workspaces.
   */
  private async applyPreferredConfig(): Promise<void> {
    const s = settings()
    this.gate.setMode(s.permissionMode)
    this.status.permissionMode = s.permissionMode
    if (s.model && s.model !== this.status.currentModelId) {
      await this.setModel(s.model, /*persist*/ false)
    }
    if (
      s.reasoningEffort &&
      s.reasoningEffort !== this.status.reasoningEffort
    ) {
      await this.setReasoningEffort(s.reasoningEffort, /*persist*/ false)
    }
    this.pushStatus()
  }

  private persistSetting(key: string, value: string | undefined): void {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION)
    const v = value ?? ''
    // Write both scopes: an older build stored permissionMode only on Workspace, which would
    // otherwise keep winning over Global forever.
    void config.update(key, v, vscode.ConfigurationTarget.Global)
    void config.update(key, v, vscode.ConfigurationTarget.Workspace)
  }

  /** Keep status.sessionTitle and knownSessions in lockstep for the open chat. */
  private setSessionTitle(sessionId: string, title: string): void {
    const clean = title.trim() || '(untitled)'
    const prev = this.knownSessions.get(sessionId)
    this.knownSessions.set(sessionId, {
      sessionId,
      title: clean,
      cwd: prev?.cwd ?? this.status.cwd ?? this.deps.cwd,
      updatedAt: Date.now(),
    })
    if (sessionId === this.sessionId) {
      this.status.sessionTitle = clean === '(untitled)' ? undefined : clean
      this.pushStatus()
    }
  }

  private onAgentExit(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    this.sessionId = undefined
    this.turnActive = false
    this.status.agentState = 'stopped'
    this.status.sessionId = undefined
    this.status.sessionTitle = undefined
    this.status.error = `grok exited (code=${code}, signal=${signal})`
    this.terminals.disposeAll()
    this.rejectAllPendingUi('The agent stopped.')
    this.addNotice('error', `grok exited (code=${code}, signal=${signal}).`)
    this.pushStatus()
  }

  async restart(): Promise<void> {
    this.client?.dispose()
    this.client = undefined
    this.sessionId = undefined
    this.status.sessionId = undefined
    this.status.sessionTitle = undefined
    this.terminals.disposeAll()
    this.gate.reset()
    this.clearTranscript()
    await this.ensureStarted()
  }

  dispose(): void {
    this.client?.dispose()
    this.terminals.disposeAll()
  }

  // ------------------------------------------------------------------ transcript helpers

  private nextId(prefix: string): string {
    return `${prefix}-${++this.blockSeq}`
  }

  private addBlock<T extends TranscriptBlock>(block: T, anchorId?: string): T {
    if (block.promptIndex === undefined)
      block.promptIndex = this.currentPromptIndex
    this.blocks.splice(insertionIndex(this.blocks, anchorId), 0, block)
    if (!this.replayingHistory) {
      this.deps.post({ type: 'blockAdd', block, anchorId })
    }
    return block
  }

  private patch(block: TranscriptBlock, patch: Record<string, unknown>): void {
    Object.assign(block, patch)
    if (!this.replayingHistory) {
      this.deps.post({ type: 'blockPatch', id: block.id, patch })
    }
  }

  private removeBlock(id: string): void {
    const index = this.blocks.findIndex((b) => b.id === id)
    if (index < 0) return
    this.blocks.splice(index, 1)
    if (!this.replayingHistory) {
      this.deps.post({ type: 'blockRemove', id })
    }
  }

  /**
   * Coalesce stream tokens (~1 frame) before postMessage. Grok emits word/fragment chunks;
   * painting each one re-parses Markdown and feels like pixel crawl. Host memory still gets
   * every token immediately — only the webview is batched (same approach as other editor chats).
   */
  private readonly streamPending = new Map<string, string>()
  private streamFlushTimer: ReturnType<typeof setTimeout> | undefined
  private static readonly STREAM_FLUSH_MS = 32

  private appendText(block: TextBlock | ThinkingBlock, text: string): void {
    block.text += text
    if (this.replayingHistory) return
    const prev = this.streamPending.get(block.id) ?? ''
    this.streamPending.set(block.id, prev + text)
    if (this.streamFlushTimer === undefined) {
      this.streamFlushTimer = setTimeout(
        () => this.flushStreamPending(),
        GrokSession.STREAM_FLUSH_MS,
      )
    }
  }

  private flushStreamPending(): void {
    if (this.streamFlushTimer !== undefined) {
      clearTimeout(this.streamFlushTimer)
      this.streamFlushTimer = undefined
    }
    if (this.streamPending.size === 0) return
    for (const [key, chunk] of this.streamPending) {
      if (!chunk) continue
      if (key.startsWith('out:')) {
        this.deps.post({
          type: 'blockPatch',
          id: key.slice(4),
          patch: {},
          appendOutput: chunk,
        })
      } else {
        this.deps.post({
          type: 'blockPatch',
          id: key,
          patch: {},
          appendText: chunk,
        })
      }
    }
    this.streamPending.clear()
  }

  private onTerminalOutput(terminalId: string, chunk: string): void {
    const blockId = this.terminalToBlock.get(terminalId)
    if (!blockId) return
    const block = this.blocks.find((b) => b.id === blockId)
    if (!block || block.kind !== 'tool') return
    block.liveOutput = (block.liveOutput ?? '') + chunk
    // Reuse the text-stream coalesce map under a side key so terminal spam does not
    // postMessage every few bytes either.
    const key = `out:${blockId}`
    const prev = this.streamPending.get(key) ?? ''
    this.streamPending.set(key, prev + chunk)
    if (this.streamFlushTimer === undefined) {
      this.streamFlushTimer = setTimeout(
        () => this.flushStreamPending(),
        GrokSession.STREAM_FLUSH_MS,
      )
    }
  }

  private addNotice(level: 'info' | 'warn' | 'error', text: string): void {
    this.addBlock({
      id: this.nextId('notice'),
      ts: Date.now(),
      kind: 'notice',
      level,
      text,
    })
  }

  private clearTranscript(): void {
    this.blocks = []
    this.toolBlocks.clear()
    this.clearAllToolHolds()
    this.terminalToBlock.clear()
    this.openText = undefined
    this.openThinking = undefined
    this.currentPromptIndex = undefined
    if (!this.replayingHistory) {
      this.deps.post({ type: 'clear' })
    }
  }

  private closeStreams(): void {
    // Push any coalesced tokens before we mark the block closed, or the last ~32ms of text
    // would land after streaming:false and briefly re-open incomplete-markdown mode.
    this.flushStreamPending()
    if (this.openText) {
      this.patch(this.openText, { streaming: false })
      this.openText = undefined
    }
    if (this.openThinking) {
      this.patch(this.openThinking, {
        streaming: false,
        durationMs: Date.now() - this.thinkingStartedAt,
      })
      this.openThinking = undefined
    }
  }

  // ------------------------------------------------------------------ prompting

  /** Receive one compressed image from the webview before the prompt that references it. */
  stageImage(img: PromptImage): void {
    if (!img.id || !img.data) return
    this.stagedImages.set(img.id, {
      id: img.id,
      mimeType: img.mimeType || 'image/jpeg',
      data: img.data,
      preview: img.preview,
      name: img.name,
    })
    this.deps.log(
      `staged image ${img.id} (${img.mimeType || '?'}, ${img.data.length} b64 chars)`,
    )
  }

  private takeStagedImages(
    images?: PromptImage[],
    stagedImageIds?: string[],
  ): PromptImage[] | undefined {
    const out: PromptImage[] = []
    if (images?.length) out.push(...images)
    for (const id of stagedImageIds ?? []) {
      const img = this.stagedImages.get(id)
      if (img) {
        out.push(img)
        this.stagedImages.delete(id)
      } else {
        this.deps.log(`staged image missing: ${id}`)
      }
    }
    return out.length ? out : undefined
  }

  async prompt(
    text: string,
    images?: PromptImage[],
    stagedImageIds?: string[],
  ): Promise<void> {
    const trimmed = text.trim()
    const imgs = this.takeStagedImages(images, stagedImageIds)
    if (!trimmed && !imgs?.length) {
      this.addNotice('warn', 'Nothing to send (empty message and no images).')
      return
    }
    // Pure slash commands (no attachments) go through the utility path — modal result, not chat.
    if (trimmed && isSlashOnly(trimmed) && !imgs?.length) {
      await this.slashCommand(trimmed)
      return
    }
    try {
      await this.ensureStarted()
    } catch {
      return // start() already reported the failure in the transcript
    }
    if (this.turnActive) {
      // Staged ids were already resolved into `imgs` — don't re-take them.
      this.interject(trimmed, imgs)
      return
    }
    const saved = await this.materializeImages(imgs)
    // Transcript UI must not depend on full-size base64 (stripped after stage). Keep only a
    // tiny `preview` (+ path for panel→webviewUri). Full `data` stays on `saved` for the agent.
    const forUi = saved?.map((s) => ({
      id: s.id,
      mimeType: s.mimeType,
      name: s.name,
      path: s.path,
      preview: s.preview || undefined,
      data: '',
    }))
    this.addBlock<TextBlock>({
      id: this.nextId('user'),
      ts: Date.now(),
      kind: 'text',
      role: 'user',
      text: trimmed || (saved?.length ? '(image attachment)' : ''),
      streaming: false,
      images: forUi,
    })
    await this.runTurn(
      trimmed || 'Please look at the attached image(s).',
      saved,
    )
  }

  private async runTurn(text: string, images?: PromptImage[]): Promise<void> {
    const client = this.client
    if (!client || !this.sessionId) return
    this.sessionUsed = true
    this.rememberSession(this.sessionId)
    this.turnActive = true
    this.cancelling = false
    // Fresh turn — previous plan dock is stale (todo list from last task).
    this.clearPlan()
    this.status.agentState = 'thinking'
    this.pushStatus()
    try {
      const res = await this.promptWithImageFallback(text, images)
      this.closeStreams()
      if (res.stopReason && res.stopReason !== 'end_turn') {
        this.addNotice('info', `Turn ended: ${res.stopReason}`)
      }
    } catch (err) {
      this.closeStreams()
      const msg =
        err instanceof RpcError
          ? `${err.rpc.message} (code ${err.rpc.code})`
          : (err as Error).message
      if (!this.cancelling) this.addNotice('error', `Prompt failed: ${msg}`)
    } finally {
      this.turnActive = false
      this.clearPlan()
      this.status.agentState = this.client?.running ? 'idle' : 'stopped'
      this.pushStatus()
      // Prefer live session/info over last-turn usage for the context HUD.
      void this.refreshContext()
      await this.flushAfterTurn()
    }
  }

  /**
   * Run a Grok slash/utility command. Prefer a modal result (no chat pollution). If a turn is
   * already running, queue and run when it ends.
   */
  async slashCommand(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return
    try {
      await this.ensureStarted()
    } catch {
      return
    }
    if (this.turnActive || this.utilityMode) {
      this.pendingSlash = trimmed
      this.addNotice(
        'info',
        `Queued ${trimmed.split(/\s+/)[0]} — runs when the current turn finishes.`,
      )
      return
    }
    await this.executeSlash(trimmed)
  }

  /** Compact conversation context (ACP), then refresh the HUD. */
  async compactContext(): Promise<void> {
    await this.slashCommand('/compact')
  }

  /** Pull live context used/total from `_x.ai/session/info`. */
  async refreshContext(): Promise<void> {
    const client = this.client
    if (!client?.running || !this.sessionId) return
    try {
      const raw = await client.request(X.sessionInfo, {
        sessionId: this.sessionId,
      })
      const info = unwrapResult(raw) as Record<string, unknown>
      const ctx = (info.context ?? info) as Record<string, unknown>
      const used = numberFrom(ctx, ['used', 'usedTokens', 'totalTokens'])
      const total = numberFrom(ctx, ['total', 'totalTokens', 'limit', 'max'])
      // Avoid treating total as both used and total when only one field exists.
      const usedN =
        typeof used === 'number'
          ? used
          : numberFrom(info, ['used', 'totalTokens'])
      const totalN =
        typeof total === 'number' && total !== usedN
          ? total
          : (numberFrom(info, ['total', 'contextTokens']) ??
            this.status.contextTokens)
      if (typeof usedN === 'number') this.status.lastTurnTotalTokens = usedN
      if (typeof totalN === 'number' && totalN > 0)
        this.status.contextTokens = totalN
      this.pushStatus()
    } catch (err) {
      this.deps.log(`session/info: ${(err as Error).message}`)
    }
  }

  private async executeSlash(text: string): Promise<void> {
    const parsed = parseSlash(text)
    if (!parsed) {
      await this.prompt(text)
      return
    }
    const { name, args } = parsed
    switch (name) {
      case 'context':
      case 'ctx':
        await this.runContextCommand(text)
        return
      case 'compact':
      case 'compress':
      case 'summarize':
        await this.runCompactCommand(text)
        return
      case 'usage':
      case 'cost':
        await this.runUsageCommand(text)
        return
      default:
        // Unknown slash: still utility-mode so the agent reply lands in a modal, not the chat.
        await this.runUtilityPrompt(text, `/${name}${args ? ` ${args}` : ''}`)
        return
    }
  }

  private async runContextCommand(command: string): Promise<void> {
    await this.refreshContext()
    const used = this.status.lastTurnTotalTokens
    const total = this.status.contextTokens
    const pct =
      used != null && total
        ? Math.min(100, Math.round((used / total) * 100))
        : undefined
    const lines = [
      pct != null ? `**Context:** ${pct}% full` : '**Context**',
      used != null && total
        ? `${formatTokens(used)} / ${formatTokens(total)} tokens used`
        : used != null
          ? `${formatTokens(used)} tokens used (window size unknown)`
          : 'Could not read context from the agent. Try again after a turn.',
      this.status.currentModelId
        ? `Model: \`${this.status.currentModelId}\``
        : '',
      this.status.sessionId
        ? `Session: \`${this.status.sessionId.slice(0, 8)}…\``
        : '',
    ].filter(Boolean)
    this.postCommandResult({
      command,
      title: 'Context',
      body: lines.join('\n\n'),
      kind:
        pct != null && pct >= 90
          ? 'warn'
          : pct != null && pct >= 70
            ? 'info'
            : 'success',
    })
  }

  private async runCompactCommand(command: string): Promise<void> {
    const client = this.client
    if (!client || !this.sessionId) {
      this.postCommandResult({
        command,
        title: 'Compact',
        body: 'No active session.',
        kind: 'error',
      })
      return
    }
    const beforeUsed = this.status.lastTurnTotalTokens
    const beforeTotal = this.status.contextTokens
    const beforePct =
      beforeUsed != null && beforeTotal
        ? Math.min(100, Math.round((beforeUsed / beforeTotal) * 100))
        : undefined
    // Immediate modal so the user sees progress (compact can take several seconds).
    this.postCommandResult({
      command,
      title: 'Compacting…',
      body: [
        'Shrinking conversation context. This can take a moment — leave this open.',
        beforePct != null
          ? `Before: **${beforePct}%** (${formatTokens(beforeUsed!)} / ${formatTokens(beforeTotal!)}).`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      kind: 'info',
    })
    this.status.agentState = 'thinking'
    this.pushStatus()
    try {
      const raw = await client.request(X.compactConversation, {
        sessionId: this.sessionId,
      })
      const body = unwrapResult(raw)
      this.deps.log(
        `compact_conversation ok: ${typeof body === 'object' ? JSON.stringify(body).slice(0, 200) : String(body).slice(0, 200)}`,
      )
      await this.refreshContext()
      const used = this.status.lastTurnTotalTokens
      const total = this.status.contextTokens
      const pct =
        used != null && total
          ? Math.min(100, Math.round((used / total) * 100))
          : undefined
      const detail = formatUtilityPayload(body)
      const lines = [
        detail ?? 'Conversation context was compacted successfully.',
        beforePct != null && pct != null
          ? `**${beforePct}% → ${pct}%** (${formatTokens(beforeUsed!)} → ${formatTokens(used!)} of ${formatTokens(total!)}).`
          : pct != null
            ? `Now **${pct}%** (${formatTokens(used!)} / ${formatTokens(total!)}).`
            : '',
      ].filter(Boolean)
      this.postCommandResult({
        command,
        title: 'Context compacted',
        body: lines.join('\n\n'),
        kind: 'success',
      })
    } catch (err) {
      // Method may be missing on some CLI builds — fall back to asking the agent.
      this.deps.log(`compact_conversation: ${(err as Error).message}`)
      this.postCommandResult({
        command,
        title: 'Compacting…',
        body: 'Native compact unavailable — asking the agent to summarize instead…',
        kind: 'info',
      })
      await this.runUtilityPrompt(
        '/compact',
        'Please compact/summarize this conversation to free context. Confirm when done and report approximate context remaining.',
      )
    } finally {
      this.status.agentState = this.client?.running ? 'idle' : 'stopped'
      this.pushStatus()
    }
  }

  private async runUsageCommand(command: string): Promise<void> {
    const client = this.client
    if (!client || !this.sessionId) return
    try {
      const raw = await client.request(X.sessionUsage, {
        sessionId: this.sessionId,
      })
      const body = unwrapResult(raw) as Record<string, unknown>
      const usage = (body.usage ?? body) as Record<string, unknown>
      const t = this.status.totals
      const lines = [
        '**Session usage**',
        `Input: ${formatTokens(numberFrom(usage, ['inputTokens', 'input_tokens']) ?? t.inputTokens)}`,
        `Output: ${formatTokens(numberFrom(usage, ['outputTokens', 'output_tokens']) ?? t.outputTokens)}`,
        `Cached reads: ${formatTokens(numberFrom(usage, ['cachedReadTokens', 'cached_read_tokens']) ?? t.cachedReadTokens)}`,
        `Cost: $${(numberFrom(usage, ['costUsd', 'cost_usd']) ?? t.costUsd).toFixed(4)}`,
        `Turns: ${numberFrom(usage, ['turns', 'numTurns', 'num_turns']) ?? t.turns}`,
      ]
      this.postCommandResult({
        command,
        title: 'Usage',
        body: lines.join('\n\n'),
        kind: 'info',
      })
    } catch {
      // Fall back to local totals + context.
      const t = this.status.totals
      await this.refreshContext()
      this.postCommandResult({
        command,
        title: 'Usage (local)',
        body: [
          `Input: ${formatTokens(t.inputTokens)}`,
          `Output: ${formatTokens(t.outputTokens)}`,
          `Cached: ${formatTokens(t.cachedReadTokens)}`,
          `Cost: $${t.costUsd.toFixed(4)}`,
          `Turns: ${t.turns}`,
        ].join('\n\n'),
        kind: 'info',
      })
    }
  }

  /**
   * Send a slash/utility prompt to the agent without adding user/assistant bubbles to the
   * transcript. Captured text is shown in the command-result modal.
   */
  private async runUtilityPrompt(
    command: string,
    promptText: string,
  ): Promise<void> {
    const client = this.client
    if (!client || !this.sessionId) return
    this.utilityMode = true
    this.utilityCommand = command
    this.utilityBuffer = ''
    this.turnActive = true
    this.cancelling = false
    this.status.agentState = 'thinking'
    this.pushStatus()
    // Show progress immediately — slash utilities can stream for a while with no chat bubbles.
    this.postCommandResult({
      command,
      title: `${command}…`,
      body: 'Running… results will appear here (not in the chat).',
      kind: 'info',
    })
    try {
      await client.request('session/prompt', {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: promptText }],
      })
      this.closeStreams()
      const body =
        this.utilityBuffer.trim() ||
        'The agent finished with no text. Check the protocol log if that is unexpected.'
      this.postCommandResult({
        command: this.utilityCommand || command,
        title: this.utilityCommand || command,
        body,
        kind: 'info',
      })
    } catch (err) {
      this.closeStreams()
      if (!this.cancelling) {
        this.postCommandResult({
          command: this.utilityCommand || command,
          title: this.utilityCommand || command,
          body: `Failed: ${(err as Error).message}`,
          kind: 'error',
        })
      }
    } finally {
      this.utilityMode = false
      this.utilityCommand = ''
      this.utilityBuffer = ''
      this.turnActive = false
      this.status.agentState = this.client?.running ? 'idle' : 'stopped'
      this.pushStatus()
      void this.refreshContext()
      await this.flushAfterTurn()
    }
  }

  private postCommandResult(partial: Omit<CommandResult, 'id' | 'ts'>): void {
    this.deps.post({
      type: 'commandResult',
      result: {
        id: this.nextId('cmd'),
        ts: Date.now(),
        ...partial,
      },
    })
  }

  /** Plan dock is turn-scoped — drop it when the turn ends or a new one starts. */
  private clearPlan(): void {
    if (!this.status.planEntries?.length) return
    this.status.planEntries = undefined
  }

  private async buildPromptBlocks(
    text: string,
    images?: PromptImage[],
  ): Promise<ContentBlock[]> {
    const body =
      this.gate.getMode() === 'plan' ? `${PLAN_MODE_PREAMBLE}\n\n${text}` : text
    const blocks: ContentBlock[] = []
    const pathNotes: string[] = []
    // Always include path notes so the agent can open files on disk even when ACP image
    // content blocks are rejected. Also try native image blocks when the CLI advertises them
    // (and when it does not — some builds still accept the block).
    for (const img of images ?? []) {
      if (img.data) {
        blocks.push({
          type: 'image',
          mimeType: img.mimeType || 'image/png',
          data: img.data,
        })
      }
      if (img.path) pathNotes.push(img.path)
    }
    let textOut = body.trim()
    if (pathNotes.length) {
      const note =
        pathNotes.length === 1
          ? `\n\n[User attached an image. Saved at: ${pathNotes[0]}\nUse the Read tool on that path, or open it. If Read says "binary", the host will still return a description + base64 for images.]`
          : `\n\n[User attached ${pathNotes.length} images:\n${pathNotes.map((p) => `- ${p}`).join('\n')}\nRead those paths if you need the pixels.]`
      textOut = (textOut || 'Please look at the attached image(s).') + note
    } else if (!textOut && (images?.length ?? 0) > 0) {
      textOut = 'Please look at the attached image(s).'
    }
    if (textOut) blocks.unshift({ type: 'text', text: textOut })
    if (blocks.length === 0) blocks.push({ type: 'text', text: text || '' })
    return blocks
  }

  /**
   * Prefer image content blocks; if the agent rejects them (capability false / size), retry
   * with path-note text only so the turn still lands.
   */
  private async promptWithImageFallback(
    text: string,
    images: PromptImage[] | undefined,
  ): Promise<PromptResponse> {
    const client = this.client
    if (!client || !this.sessionId) {
      throw new Error('no session')
    }
    const full = await this.buildPromptBlocks(text, images)
    try {
      return await client.request<PromptResponse>('session/prompt', {
        sessionId: this.sessionId,
        prompt: full,
      })
    } catch (err) {
      const hasImages = full.some((b) => b.type === 'image')
      if (!hasImages) throw err
      this.deps.log(
        `session/prompt with image blocks failed (${(err as Error).message}); retrying text+paths only`,
      )
      const textOnly = full.filter((b) => b.type !== 'image')
      if (textOnly.length === 0) {
        textOnly.push({
          type: 'text',
          text:
            text.trim() ||
            'Please look at the attached image(s) (paths in the previous note).',
        })
      }
      return await client.request<PromptResponse>('session/prompt', {
        sessionId: this.sessionId,
        prompt: textOnly,
      })
    }
  }

  /**
   * Write pasted images under the workspace so the agent can open them even when
   * `promptCapabilities.image` is false (current Grok CLI).
   */
  private async materializeImages(
    images?: PromptImage[],
  ): Promise<PromptImage[] | undefined> {
    if (!images?.length) return undefined
    const dir = path.join(this.deps.cwd, '.grok-attachments')
    try {
      await fsp.mkdir(dir, { recursive: true })
    } catch (err) {
      this.deps.log(`attachment dir: ${(err as Error).message}`)
    }
    const out: PromptImage[] = []
    for (const img of images) {
      const ext = mimeToExt(img.mimeType)
      const name =
        img.name?.replace(/[^\w.-]+/g, '_') ||
        `paste-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
      const filePath = path.join(dir, name)
      try {
        await fsp.writeFile(filePath, Buffer.from(img.data, 'base64'))
        out.push({ ...img, name, path: filePath })
      } catch (err) {
        this.deps.log(`save attachment ${name}: ${(err as Error).message}`)
        out.push(img)
      }
    }
    return out
  }

  /**
   * Queue a message typed during a running turn.
   *
   * grok's own TUI can splice text into a live turn, but `_x.ai/queue/interject` is not registered
   * in the ACP extension dispatcher (0.2.112 answers `-32601`, with or without `--leader`) — it
   * only exists on the private leader channel the TUI uses. So the queue is ours: the text is
   * shown immediately, held locally, and sent as the next prompt when the turn ends. Nothing is
   * lost, it just lands one turn later than in the CLI. Use `pushQueue` to force-send early
   * (cancels the current turn first).
   */
  interject(
    text: string,
    images?: PromptImage[],
    stagedImageIds?: string[],
  ): void {
    const trimmed = text.trim()
    const imgs = this.takeStagedImages(images, stagedImageIds)
    if (!trimmed && !imgs?.length) return
    if (!this.turnActive) {
      void this.prompt(trimmed, imgs)
      return
    }
    void this.enqueueWhileBusy(trimmed, imgs)
  }

  private async enqueueWhileBusy(
    text: string,
    images?: PromptImage[],
  ): Promise<void> {
    // Queue lives only in the composer (status.queuedMessages) — not in the transcript.
    const saved = await this.materializeImages(images)
    this.interjections.push({
      id: this.nextId('queue'),
      text: text || '',
      images: saved,
    })
    this.syncQueueStatus()
  }

  /** Drop everything typed during the turn without sending it. */
  clearQueue(): void {
    if (this.interjections.length === 0 && !this.forceNext) return
    this.interjections.length = 0
    this.forceNext = undefined
    this.syncQueueStatus()
    this.addNotice('info', 'Queued messages discarded.')
  }

  /**
   * Force queued text into Grok now. Stops the in-flight turn (if any); when it ends we send
   * either one selected message (`blockId`) or the whole queue. Only then does it appear in chat.
   */
  async pushQueue(blockId?: string): Promise<void> {
    if (this.interjections.length === 0 && !this.forceNext) {
      this.addNotice('info', 'Nothing is waiting in the queue.')
      return
    }
    if (blockId) {
      const idx = this.interjections.findIndex((i) => i.id === blockId)
      if (idx < 0) return
      const [item] = this.interjections.splice(idx, 1)
      this.forceNext = {
        text: item.text,
        images: item.images,
        wasQueued: true,
      }
      this.syncQueueStatus()
    }
    if (this.turnActive) {
      this.addNotice(
        'info',
        blockId
          ? 'Stopping the current turn to send that message now…'
          : 'Stopping the current turn to send the queue…',
      )
      this.cancel()
      return
    }
    await this.flushAfterTurn()
  }

  private async flushAfterTurn(): Promise<void> {
    if (this.pendingSlash) {
      const cmd = this.pendingSlash
      this.pendingSlash = undefined
      await this.executeSlash(cmd)
      return
    }
    if (this.forceNext) {
      const next = this.forceNext
      this.forceNext = undefined
      this.addBlock<TextBlock>({
        id: this.nextId('user'),
        ts: Date.now(),
        kind: 'text',
        role: 'user',
        text: next.text || (next.images?.length ? '(image attachment)' : ''),
        streaming: false,
        wasQueued: true,
        images: next.images,
      })
      await this.runTurn(next.text, next.images)
      return
    }
    await this.flushInterjections()
  }

  private async flushInterjections(): Promise<void> {
    const pending = this.interjections.splice(0)
    this.syncQueueStatus()
    if (pending.length === 0) return
    // Land in the transcript only now, marked wasQueued so they read as "came from the queue".
    for (const item of pending) {
      this.addBlock<TextBlock>({
        id: this.nextId('user'),
        ts: Date.now(),
        kind: 'text',
        role: 'user',
        text: item.text || (item.images?.length ? '(image attachment)' : ''),
        streaming: false,
        wasQueued: true,
        images: item.images,
      })
    }
    const text = pending
      .map((i) => i.text)
      .filter(Boolean)
      .join('\n\n')
    const images = pending.flatMap((i) => i.images ?? [])
    await this.runTurn(text, images.length ? images : undefined)
  }

  cancel(): void {
    if (!this.client || !this.sessionId) return
    this.cancelling = true
    // ACP models cancellation as a notification; the in-flight session/prompt then returns.
    this.client.notify('session/cancel', { sessionId: this.sessionId })
    this.terminals.killAll()
    this.rejectAllPendingUi('Cancelled.')
    this.addNotice('info', 'Cancelled.')
  }

  private rejectAllPendingUi(reason: string): void {
    for (const [id, entry] of this.approvals) {
      this.approvals.delete(id)
      entry.d.resolve('reject')
    }
    for (const [id, d] of this.planRequests) {
      this.planRequests.delete(id)
      d.resolve({ approve: false, feedback: reason })
    }
    for (const [id, d] of this.questionRequests) {
      this.questionRequests.delete(id)
      d.reject(new Error(reason))
    }
  }

  // ------------------------------------------------------------------ settings actions

  setPermissionMode(mode: PermissionMode): void {
    this.gate.setMode(mode)
    this.status.permissionMode = mode
    this.pushStatus()
    // Global so the choice survives restarts and is not lost when no .vscode/settings.json exists.
    this.persistSetting('permissionMode', mode)
    // No protocol call here on purpose: grok has no client-settable plan mode over ACP. The mode
    // reaches the agent via PLAN_MODE_PREAMBLE on the next prompt, and is enforced by the gate.
  }

  async setModel(modelId: string, persist = true): Promise<void> {
    if (!this.client || !this.sessionId) return
    try {
      await this.client.request('session/set_model', {
        sessionId: this.sessionId,
        modelId,
      })
      this.status.currentModelId = modelId
      const m = this.status.models.find((x) => x.modelId === modelId)
      if (m?.contextTokens) this.status.contextTokens = m.contextTokens
      if (persist) this.persistSetting('model', modelId)
      this.pushStatus()
    } catch (err) {
      this.addNotice(
        'error',
        `Could not switch model: ${(err as Error).message}`,
      )
    }
  }

  /** Reasoning effort is exposed by grok as an ACP *mode*, so `session/set_mode` is the setter. */
  async setReasoningEffort(effort: string, persist = true): Promise<void> {
    if (!this.client || !this.sessionId) return
    try {
      await this.client.request('session/set_mode', {
        sessionId: this.sessionId,
        modeId: effort,
      })
      this.status.reasoningEffort = effort
      if (persist) this.persistSetting('reasoningEffort', effort)
      this.pushStatus()
    } catch (err) {
      this.addNotice(
        'error',
        `Could not set reasoning effort: ${(err as Error).message}`,
      )
    }
  }

  async newSession(): Promise<void> {
    if (!this.client?.running) {
      await this.restart()
      return
    }
    this.clearTranscript()
    this.gate.reset()
    this.readPaths.clear()
    this.status.planEntries = undefined
    this.interjections.length = 0
    this.forceNext = undefined
    this.status.totals = {
      inputTokens: 0,
      outputTokens: 0,
      cachedReadTokens: 0,
      reasoningTokens: 0,
      costUsd: 0,
      turns: 0,
    }
    this.syncQueueStatus()
    // Nothing has been asked in the current session, so it *is* a new one — asking grok for
    // another would only add a second blank entry to the history for the same empty screen.
    if (this.sessionId && !this.sessionUsed) {
      this.pushStatus()
      return
    }
    try {
      const session = await this.client.request<NewSessionResponse>(
        'session/new',
        {
          cwd: this.deps.cwd,
          mcpServers: [],
        },
      )
      this.applySessionResponse(session)
      // Pin only after the user actually uses it (first prompt) — not the empty shell.
      this.pushStatus()
    } catch (err) {
      this.addNotice(
        'error',
        `Could not start a new session: ${(err as Error).message}`,
      )
    }
  }

  // ------------------------------------------------------------------ approvals

  private async askApproval(
    request: ApprovalRequest,
  ): Promise<ApprovalDecision> {
    request.alwaysScope = this.gate.describeAlwaysScope(request)
    const block = this.addBlock(
      {
        id: this.nextId('approval'),
        ts: Date.now(),
        kind: 'approval' as const,
        request,
      },
      request.toolCallId,
    )
    const previousState = this.status.agentState
    this.status.agentState = 'awaitingApproval'
    this.pushStatus()

    const decision = await new Promise<ApprovalDecision>((resolve, reject) => {
      this.approvals.set(request.requestId, { request, d: { resolve, reject } })
    })

    this.patch(block, { decision })
    this.status.agentState = this.turnActive ? 'thinking' : previousState
    this.pushStatus()
    this.gate.remember(request, decision)
    if (this.gate.getMode() !== this.status.permissionMode) {
      this.status.permissionMode = this.gate.getMode()
      this.pushStatus()
    }
    return decision
  }

  answerApproval(requestId: string, decision: ApprovalDecision): void {
    const entry = this.approvals.get(requestId)
    if (!entry) return
    this.approvals.delete(requestId)
    entry.d.resolve(decision)
  }

  answerPlan(requestId: string, approve: boolean, feedback?: string): void {
    const d = this.planRequests.get(requestId)
    if (!d) return
    this.planRequests.delete(requestId)
    d.resolve({ approve, feedback })
  }

  answerQuestion(requestId: string, response: QuestionResponse): void {
    const d = this.questionRequests.get(requestId)
    if (!d) return
    this.questionRequests.delete(requestId)
    d.resolve(response)
  }

  // ------------------------------------------------------------------ agent → client requests

  private async handleAgentRequest(
    method: string,
    rawParams: unknown,
  ): Promise<unknown> {
    switch (method) {
      case 'fs/read_text_file': {
        const p = rawParams as ReadTextFileParams
        try {
          const result = await this.fs.readTextFile(p)
          this.notePathRead(p.path)
          return result
        } catch (err) {
          // Soft tool error for the agent — includes CLOUD_PATH_HINT when relevant so it can
          // change strategy instead of hard-looping the same Read.
          throw rpcFail(
            -32000,
            withCloudToolHint(p.path, (err as Error).message),
          )
        }
      }

      case 'fs/write_text_file':
        return this.onWriteRequest(rawParams as WriteTextFileParams)

      case 'terminal/create':
        return this.onTerminalCreate(rawParams as CreateTerminalParams)

      case 'terminal/output':
        return this.terminals.output(
          (rawParams as { terminalId: string }).terminalId,
        )

      case 'terminal/wait_for_exit':
        return this.terminals.waitForExit(
          (rawParams as { terminalId: string }).terminalId,
        )

      case 'terminal/kill':
        return this.terminals.kill(
          (rawParams as { terminalId: string }).terminalId,
        )

      case 'terminal/release':
        return this.terminals.release(
          (rawParams as { terminalId: string }).terminalId,
        )

      case 'session/request_permission':
        return this.onAgentPermissionRequest(
          rawParams as RequestPermissionParams,
        )

      case '_x.ai/exit_plan_mode':
        return this.onExitPlanMode(rawParams as Record<string, unknown>)

      case '_x.ai/ask_user_question':
        return this.onAskUserQuestion(rawParams as { questions?: unknown[] })

      default:
        this.deps.log(`unhandled agent→client method: ${method}`)
        throw rpcFail(-32601, `method not found: ${method}`)
    }
  }

  private notePathRead(filePath: string): void {
    this.readPaths.add(pathKey(filePath))
  }

  private async onWriteRequest(params: WriteTextFileParams): Promise<null> {
    const verdict = this.gate.checkWrite(params.path)
    if (verdict.action === 'deny') {
      throw rpcFail(-32000, withCloudToolHint(params.path, verdict.reason))
    }

    // Claude-style: existing files must be Read in this session before Write.
    // Also forces cloud placeholders to hydrate when the agent complies.
    const exists = await this.fs.exists(params.path)
    if (exists && !this.readPaths.has(pathKey(params.path))) {
      throw rpcFail(
        -32000,
        [
          'Read the file first before writing to it.',
          `Path: ${params.path}`,
          'Call your Read tool on this path, then retry the edit with the full intended content.',
          'Creating a brand-new file does not require a prior Read.',
          isCloudPath(params.path)
            ? 'On cloud drives (Google Drive, etc.), a successful Read also downloads the file so Write is more reliable.'
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      )
    }

    if (verdict.action === 'ask') {
      const oldText = await this.fs.currentContent(params.path)
      const decision = await this.askApproval({
        requestId: `apr-${++this.approvalSeq}`,
        kind: 'write',
        title:
          oldText === null && !exists
            ? `Create ${path.basename(params.path)}`
            : `Edit ${path.basename(params.path)}`,
        path: params.path,
        oldText: oldText ?? undefined,
        newText: params.content,
        toolCallId: this.lastMutatingToolCallId,
      })
      if (decision === 'reject' || decision === 'rejectAlways') {
        throw rpcFail(
          -32000,
          'The user rejected this edit. Do not retry it; ask what they want instead.',
        )
      }
    }
    try {
      const result = await this.fs.writeTextFile(params)
      // A successful write counts as knowing the file for follow-up edits.
      this.notePathRead(params.path)
      return result
    } catch (err) {
      // Soft failure message for the agent — includes CLOUD_PATH_HINT when relevant.
      throw rpcFail(
        -32000,
        withCloudToolHint(params.path, (err as Error).message),
      )
    }
  }

  private async onTerminalCreate(
    params: CreateTerminalParams,
  ): Promise<{ terminalId: string }> {
    const commandLine = [params.command, ...(params.args ?? [])].join(' ')
    const cwd = params.cwd ?? this.deps.cwd
    const verdict = this.gate.checkCommand(commandLine)
    if (verdict.action === 'deny') {
      throw rpcFail(-32000, withCloudToolHint(cwd, verdict.reason))
    }

    if (verdict.action === 'ask') {
      const decision = await this.askApproval({
        requestId: `apr-${++this.approvalSeq}`,
        kind: 'command',
        title: 'Run command',
        command: commandLine,
        cwd,
        toolCallId: this.lastExecuteBlockId
          ? this.toolCallIdOfBlock(this.lastExecuteBlockId)
          : undefined,
      })
      if (decision === 'reject' || decision === 'rejectAlways') {
        throw rpcFail(
          -32000,
          'The user rejected this command. Do not retry it; ask what they want instead.',
        )
      }
    }

    const created = this.terminals.create(params)
    if (this.lastExecuteBlockId)
      this.terminalToBlock.set(created.terminalId, this.lastExecuteBlockId)
    return created
  }

  /** Never observed on v0.2.112, but handled so a future grok release does not break the UI. */
  private async onAgentPermissionRequest(
    params: RequestPermissionParams,
  ): Promise<unknown> {
    const options = params.options ?? []
    const decision = await this.askApproval({
      requestId: `apr-${++this.approvalSeq}`,
      kind: 'agentPermission',
      title: params.toolCall?.title ?? 'Permission required',
      toolCallId: params.toolCall?.toolCallId,
      agentOptions: options.map((o) => ({
        optionId: o.optionId,
        name: o.name,
        kind: o.kind,
      })),
    })
    const wanted =
      decision === 'always'
        ? 'allow_always'
        : decision === 'once'
          ? 'allow_once'
          : decision === 'rejectAlways'
            ? 'reject_always'
            : 'reject_once'
    const chosen = options.find((o) => o.kind === wanted) ?? options[0]
    if (!chosen) return { outcome: { outcome: 'cancelled' } }
    return { outcome: { outcome: 'selected', optionId: chosen.optionId } }
  }

  /**
   * Plan approval. The `exit_plan_mode` tool result is hardcoded to "approved" inside grok, so a
   * rejection has to be enforced on our side: we cancel the turn and reply with the feedback,
   * and the gate keeps blocking writes because we stay in plan mode.
   */
  private async onExitPlanMode(
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const input = (params.input as Record<string, unknown> | undefined) ?? {}
    const content = String(
      params.planContent ??
        params.plan ??
        input.plan ??
        input.planContent ??
        '',
    )
    const requestId = `plan-${++this.approvalSeq}`
    const block = this.addBlock({
      id: this.nextId('plan-proposal'),
      ts: Date.now(),
      kind: 'proposedPlan' as const,
      requestId,
      content,
    })
    const previousState = this.status.agentState
    this.status.agentState = 'awaitingApproval'
    this.pushStatus()

    const { approve, feedback } = await new Promise<{
      approve: boolean
      feedback?: string
    }>((resolve, reject) => {
      this.planRequests.set(requestId, { resolve, reject })
    })

    this.patch(block, { decision: approve ? 'approved' : 'rejected' })
    this.status.agentState = this.turnActive ? 'thinking' : previousState
    this.pushStatus()

    if (approve) {
      if (this.gate.getMode() === 'plan') this.setPermissionMode('default')
      return { approved: true }
    }

    // Cancel first, then send the verdict as the next message — the same shape the CLI ends up in.
    const note = feedback?.trim()
      ? `I rejected that plan. ${feedback.trim()}`
      : 'I rejected that plan. Stay in plan mode and propose a different approach.'
    setTimeout(() => {
      this.cancelling = true
      this.client?.notify('session/cancel', { sessionId: this.sessionId })
      void this.waitForIdle().then(() => this.prompt(note))
    }, 0)
    return { approved: false, feedback: note }
  }

  /**
   * `_x.ai/ask_user_question` — grok's clone of Claude Code's AskUserQuestion tool.
   *
   * The reply must be shaped like the Rust enum `AskUserQuestionExtResponse`, which serde tags
   * *internally* on `outcome`; returning a bare `{answers}` fails the tool call with
   * "missing field `outcome`". Answers are keyed by the question text, and each value is a
   * string (single-select) or an array of strings (multi-select).
   */
  private async onAskUserQuestion(params: {
    questions?: unknown[]
  }): Promise<unknown> {
    const requestId = `q-${++this.approvalSeq}`
    const block = this.addBlock(
      {
        id: this.nextId('question'),
        ts: Date.now(),
        kind: 'question' as const,
        requestId,
        questions: (params.questions ?? []).map(toAskQuestion),
        answered: false,
      },
      this.lastToolCallId,
    )
    const previousState = this.status.agentState
    this.status.agentState = 'awaitingApproval'
    this.pushStatus()
    try {
      const response = await new Promise<QuestionResponse>(
        (resolve, reject) => {
          this.questionRequests.set(requestId, { resolve, reject })
        },
      )
      this.patch(block, { answered: true, response })
      return response
    } finally {
      this.status.agentState = this.turnActive ? 'thinking' : previousState
      this.pushStatus()
    }
  }

  private async waitForIdle(timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (this.turnActive && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  // ------------------------------------------------------------------ agent → client notifications

  private handleAgentNotification(method: string, rawParams: unknown): void {
    switch (method) {
      case 'session/update':
      case '_x.ai/session_notification': {
        const note = rawParams as SessionNotification
        if (note?.update) this.applyUpdate(note.update)
        return
      }
      // Worktree creation is async: the RPC returns `{status:"creating"}`, then `progress`
      // messages arrive here, then `created` with the finished path. (Notification only — this
      // name is not callable, see the X table.)
      case '_x.ai/git/worktree/status': {
        const p = rawParams as {
          status?: string
          message?: string
          worktreePath?: string
        }
        const text =
          p.message?.trim() ||
          (p.status === 'created'
            ? `Worktree created: ${p.worktreePath ?? ''}`
            : `Worktree: ${p.status ?? 'update'}`)
        if (p.status === 'created' && p.worktreePath)
          void this.offerToOpen(p.worktreePath)
        if (p.status === 'progress') {
          if (this.worktreeNotice) this.patch(this.worktreeNotice, { text })
          else {
            this.worktreeNotice = this.addBlock<NoticeBlock>({
              id: this.nextId('notice'),
              ts: Date.now(),
              kind: 'notice',
              level: 'info',
              text,
            })
          }
          return
        }
        const level =
          p.status === 'error' || p.status === 'failed' ? 'error' : 'info'
        if (this.worktreeNotice) {
          this.patch(this.worktreeNotice, { text, level })
          this.worktreeNotice = undefined
        } else {
          this.addNotice(level, text)
        }
        return
      }
      case '_x.ai/models/update': {
        const p = rawParams as {
          currentModelId?: string
          availableModels?: AgentModel[]
        }
        if (p.availableModels)
          this.status.models = p.availableModels.map(toModelInfo)
        if (p.currentModelId) this.status.currentModelId = p.currentModelId
        this.pushStatus()
        return
      }
      case '_x.ai/sessions/changed': {
        const p = rawParams as {
          upserted?: {
            sessionId: string
            title?: string | null
            cwd?: string
            lastChangeUnixMs?: number
          }[]
          removed?: string[]
        }
        for (const s of p.upserted ?? []) {
          // Never blank out a title we already know with a null/empty agent title.
          const prev = this.knownSessions.get(s.sessionId)
          const title =
            (s.title && s.title.trim()) || prev?.title || '(untitled)'
          this.knownSessions.set(s.sessionId, {
            sessionId: s.sessionId,
            title,
            cwd: s.cwd ?? this.deps.cwd,
            updatedAt: s.lastChangeUnixMs ?? Date.now(),
          })
          // Only adopt titles for the *open* session when the agent names that same id.
          if (s.sessionId === this.sessionId && s.title && s.title.trim()) {
            this.status.sessionTitle = s.title.trim()
            this.pushStatus()
          }
        }
        for (const id of p.removed ?? []) this.knownSessions.delete(id)
        return
      }
      case '_x.ai/session/prompt_complete':
      case '_x.ai/mcp/init_progress':
      case '_x.ai/mcp/server_status':
      case '_x.ai/mcp/servers_updated':
      case '_x.ai/mcp_initialized':
      case '_x.ai/settings/update':
      case '_x.ai/announcements/update':
        return // informational only
      default:
        this.deps.log(`unhandled notification: ${method}`)
    }
  }

  private applyUpdate(update: SessionUpdate): void {
    const meta = (update as { _meta?: { promptIndex?: number } })._meta
    if (typeof meta?.promptIndex === 'number')
      this.currentPromptIndex = meta.promptIndex

    switch (update.sessionUpdate) {
      // Our own prompt echoed back — and, during session/load, the replayed history. A live turn
      // already has its user block, so only the replay needs rendering. ACP echoes the *agent*
      // prompt (plan preamble + image path notes), not the UI-facing draft — strip those.
      case 'user_message_chunk': {
        if (this.turnActive) return
        const text = textOf((update as { content?: unknown }).content)
        if (!text) return
        this.closeStreams()
        this.addBlock<TextBlock>({
          id: this.nextId('user'),
          ts: Date.now(),
          kind: 'text',
          role: 'user',
          text: stripAgentPromptDecorations(text),
          streaming: false,
        })
        return
      }

      case 'agent_message_chunk': {
        const text = textOf((update as { content?: unknown }).content)
        if (!text) return
        // Slash/utility: buffer for the modal — do not add chat bubbles.
        if (this.utilityMode) {
          this.utilityBuffer += text
          return
        }
        if (this.openThinking) {
          this.patch(this.openThinking, {
            streaming: false,
            durationMs: Date.now() - this.thinkingStartedAt,
          })
          this.openThinking = undefined
        }
        if (!this.openText) {
          this.openText = this.addBlock<TextBlock>({
            id: this.nextId('msg'),
            ts: Date.now(),
            kind: 'text',
            role: 'assistant',
            text: '',
            streaming: true,
          })
        }
        this.appendText(this.openText, text)
        return
      }

      case 'agent_thought_chunk': {
        const text = textOf((update as { content?: unknown }).content)
        if (!text) return
        if (this.utilityMode) return // keep modal free of thinking noise
        if (this.openText) {
          this.patch(this.openText, { streaming: false })
          this.openText = undefined
        }
        if (!this.openThinking) {
          this.thinkingStartedAt = Date.now()
          this.openThinking = this.addBlock<ThinkingBlock>({
            id: this.nextId('think'),
            ts: Date.now(),
            kind: 'thinking',
            text: '',
            streaming: true,
          })
        }
        this.appendText(this.openThinking, text)
        return
      }

      case 'tool_call_delta_chunk': {
        // Earliest signal while args stream. Do not paint yet — a bare "Search" card that
        // expands a second later feels fake. Hold briefly; tool_call usually follows with
        // label+input so the first paint is already complete. Only the first chunk carries id.
        const p = update as { tool_call_id?: string; name?: string }
        if (!p.tool_call_id) return
        this.closeStreams()
        this.holdToolReveal(p.tool_call_id, p.name)
        return
      }

      case 'tool_call':
      case 'tool_call_update': {
        const p = update as ToolCallUpdatePayload
        this.closeStreams()
        // todo_write / "Plan write" is mirrored as a polished plan dock above the composer —
        // keep the noisy tool card out of the transcript.
        const xaiName = p._meta?.['x.ai/tool']?.name ?? ''
        const xaiLabel = p._meta?.['x.ai/tool']?.label ?? ''
        if (isPlanTool(xaiName, xaiLabel, p.title)) {
          this.releaseToolHold(p.toolCallId)
          const existing = this.toolBlocks.get(p.toolCallId)
          if (existing) {
            this.removeBlock(existing.id)
            this.toolBlocks.delete(p.toolCallId)
          }
          return
        }
        const seedName =
          xaiName || this.toolHolds.get(p.toolCallId)?.name || undefined
        // Live turns: do not mint a bare "Read" card — wait for path/args (or terminal status).
        if (
          !this.replayingHistory &&
          !this.toolBlocks.has(p.toolCallId) &&
          !toolPayloadReady(p)
        ) {
          this.bufferToolUpdate(p.toolCallId, p, seedName)
          return
        }
        this.releaseToolHold(p.toolCallId)
        const block = this.ensureToolBlock(p.toolCallId, {
          name: seedName,
        })
        this.applyToolPayload(block, p)
        if (isPlanTool(block.name, block.label, block.title)) {
          this.removeBlock(block.id)
          this.toolBlocks.delete(p.toolCallId)
        }
        return
      }

      case 'plan': {
        const entries = ((update as { entries?: PlanEntry[] }).entries ??
          []) as PlanEntry[]
        // Live checklist lives above the composer — not as a chat bubble.
        this.status.planEntries = entries
        this.pushStatus()
        // Drop any legacy plan cards left from older builds / session replay.
        for (const b of [...this.blocks]) {
          if (b.kind === 'plan') this.removeBlock(b.id)
        }
        return
      }

      case 'available_commands_update': {
        this.status.availableCommands =
          (update as { availableCommands?: AvailableCommand[] })
            .availableCommands ?? []
        this.pushStatus()
        return
      }

      case 'pending_interaction': {
        const p = update as { tool_call_id: string }
        const block = this.toolBlocks.get(p.tool_call_id)
        if (block) this.patch(block, { waiting: true })
        return
      }

      case 'interaction_resolved': {
        const p = update as { tool_call_id: string }
        const block = this.toolBlocks.get(p.tool_call_id)
        if (block) this.patch(block, { waiting: false })
        return
      }

      case 'model_changed': {
        const p = update as { modelId?: string; reasoningEffort?: string }
        if (p.modelId) this.status.currentModelId = p.modelId
        if (p.reasoningEffort) this.status.reasoningEffort = p.reasoningEffort
        this.pushStatus()
        return
      }

      case 'session_summary_generated': {
        const title = (update as { session_summary?: string }).session_summary
        if (title && this.sessionId) this.setSessionTitle(this.sessionId, title)
        return
      }

      case 'turn_completed': {
        const p = update as { stop_reason?: string; usage?: TurnUsage }
        this.closeStreams()
        this.clearPlan()
        this.accumulate(p.usage)
        this.addBlock({
          id: this.nextId('turn'),
          ts: Date.now(),
          kind: 'turn' as const,
          stopReason: p.stop_reason,
          usage: p.usage,
        })
        this.pushStatus()
        return
      }

      default:
        this.deps.log(
          `unhandled sessionUpdate: ${String(update.sessionUpdate)}`,
        )
    }
  }

  private accumulate(usage: TurnUsage | undefined): void {
    if (!usage) return
    const t = this.status.totals
    t.inputTokens += usage.inputTokens ?? 0
    t.outputTokens += usage.outputTokens ?? 0
    t.cachedReadTokens += usage.cachedReadTokens ?? 0
    t.reasoningTokens += usage.reasoningTokens ?? 0
    t.costUsd += (usage.costUsdTicks ?? 0) / 1e9 // costUsdTicks is USD × 1e9
    t.turns += 1
    this.status.lastTurnTotalTokens = usage.totalTokens
  }

  /**
   * Delta only — remember the name, never paint. The card appears on the first tool_call that
   * carries a target (or after a last-resort timeout so a stuck tool is not invisible forever).
   */
  private holdToolReveal(toolCallId: string, name?: string): void {
    if (this.toolBlocks.has(toolCallId)) {
      if (name) {
        const block = this.toolBlocks.get(toolCallId)!
        if (block.name === 'tool' || !block.name) {
          this.patch(block, {
            name,
            label: stableToolLabel(name),
            title: stableToolLabel(name),
          })
        }
      }
      return
    }
    if (this.replayingHistory) {
      this.ensureToolBlock(toolCallId, { name })
      return
    }
    this.bufferToolUpdate(toolCallId, undefined, name)
  }

  /** Merge a partial update into the hold and (re)arm the last-resort reveal timer. */
  private bufferToolUpdate(
    toolCallId: string,
    payload: ToolCallUpdatePayload | undefined,
    name?: string,
  ): void {
    let hold = this.toolHolds.get(toolCallId)
    if (!hold) {
      hold = {}
      this.toolHolds.set(toolCallId, hold)
    }
    if (name) hold.name = name
    if (payload) {
      hold.payload = mergeToolPayload(hold.payload, payload)
      const xaiName = payload._meta?.['x.ai/tool']?.name
      if (xaiName) hold.name = xaiName
      // Ready mid-buffer (args arrived) — paint immediately with the merged payload.
      if (toolPayloadReady(hold.payload)) {
        this.flushToolHold(toolCallId)
        return
      }
    }
    if (hold.timer) clearTimeout(hold.timer)
    // Last resort only: better a late bare card than a missing one if the agent never sends args.
    hold.timer = setTimeout(() => this.flushToolHold(toolCallId), 700)
  }

  private flushToolHold(toolCallId: string): void {
    const hold = this.toolHolds.get(toolCallId)
    if (!hold) return
    if (hold.timer) clearTimeout(hold.timer)
    this.toolHolds.delete(toolCallId)
    if (this.toolBlocks.has(toolCallId)) return
    const block = this.ensureToolBlock(toolCallId, { name: hold.name })
    if (hold.payload) this.applyToolPayload(block, hold.payload)
  }

  private releaseToolHold(toolCallId: string): void {
    const hold = this.toolHolds.get(toolCallId)
    if (!hold) return
    if (hold.timer) clearTimeout(hold.timer)
    this.toolHolds.delete(toolCallId)
  }

  private clearAllToolHolds(): void {
    for (const hold of this.toolHolds.values()) {
      if (hold.timer) clearTimeout(hold.timer)
    }
    this.toolHolds.clear()
  }

  private ensureToolBlock(
    toolCallId: string,
    seed: { name?: string },
  ): ToolBlock {
    const existing = this.toolBlocks.get(toolCallId)
    if (existing) return existing
    const name = seed.name ?? 'tool'
    const label = stableToolLabel(name)
    const block = this.addBlock<ToolBlock>({
      id: this.nextId('tool'),
      ts: Date.now(),
      kind: 'tool',
      toolCallId,
      name,
      label,
      toolKind: kindGuessFromName(name),
      title: label,
      status: 'pending',
      readOnly: true,
      locations: [],
      contents: [],
      waiting: false,
    })
    this.toolBlocks.set(toolCallId, block)
    return block
  }

  private applyToolPayload(block: ToolBlock, p: ToolCallUpdatePayload): void {
    const xai = p._meta?.['x.ai/tool']
    const patch: Record<string, unknown> = {}
    const nextName = xai?.name || block.name
    if (xai?.name && xai.name !== block.name) patch.name = xai.name
    // Prefer a stable kind-based label so we never thrash Search → Search Replace → Edit.
    const nextLabel = stableToolLabel(nextName, xai?.label)
    if (nextLabel !== block.label) patch.label = nextLabel
    if (xai?.kind ?? p.kind) patch.toolKind = (xai?.kind ?? p.kind) as ToolKind
    else if (block.toolKind === 'unknown' && nextName) {
      const guess = kindGuessFromName(nextName)
      if (guess !== 'unknown') patch.toolKind = guess
    }
    if (typeof xai?.read_only === 'boolean') patch.readOnly = xai.read_only
    if (xai?.input ?? p.rawInput) patch.input = xai?.input ?? p.rawInput
    if (p.title) patch.title = p.title
    if (p.status) patch.status = p.status
    if (p.locations) patch.locations = p.locations
    if (p.status === 'failed') {
      // Full stack / ENOENT dumps stay in the log; the card gets a short human line only.
      const raw =
        firstText(p.content) ?? firstText(block.contents) ?? 'Tool failed.'
      this.deps.log(`tool ${block.toolCallId} failed: ${raw.slice(0, 800)}`)
      patch.error = humanizeToolError(raw)
      patch.contents = []
    } else if (p.content) {
      patch.contents = mergeContents(block.contents, p.content)
    }
    this.patch(block, patch)

    const kind = (patch.toolKind ?? block.toolKind) as string
    if (kind === 'execute') this.lastExecuteBlockId = block.id
    if (
      kind === 'edit' ||
      kind === 'write' ||
      kind === 'delete' ||
      kind === 'move'
    ) {
      this.lastMutatingToolCallId = block.toolCallId
    }
    if (p.status === 'completed' || p.status === 'failed') {
      if (this.lastExecuteBlockId === block.id)
        this.lastExecuteBlockId = undefined
      if (this.lastToolCallId === block.toolCallId)
        this.lastToolCallId = undefined
    } else {
      this.lastToolCallId = block.toolCallId
    }
  }

  private toolCallIdOfBlock(blockId: string): string | undefined {
    for (const b of this.toolBlocks.values())
      if (b.id === blockId) return b.toolCallId
    return undefined
  }

  // ------------------------------------------------------------------ sessions, rewind, worktree

  /**
   * Session history, from three sources that each know something the others do not:
   * `sessions/list` has live/resident sessions and their titles, `session_summaries/session_list`
   * has the persisted summaries, and the on-disk store (docs/acp-findings.md §7) still answers
   * when the agent is down. First writer wins, so the freshest source takes precedence.
   */
  async listSessions(): Promise<void> {
    const collected = new Map<string, SessionSummary>(this.knownSessions)
    // Ids the store confirms hold messages. The live sources happily report the blank session the
    // agent opens on startup, and resuming one of those is never what anybody meant to click.
    const withMessages = new Set<string>()
    const calls: [string, Record<string, unknown>][] = [
      [X.sessionsList, { cwd: this.deps.cwd }],
      [X.sessionSummaries, { workspace_directory: this.deps.cwd, limit: 50 }],
    ]
    for (const [method, params] of calls) {
      if (!this.client?.running) break
      try {
        const res = await this.client.request<unknown>(method, {
          sessionId: this.sessionId,
          ...params,
        })
        for (const s of normalizeSessionList(res, this.deps.cwd)) {
          if (!collected.has(s.sessionId)) collected.set(s.sessionId, s)
        }
      } catch (err) {
        this.deps.log(`${method} unavailable: ${(err as Error).message}`)
      }
    }
    for (const s of await readSessionsFromDisk(this.deps.cwd, this.deps.log)) {
      withMessages.add(s.sessionId)
      if (!collected.has(s.sessionId)) collected.set(s.sessionId, s)
    }
    // Prefer the live title we track for the open session (rename / auto-summary).
    if (this.sessionId) {
      const liveTitle = this.status.sessionTitle
      const existing = collected.get(this.sessionId)
      if (liveTitle) {
        collected.set(this.sessionId, {
          sessionId: this.sessionId,
          title: liveTitle,
          cwd: this.status.cwd ?? this.deps.cwd,
          updatedAt: existing?.updatedAt ?? Date.now(),
        })
      } else if (!existing) {
        collected.set(this.sessionId, {
          sessionId: this.sessionId,
          title: '(untitled)',
          cwd: this.status.cwd ?? this.deps.cwd,
          updatedAt: Date.now(),
        })
      }
      if (
        existing?.title &&
        existing.title !== '(untitled)' &&
        !this.status.sessionTitle
      ) {
        this.status.sessionTitle = existing.title
        this.pushStatus()
      }
    }

    const sessions = [...collected.values()]
      .filter((s) => samePath(s.cwd, this.deps.cwd))
      .filter((s) => !this.deletedSessions.has(s.sessionId))
      // Keep the open session even when blank so it can be renamed; drop other empty stubs.
      .filter(
        (s) =>
          s.sessionId === this.sessionId ||
          withMessages.has(s.sessionId) ||
          s.title !== '(untitled)',
      )
      .sort((a, b) => {
        // Current session first, then recency — so "which chat is this?" is always at the top.
        if (a.sessionId === this.sessionId) return -1
        if (b.sessionId === this.sessionId) return 1
        return b.updatedAt - a.updatedAt
      })
      .slice(0, 50)
    this.deps.post({ type: 'sessions', sessions })
  }

  /**
   * Renames a session via `_x.ai/session/rename`. Only the targeted id is updated in our maps;
   * if the agent also mutates the open session's title when renaming a *different* row (observed
   * with blank/untitled residents), we restore the open session's previous title locally.
   */
  async renameSession(sessionId: string, title: string): Promise<void> {
    const clean = title.trim()
    if (!sessionId || !clean) return
    if (!this.client?.running) {
      this.addNotice(
        'error',
        'Agent is not running — start a session before renaming.',
      )
      return
    }
    const openId = this.sessionId
    const openTitleBefore = this.status.sessionTitle
    const openKnownBefore = openId ? this.knownSessions.get(openId) : undefined
    try {
      await this.client.request(X.sessionRename, { sessionId, title: clean })
      this.setSessionTitle(sessionId, clean)
      // Defend against the agent rewriting the *current* blank session when we renamed another.
      if (openId && sessionId !== openId) {
        if (openTitleBefore) {
          this.status.sessionTitle = openTitleBefore
          this.knownSessions.set(openId, {
            sessionId: openId,
            title: openTitleBefore,
            cwd: openKnownBefore?.cwd ?? this.status.cwd ?? this.deps.cwd,
            updatedAt: openKnownBefore?.updatedAt ?? Date.now(),
          })
        } else {
          this.status.sessionTitle = undefined
          if (openKnownBefore) {
            this.knownSessions.set(openId, {
              ...openKnownBefore,
              title: '(untitled)',
            })
          }
        }
        this.pushStatus()
      }
      await this.listSessions()
    } catch (err) {
      this.addNotice(
        'error',
        `Could not rename session: ${(err as Error).message}`,
      )
    }
  }

  /**
   * Forgets a saved session.
   *
   * ACP exposes no delete (docs/acp-findings.md §7), so this removes grok's own store directory for
   * that session — the same thing the CLI's history delete does. The id is also remembered as
   * deleted, because the agent process keeps resident sessions in memory and would list it again.
   */
  async deleteSession(sessionId: string): Promise<void> {
    if (!sessionId || sessionId === this.sessionId) return
    const removed = await deleteSessionFromDisk(
      sessionId,
      this.deps.cwd,
      this.deps.log,
    )
    this.deletedSessions.add(sessionId)
    this.knownSessions.delete(sessionId)
    if (!removed)
      this.deps.log(
        `session ${sessionId}: no store directory found, hidden from history only`,
      )
    await this.listSessions()
  }

  async loadSession(sessionId: string): Promise<void> {
    try {
      await this.ensureStarted()
    } catch {
      return
    }
    if (!this.client) return
    this.beginHistoryReplay()
    try {
      // session/load replays the whole update stream into host memory; UI gets one flush after.
      await this.client.request('session/load', {
        sessionId,
        cwd: this.deps.cwd,
        mcpServers: [],
      })
      this.sessionId = sessionId
      this.status.sessionId = sessionId
      this.status.sessionTitle = this.knownSessions.get(sessionId)?.title
      // A resumed session already has history, so `+` must open a genuinely new one after this.
      this.sessionUsed = true
      this.rememberSession(sessionId)
    } catch (err) {
      this.replayingHistory = false
      this.status.loadingHistory = false
      this.addNotice(
        'error',
        `Could not load session: ${(err as Error).message}`,
      )
    } finally {
      this.status.agentState = this.client?.running ? 'idle' : 'stopped'
      if (this.replayingHistory) this.endHistoryReplay()
      else this.pushStatus()
    }
  }

  async listRewindPoints(): Promise<void> {
    if (!this.client?.running || !this.sessionId) return
    try {
      const res = await this.client.request<unknown>(X.rewindPoints, {
        sessionId: this.sessionId,
      })
      const { points, raw } = normalizeRewindPoints(res)
      this.rawRewindPoints = raw
      this.deps.post({ type: 'rewindPoints', points })
    } catch (err) {
      this.deps.post({ type: 'rewindPoints', points: [] })
      this.addNotice(
        'warn',
        `Rewind points unavailable: ${(err as Error).message}`,
      )
    }
  }

  async rewind(pointId: string): Promise<void> {
    if (!this.client?.running || !this.sessionId) return
    const raw = this.rawRewindPoints.get(pointId)
    if (!raw) {
      this.addNotice(
        'warn',
        'That rewind point is no longer available; refresh the list.',
      )
      return
    }
    const targetPromptIndex = numberFrom(raw, [
      'prompt_index',
      'promptIndex',
      'targetPromptIndex',
      'index',
    ])
    if (targetPromptIndex === undefined) {
      this.addNotice(
        'warn',
        'That rewind point has no prompt index; refresh the list.',
      )
      return
    }
    try {
      // `targetPromptIndex` is camelCase even though the point payload is snake_case.
      await this.client.request(X.rewindExecute, {
        sessionId: this.sessionId,
        targetPromptIndex,
      })
      // Drop everything the agent has just forgotten so both sides agree on history.
      const doomed = this.blocks.filter(
        (b) => (b.promptIndex ?? 0) >= targetPromptIndex,
      )
      for (const b of doomed) {
        this.deps.post({ type: 'blockRemove', id: b.id })
        if (b.kind === 'tool') this.toolBlocks.delete(b.toolCallId)
      }
      this.blocks = this.blocks.filter((b) => !doomed.includes(b))
      this.addNotice('info', 'Rewound.')
    } catch (err) {
      this.addNotice('error', `Rewind failed: ${(err as Error).message}`)
    }
  }

  /**
   * Worktree control.
   *
   * grok keeps worktrees under `~/.grok/worktrees/<repo>/<date-hash>` and tracks them in
   * `~/.grok/worktrees.db`, so the paths never come from us. `create` is asynchronous — it
   * answers `{status:"creating", worktreePath}` and finishes with a `_x.ai/git/worktree/status`
   * notification — while `resume_session` is synchronous and also copies this chat into a fresh
   * session rooted in the new tree.
   */
  async worktree(action: WorktreeAction, name?: string): Promise<void> {
    if (!this.client?.running || !this.sessionId) return
    const client = this.client
    const sessionId = this.sessionId
    try {
      switch (action) {
        case 'create': {
          const res = await client.request<Record<string, unknown>>(
            X.worktreeCreate,
            {
              sessionId,
              sourcePath: this.deps.cwd,
              ...(name ? { name, branch: name } : {}),
            },
          )
          const inner = (unwrapResult(res) ?? {}) as Record<string, unknown>
          this.addNotice(
            'info',
            `Creating worktree at ${String(inner.worktreePath ?? '…')}`,
          )
          return // the `created` notification takes it from here
        }

        case 'resume': {
          const res = await client.request<Record<string, unknown>>(
            X.worktreeResume,
            {
              sessionId,
              sourceCwd: this.deps.cwd,
            },
          )
          const inner = (unwrapResult(res) ?? {}) as Record<string, unknown>
          const worktreePath = String(
            inner.effectiveCwd ?? inner.worktreePath ?? '',
          )
          const copied = Number(inner.chatMessagesCopied ?? 0)
          this.addNotice(
            'info',
            `Session copied into a worktree (${copied} message${copied === 1 ? '' : 's'}): ${worktreePath}`,
          )
          await this.offerToOpen(worktreePath)
          return
        }

        case 'list': {
          const entries = await this.listWorktrees()
          if (entries.length === 0) {
            this.addNotice('info', 'No worktrees for this repository.')
            return
          }
          this.addNotice(
            'info',
            entries
              .map((e) => `${e.label} — ${e.path} (${e.status})`)
              .join('\n'),
          )
          const picked = await this.pickWorktree(entries, 'Open a worktree')
          if (picked) await this.offerToOpen(picked.path, /* prompt */ false)
          return
        }

        case 'apply': {
          const picked = await this.pickWorktree(
            await this.listWorktrees(),
            'Apply this worktree onto the workspace',
          )
          if (!picked) return
          const res = await client.request(X.worktreeApply, {
            sessionId,
            worktreePath: picked.path,
          })
          this.addNotice(
            'info',
            `Applied ${picked.label}: ${JSON.stringify(unwrapResult(res) ?? {}).slice(0, 400)}`,
          )
          return
        }

        case 'remove': {
          const picked = await this.pickWorktree(
            await this.listWorktrees(),
            'Remove a worktree',
          )
          if (!picked) return
          const confirm = await vscode.window.showWarningMessage(
            `Remove worktree ${picked.label}?`,
            {
              modal: true,
              detail: `${picked.path}\n\nAnything uncommitted in that tree is lost.`,
            },
            'Remove',
          )
          if (confirm !== 'Remove') return
          const res = await client.request(X.worktreeRemove, {
            sessionId,
            worktreePath: picked.path,
            force: true,
          })
          const removed = (
            unwrapResult(res) as { removed?: boolean } | undefined
          )?.removed
          this.addNotice(
            removed ? 'info' : 'warn',
            `Remove ${picked.label}: ${removed ? 'done' : 'not removed'}`,
          )
          return
        }
      }
    } catch (err) {
      this.addNotice(
        'error',
        `worktree ${action} failed: ${(err as Error).message}`,
      )
    }
  }

  private async listWorktrees(): Promise<WorktreeEntry[]> {
    if (!this.client?.running || !this.sessionId) return []
    const res = await this.client.request<unknown>(X.worktreeList, {
      sessionId: this.sessionId,
    })
    const body = unwrapResult(res)
    const arr = Array.isArray(body) ? (body as Record<string, unknown>[]) : []
    return arr
      .filter((e) =>
        samePath(e.source_repo as string | undefined, this.deps.cwd),
      )
      .map((e) => ({
        id: String(e.id ?? ''),
        path: String(e.path ?? ''),
        label: String(
          (e.metadata as { label?: string } | undefined)?.label ??
            e.id ??
            e.path,
        ),
        status: String(e.status ?? 'unknown'),
        commit: String(e.head_commit ?? '').slice(0, 8),
      }))
      .filter((e) => e.path)
  }

  private async pickWorktree(
    entries: WorktreeEntry[],
    title: string,
  ): Promise<WorktreeEntry | undefined> {
    if (entries.length === 0) {
      this.addNotice('info', 'No worktrees for this repository.')
      return undefined
    }
    const pick = await vscode.window.showQuickPick(
      entries.map((e) => ({
        label: e.label,
        description: `${e.status} · ${e.commit}`,
        detail: e.path,
        entry: e,
      })),
      { title, matchOnDetail: true },
    )
    return pick?.entry
  }

  private async offerToOpen(
    worktreePath: string,
    prompt = true,
  ): Promise<void> {
    if (!worktreePath) return
    if (prompt) {
      const open = await vscode.window.showInformationMessage(
        `Worktree ready at ${worktreePath}`,
        'Open Folder',
      )
      if (!open) return
    }
    await vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.file(worktreePath),
      true,
    )
  }

  /**
   * Opens the path behind a tool card. grok reports paths however the tool happened to receive
   * them, so a card can carry a workspace-relative one — `Uri.file('src/a.ts')` would resolve to
   * the drive root and fail. Anything not already absolute is resolved against the session cwd.
   */
  async openPath(filePath: string, line?: number): Promise<void> {
    const target = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.status.cwd ?? this.deps.cwd, filePath)
    try {
      await this.fs.reveal(target, line)
    } catch (err) {
      this.addNotice(
        'warn',
        `Could not open ${target}: ${(err as Error).message}`,
      )
    }
  }

  /**
   * Opens the edit behind a tool card in the diff editor. Falls back to just opening the file:
   * a card can carry a path without a diff (a read, a rename), and a dead button is worse.
   */
  async openDiff(blockId: string): Promise<void> {
    const block = this.blocks.find((b) => b.id === blockId)
    if (!block || block.kind !== 'tool') return

    const diff = block.contents.find(
      (c): c is Extract<ToolCallContent, { type: 'diff' }> => c.type === 'diff',
    )
    if (!diff) {
      const fallback = block.locations[0]?.path
      if (fallback) await this.openPath(fallback, block.locations[0]?.line)
      return
    }

    try {
      await showAgentDiff({
        key: block.toolCallId || block.id,
        path: diff.path,
        oldText: diff.oldText,
        newText: diff.newText,
      })
    } catch (err) {
      this.addNotice(
        'warn',
        `Could not diff ${diff.path}: ${(err as Error).message}`,
      )
    }
  }

  /** Approvals are entirely ours (grok is run with `bypassPermissions`), so this is purely local. */
  resetPermissions(): void {
    this.gate.reset()
    this.addNotice('info', 'Session approvals cleared.')
  }
}

// ---------------------------------------------------------------- helpers

function toModelInfo(m: AgentModel): ModelInfo {
  return {
    modelId: m.modelId,
    name: m.name ?? m.modelId,
    contextTokens: m._meta?.totalContextTokens,
    supportsReasoningEffort: m._meta?.supportsReasoningEffort,
    reasoningEfforts: (m._meta?.reasoningEfforts ?? []).map((e) => ({
      // `id` is the mode id `session/set_mode` wants; `value` is the same string in practice,
      // but the id is the documented one so prefer it.
      id: e.id ?? e.value,
      label: e.label ?? e.value,
      description: e.description,
    })),
  }
}

/** grok's question shape is undocumented, so read it defensively and hand the UI a fixed shape. */
function toAskQuestion(raw: unknown): AskQuestion {
  const q = (raw ?? {}) as Record<string, unknown>
  const options = Array.isArray(q.options) ? q.options : []
  return {
    question: String(
      q.question ?? q.prompt ?? q.text ?? 'The agent asked a question.',
    ),
    header: typeof q.header === 'string' ? q.header : undefined,
    multiSelect: Boolean(q.multiSelect ?? q.multi_select),
    options: options.map((o) => {
      const opt = (o ?? {}) as Record<string, unknown>
      return {
        label: String(opt.label ?? opt.name ?? opt.value ?? o),
        description:
          typeof opt.description === 'string' ? opt.description : undefined,
        preview: typeof opt.preview === 'string' ? opt.preview : undefined,
      }
    }),
  }
}

function textOf(content: unknown): string {
  if (!content || typeof content !== 'object') return ''
  const c = content as { type?: string; text?: string }
  return c.type === 'text' && typeof c.text === 'string' ? c.text : ''
}

function firstText(content: ToolCallContent[] | undefined): string | undefined {
  for (const c of content ?? []) {
    if (c.type === 'text' && typeof (c as { text?: string }).text === 'string')
      return (c as { text: string }).text
    if (c.type === 'content') {
      const inner = (c as { content?: { text?: string } }).content
      if (typeof inner?.text === 'string') return inner.text
    }
  }
  return undefined
}

/** grok resends the full content array on each update, so the last one wins. */
function mergeContents(
  previous: ToolCallContent[],
  incoming: ToolCallContent[],
): ToolCallContent[] {
  return incoming.length > 0 ? incoming : previous
}

/**
 * True when the wire payload has enough for a non-empty card header (path, command, query, …).
 * Name-only "Read" flashes are what made tool bursts feel artificial.
 */
function toolPayloadReady(p: ToolCallUpdatePayload): boolean {
  if (
    p.status === 'completed' ||
    p.status === 'failed' ||
    p.status === 'cancelled'
  )
    return true
  if (p.locations && p.locations.length > 0) return true
  if (p.content && p.content.length > 0) return true
  const input = (p._meta?.['x.ai/tool']?.input ?? p.rawInput) as
    | Record<string, unknown>
    | undefined
  if (input && typeof input === 'object') {
    for (const key of [
      'path',
      'file_path',
      'filePath',
      'command',
      'cmd',
      'script',
      'query',
      'pattern',
      'regex',
      'url',
      'glob',
      'target',
    ]) {
      const v = input[key]
      if (typeof v === 'string' && v.trim()) return true
    }
    // Any non-empty input object counts (unknown tool shapes).
    if (Object.keys(input).length > 0) return true
  }
  // Title like `Read notes.txt` is enough; bare "Read" is not.
  if (p.title && p.title.trim()) {
    const t = p.title.trim()
    const name = p._meta?.['x.ai/tool']?.name
    const label = stableToolLabel(name, p._meta?.['x.ai/tool']?.label)
    if (t.toLowerCase() !== label.toLowerCase() && t.length > label.length)
      return true
    if (/\s|\//.test(t) || t.includes('\\') || t.includes('`')) return true
  }
  return false
}

/** Shallow-merge successive tool updates while a card is still held off-screen. */
function mergeToolPayload(
  prev: ToolCallUpdatePayload | undefined,
  next: ToolCallUpdatePayload,
): ToolCallUpdatePayload {
  if (!prev) return next
  return {
    ...prev,
    ...next,
    rawInput: next.rawInput ?? prev.rawInput,
    content: next.content?.length ? next.content : prev.content,
    locations: next.locations?.length ? next.locations : prev.locations,
    _meta: next._meta
      ? {
          ...prev._meta,
          ...next._meta,
          'x.ai/tool': {
            ...prev._meta?.['x.ai/tool'],
            ...next._meta['x.ai/tool'],
            input:
              next._meta['x.ai/tool']?.input ??
              prev._meta?.['x.ai/tool']?.input,
          },
        }
      : prev._meta,
  }
}

const GROK_INSTALL_URL = 'https://grok.x.ai/'

/**
 * Turn a spawn/RPC failure into a recovery card. Raw OS / RPC text stays in the protocol log.
 */
function classifyStartFailure(message: string, cliPath: string): SetupHint {
  const m = message.toLowerCase()
  const missingCli =
    /enoent|spawn .*enoent|not recognized as an internal|is not recognized|command not found|cannot find|failed to start .*enoent|no such file or directory/i.test(
      message,
    ) ||
    (/failed to start/i.test(m) && /enoent|not found|not recognized/i.test(m))

  if (missingCli) {
    return {
      kind: 'missing-cli',
      title: 'Grok Build CLI not found',
      detail:
        `This unofficial chat UI needs xAI’s Grok Build CLI on your machine.\n\n` +
        `1. Install and sign in from the official site\n` +
        `2. Confirm \`grok\` works in a terminal (or set grokBuild.cliPath)\n` +
        `3. Click Retry below\n\n` +
        `Looking for: ${cliPath}`,
      installUrl: GROK_INSTALL_URL,
    }
  }

  if (
    /auth|login|unauthori|api.?key|not authenticated|token expired|please (log|sign) in|sign.in/i.test(
      m,
    )
  ) {
    return {
      kind: 'not-authenticated',
      title: 'Sign in to Grok',
      detail:
        `The CLI is installed but not authenticated.\n\n` +
        `Run \`grok\` once in a terminal to sign in, then click Retry.\n` +
        `This extension is only a client UI — accounts and billing stay with xAI.`,
      installUrl: GROK_INSTALL_URL,
    }
  }

  const short =
    message.length > 160 ? `${message.slice(0, 140).trim()}…` : message
  return {
    kind: 'start-failed',
    title: 'Could not start Grok',
    detail:
      `${short}\n\n` +
      `This is an unofficial community extension. You still need a working, authenticated ` +
      `Grok Build CLI. Install docs: ${GROK_INSTALL_URL}`,
    installUrl: GROK_INSTALL_URL,
  }
}

/**
 * Map raw tool/OS errors to a short chat-safe line. Full text still goes to the Output log.
 */
function humanizeToolError(raw: string): string {
  const s = raw.replace(/\r\n/g, '\n').trim()
  if (!s) return 'Something went wrong.'
  const oneLine = s.replace(/\s+/g, ' ')

  if (/ENOENT|no such file or directory|does not exist|not found/i.test(s)) {
    const base =
      oneLine.match(/(?:['"`])([^'"`]*[/\\][^'"`]+)(?:['"`])/)?.[1] ||
      oneLine.match(/([^\s:'"]+\.[A-Za-z0-9]{1,12})\b/)?.[1]
    if (base) {
      const name = base.replace(/\\/g, '/').split('/').pop() || base
      return `Couldn’t find “${name}”.`
    }
    return 'File or path not found.'
  }
  if (/EACCES|EPERM|permission denied/i.test(s)) return 'Permission denied.'
  if (/EISDIR/i.test(s)) return 'That path is a folder, not a file.'
  if (/ENOTDIR/i.test(s)) return 'That path is not a folder.'
  if (/EEXIST/i.test(s)) return 'Already exists.'
  if (/ETIMEDOUT|timed out|timeout/i.test(s)) return 'Timed out.'
  if (/ECONNREFUSED|ENETUNREACH|network/i.test(s)) return 'Network error.'
  if (/Tool I\/O soft-failure|soft-failure/i.test(s))
    return 'Couldn’t read that file (path may be missing or unreachable).'
  if (/is actually a directory/i.test(s))
    return 'That path is a folder, not a file.'

  // Long dumps / stacks — never put them in the bubble.
  if (
    oneLine.length > 140 ||
    /\bat\s+\w+|stack trace|Error:\s*Error/i.test(s) ||
    (s.match(/\n/g) ?? []).length >= 2
  ) {
    const first =
      s
        .split('\n')
        .map((l) => l.trim())
        .find(Boolean) ?? ''
    if (
      first.length > 0 &&
      first.length <= 100 &&
      !/ENOENT|e:\\|\/home\/|\\Users\\/i.test(first)
    ) {
      return first.endsWith('.') ? first : `${first}.`
    }
    return 'The tool hit an error. Use View log for details.'
  }
  return oneLine
}

function prettifyToolName(name: string): string {
  return name
    .split(/[_\-.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Fixed labels from the wire tool name so the card does not morph as x.ai metadata arrives
 * (e.g. search_replace never flashes as "Search Replace" before becoming "Edit").
 */
function stableToolLabel(name?: string, xaiLabel?: string): string {
  const n = (name ?? '').toLowerCase().replace(/-/g, '_')
  const byName: Record<string, string> = {
    read_file: 'Read',
    read: 'Read',
    write: 'Write',
    write_file: 'Write',
    search_replace: 'Edit',
    str_replace: 'Edit',
    strreplace: 'Edit',
    edit: 'Edit',
    apply_patch: 'Edit',
    delete: 'Delete',
    delete_file: 'Delete',
    move: 'Move',
    run_terminal_command: 'Terminal',
    bash: 'Terminal',
    shell: 'Terminal',
    execute: 'Terminal',
    list_dir: 'List',
    list: 'List',
    glob: 'Search',
    grep: 'Search',
    search: 'Search',
    web_search: 'Web',
    web_fetch: 'Fetch',
    fetch: 'Fetch',
    todo_write: 'Plan',
    task: 'Task',
    spawn: 'Task',
  }
  if (n && byName[n]) return byName[n]
  // Prefer a short x.ai label when we have no map entry (not the long ACP title).
  if (xaiLabel?.trim() && xaiLabel.trim().length <= 18) return xaiLabel.trim()
  if (name && name !== 'tool') return prettifyToolName(name)
  return 'Tool'
}

function kindGuessFromName(name?: string): ToolKind | 'unknown' {
  const n = (name ?? '').toLowerCase().replace(/-/g, '_')
  if (!n || n === 'tool') return 'unknown'
  if (
    n.includes('search_replace') ||
    n.includes('str_replace') ||
    n === 'edit' ||
    n.includes('apply_patch')
  )
    return 'edit'
  if (n.includes('write')) return 'write'
  if (n.includes('delete')) return 'delete'
  if (n.includes('move') || n.includes('rename')) return 'move'
  if (
    n.includes('terminal') ||
    n.includes('bash') ||
    n.includes('shell') ||
    n.includes('execute') ||
    n.includes('command')
  )
    return 'execute'
  if (n.includes('grep') || n.includes('glob') || n === 'search')
    return 'search'
  if (n.includes('web_search') || n.includes('web_fetch') || n === 'fetch')
    return 'fetch'
  if (n.includes('list')) return 'list'
  if (n.includes('read')) return 'read'
  if (n.includes('think')) return 'think'
  return 'unknown'
}

function mimeToExt(mime: string): string {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'png'
}

/** todo_write and similar — mirrored as the plan dock, not a tool card. */
function isPlanTool(name?: string, label?: string, title?: string): boolean {
  const blob = `${name ?? ''} ${label ?? ''} ${title ?? ''}`.toLowerCase()
  if (!blob.trim()) return false
  if (blob.includes('todo_write') || blob.includes('todowrite')) return true
  if (/\btodo\b/.test(blob) && /\b(write|update|list)\b/.test(blob)) return true
  if (blob.includes('plan write') || blob.includes('write plan')) return true
  if (label?.toLowerCase() === 'plan' && name?.toLowerCase().includes('todo'))
    return true
  return false
}

/**
 * Replayed `user_message_chunk` text is what we sent on the wire (plan preamble, image path
 * notes, default attachment placeholders) — not what the user typed. Strip host decorations so
 * the bubble matches a live prompt.
 */
function stripAgentPromptDecorations(text: string): string {
  let out = text
  // Plan-mode system reminder we prepend on the wire.
  if (out.startsWith('<system-reminder>')) {
    out = out.replace(/^<system-reminder>[\s\S]*?<\/system-reminder>\s*/, '')
  }
  // Single-image path note from buildPromptBlocks.
  out = out.replace(
    /\n*\s*\[User attached an image\. Saved at:[\s\S]*?\]\s*$/i,
    '',
  )
  // Multi-image path note.
  out = out.replace(
    /\n*\s*\[User attached \d+ images:[\s\S]*?Read those paths if you need the pixels\.\]\s*$/i,
    '',
  )
  out = out.trim()
  // Host/UI placeholders when the user sent only an image (no typed caption).
  if (
    !out ||
    /^Please look at the attached image\(s\)\.?$/i.test(out) ||
    /^Please look at the attached image\(s\) \(paths in the previous note\)\.?$/i.test(
      out,
    )
  ) {
    return '(image attachment)'
  }
  return out
}

function numberFrom(
  obj: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const k of keys) if (typeof obj[k] === 'number') return obj[k] as number
  return undefined
}

function samePath(a: string | undefined, b: string): boolean {
  if (!a) return false
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}

/**
 * The session-list methods wrap their payload in a second `result` object (a quirk of grok's
 * extension dispatcher, confirmed live), and `session_summaries/*` uses a different shape again.
 * Unwrap once, then read whichever field set is present.
 */
function unwrapResult(res: unknown): unknown {
  const inner = (res as { result?: unknown } | null)?.result
  return inner !== undefined && inner !== null ? inner : res
}

/** `/context`, `/compact args` — no free-form prose, so we can route off the chat path. */
function isSlashOnly(text: string): boolean {
  return /^\/[\w:-]+(?:\s+\S[\s\S]*)?$/.test(text.trim())
}

function parseSlash(text: string): { name: string; args: string } | undefined {
  const m = /^\/([\w:-]+)(?:\s+([\s\S]+))?$/.exec(text.trim())
  if (!m) return undefined
  return { name: m[1].toLowerCase(), args: (m[2] ?? '').trim() }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`
  return String(Math.round(n))
}

/**
 * Compact/session APIs often return `{}` or tiny envelopes — never show raw empty JSON to the user.
 */
function formatUtilityPayload(body: unknown): string | undefined {
  if (body == null) return undefined
  if (typeof body === 'string') {
    const t = body.trim()
    return t.length > 0 ? t : undefined
  }
  if (typeof body === 'object') {
    const o = body as Record<string, unknown>
    const keys = Object.keys(o)
    if (keys.length === 0) return undefined
    for (const k of [
      'message',
      'summary',
      'status',
      'detail',
      'result',
      'text',
      'description',
    ]) {
      const v = o[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    // Nested result object with a string field
    if (o.result && typeof o.result === 'object') {
      const nested = formatUtilityPayload(o.result)
      if (nested) return nested
    }
    // Meaningful non-empty object — pretty JSON in a fence
    try {
      const json = JSON.stringify(o, null, 2)
      if (json === '{}' || json === '[]') return undefined
      return '```json\n' + json + '\n```'
    } catch {
      return undefined
    }
  }
  const s = String(body).trim()
  return s.length > 0 && s !== '{}' && s !== 'undefined' ? s : undefined
}

function normalizeSessionList(
  res: unknown,
  fallbackCwd: string,
): SessionSummary[] {
  const body = unwrapResult(res)
  const arr = Array.isArray(body)
    ? body
    : ((body as { sessions?: unknown[] })?.sessions ??
      (body as { session_summaries?: unknown[] })?.session_summaries ??
      (body as { entries?: unknown[] })?.entries ??
      [])
  const out: SessionSummary[] = []
  for (const item of arr as Record<string, unknown>[]) {
    // `session_summaries` nests the identity under `info`.
    const info = (item.info as Record<string, unknown> | undefined) ?? {}
    const id = (item.sessionId ?? item.id ?? info.id) as string | undefined
    if (!id) continue
    const title =
      (item.title as string) ||
      (item.summary as string) ||
      (item.session_summary as string) ||
      '(untitled)'
    out.push({
      sessionId: id,
      title: title.trim() || '(untitled)',
      cwd: ((item.cwd ?? info.cwd) as string) ?? fallbackCwd,
      updatedAt:
        (item.lastChangeUnixMs as number) ??
        (Date.parse(
          (item.updatedAt as string) ?? (item.updated_at as string) ?? '',
        ) ||
          0),
    })
  }
  return out
}

/**
 * `_x.ai/rewind/points` answers `{rewind_points: [{prompt_index, created_at, prompt_preview,
 * num_file_snapshots, has_file_changes}]}` — snake_case and *not* double-wrapped. The other key
 * names are kept as tolerated fallbacks in case a later grok renames them.
 */
function normalizeRewindPoints(res: unknown): {
  points: RewindPoint[]
  raw: Map<string, Record<string, unknown>>
} {
  const body = unwrapResult(res)
  const arr = Array.isArray(body)
    ? body
    : ((body as { rewind_points?: unknown[] })?.rewind_points ??
      (body as { points?: unknown[] })?.points ??
      (body as { rewindPoints?: unknown[] })?.rewindPoints ??
      [])
  const points: RewindPoint[] = []
  const raw = new Map<string, Record<string, unknown>>()
  for (const [i, item] of (arr as Record<string, unknown>[]).entries()) {
    const index = numberFrom(item, [
      'prompt_index',
      'promptIndex',
      'targetPromptIndex',
      'index',
    ])
    const id = String(item.id ?? item.pointId ?? index ?? i)
    const preview = String(
      item.prompt_preview ??
        item.promptPreview ??
        item.label ??
        item.summary ??
        item.prompt ??
        '',
    ).trim()
    const files =
      numberFrom(item, ['num_file_snapshots', 'numFileSnapshots']) ?? 0
    const suffix = files > 0 ? ` · ${files} file${files === 1 ? '' : 's'}` : ''
    points.push({
      id,
      label: `${preview || `Checkpoint ${id}`}`.slice(0, 120) + suffix,
      ts:
        Date.parse(String(item.created_at ?? item.createdAt ?? '')) ||
        undefined,
    })
    raw.set(id, item)
  }
  return { points, raw }
}

/**
 * grok stores every session under `~/.grok/sessions/<percent-encoded cwd>/<uuid>/summary.json`.
 * The directory name is the cwd as the process saw it, so match by decoding rather than encoding.
 */
async function readSessionsFromDisk(
  cwd: string,
  log: (s: string) => void,
): Promise<SessionSummary[]> {
  const root = path.join(
    process.env.GROK_HOME ?? path.join(os.homedir(), '.grok'),
    'sessions',
  )
  const out: SessionSummary[] = []
  try {
    for (const dir of await fsp.readdir(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue
      let decoded: string
      try {
        decoded = decodeURIComponent(dir.name)
      } catch {
        continue
      }
      if (!samePath(decoded, cwd)) continue
      const sessionsDir = path.join(root, dir.name)
      for (const s of await fsp.readdir(sessionsDir, { withFileTypes: true })) {
        if (!s.isDirectory()) continue
        try {
          const text = await fsp.readFile(
            path.join(sessionsDir, s.name, 'summary.json'),
            'utf8',
          )
          const j = JSON.parse(text) as {
            info?: { id?: string; cwd?: string }
            session_summary?: string
            updated_at?: string
            num_chat_messages?: number
          }
          const id = j.info?.id ?? s.name
          if ((j.num_chat_messages ?? 0) === 0) continue // never-used sessions add nothing
          out.push({
            sessionId: id,
            title: j.session_summary?.trim() || '(untitled)',
            cwd: j.info?.cwd ?? decoded,
            updatedAt: Date.parse(j.updated_at ?? '') || 0,
          })
        } catch {
          // partially written session dir — skip
        }
      }
    }
  } catch (err) {
    log(`could not read grok session store: ${(err as Error).message}`)
  }
  return out
}

/**
 * Deletes one session directory from grok's store, returning whether anything was removed.
 *
 * The search is confined to the directories that decode to the current cwd, and the id has to be a
 * plain store directory name — the delete then only ever targets `<store>/<cwd>/<id>`, so a
 * malformed id cannot walk out of the store.
 */
async function deleteSessionFromDisk(
  sessionId: string,
  cwd: string,
  log: (s: string) => void,
): Promise<boolean> {
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) return false
  const root = path.join(
    process.env.GROK_HOME ?? path.join(os.homedir(), '.grok'),
    'sessions',
  )
  try {
    for (const dir of await fsp.readdir(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue
      let decoded: string
      try {
        decoded = decodeURIComponent(dir.name)
      } catch {
        continue
      }
      if (!samePath(decoded, cwd)) continue
      const sessionsDir = path.join(root, dir.name)
      for (const s of await fsp.readdir(sessionsDir, { withFileTypes: true })) {
        if (!s.isDirectory()) continue
        // The directory is usually named after the id, but the id of record lives in summary.json.
        let matches = s.name === sessionId
        if (!matches) {
          try {
            const text = await fsp.readFile(
              path.join(sessionsDir, s.name, 'summary.json'),
              'utf8',
            )
            matches =
              (JSON.parse(text) as { info?: { id?: string } }).info?.id ===
              sessionId
          } catch {
            continue
          }
        }
        if (!matches) continue
        await fsp.rm(path.join(sessionsDir, s.name), {
          recursive: true,
          force: true,
        })
        return true
      }
    }
  } catch (err) {
    log(`could not delete session ${sessionId}: ${(err as Error).message}`)
  }
  return false
}
