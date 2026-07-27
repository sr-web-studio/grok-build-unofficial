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
import { FsBridge } from './fsBridge'
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
  private readonly interjections: QueuedInterjection[] = []
  /**
   * Next prompt to run after the current turn is cancelled (force-push one queued message).
   * Remaining interjections stay queued and flush afterward.
   */
  private forceNext:
    | { text: string; images?: PromptImage[]; wasQueued?: boolean }
    | undefined
  /** From initialize — grok 0.2.x advertises `image: false`; we still save files as a fallback. */
  private promptSupportsImage = false
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
    this.deps.post({ type: 'status', status: this.status })
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
      this.promptSupportsImage = Boolean(
        init.agentCapabilities?.promptCapabilities?.image,
      )
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
      this.status.agentState = 'stopped'
      this.status.error = message
      this.pushStatus()
      this.addNotice('error', `Could not start grok: ${message}`)
      client.dispose()
      this.client = undefined
      throw err
    }

    this.status.agentState = 'idle'
    this.status.error = undefined
    this.pushStatus()
    this.deps.log(
      `session ready: ${this.sessionId} (grok ${this.status.agentVersion ?? '?'})`,
    )
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
        this.clearTranscript()
        this.status.planEntries = undefined
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
        this.closeStreams()
        this.deps.log(`resumed session ${this.sessionId ?? sessionId}`)
        this.pushStatus()
        return true
      } catch (err) {
        this.deps.log(`resume ${sessionId} failed: ${(err as Error).message}`)
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
    this.deps.post({ type: 'blockAdd', block, anchorId })
    return block
  }

  private patch(block: TranscriptBlock, patch: Record<string, unknown>): void {
    Object.assign(block, patch)
    this.deps.post({ type: 'blockPatch', id: block.id, patch })
  }

  private removeBlock(id: string): void {
    const index = this.blocks.findIndex((b) => b.id === id)
    if (index < 0) return
    this.blocks.splice(index, 1)
    this.deps.post({ type: 'blockRemove', id })
  }

  private appendText(block: TextBlock | ThinkingBlock, text: string): void {
    block.text += text
    this.deps.post({
      type: 'blockPatch',
      id: block.id,
      patch: {},
      appendText: text,
    })
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
    this.terminalToBlock.clear()
    this.openText = undefined
    this.openThinking = undefined
    this.currentPromptIndex = undefined
    this.deps.post({ type: 'clear' })
  }

  private closeStreams(): void {
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

  async prompt(text: string, images?: PromptImage[]): Promise<void> {
    const trimmed = text.trim()
    const imgs = images?.length ? images : undefined
    if (!trimmed && !imgs?.length) return
    try {
      await this.ensureStarted()
    } catch {
      return // start() already reported the failure in the transcript
    }
    if (this.turnActive) {
      // Matches the CLI: typing during a turn interjects rather than being dropped.
      this.interject(trimmed, imgs)
      return
    }
    const saved = await this.materializeImages(imgs)
    this.addBlock<TextBlock>({
      id: this.nextId('user'),
      ts: Date.now(),
      kind: 'text',
      role: 'user',
      text: trimmed || (saved?.length ? '(image attachment)' : ''),
      streaming: false,
      images: saved,
    })
    await this.runTurn(trimmed, saved)
  }

  private async runTurn(text: string, images?: PromptImage[]): Promise<void> {
    const client = this.client
    if (!client || !this.sessionId) return
    this.sessionUsed = true
    this.rememberSession(this.sessionId)
    this.turnActive = true
    this.cancelling = false
    this.status.agentState = 'thinking'
    this.pushStatus()
    try {
      const prompt = await this.buildPromptBlocks(text, images)
      const res = await client.request<PromptResponse>('session/prompt', {
        sessionId: this.sessionId,
        prompt,
      })
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
      this.status.agentState = this.client?.running ? 'idle' : 'stopped'
      this.pushStatus()
      await this.flushAfterTurn()
    }
  }

  private async buildPromptBlocks(
    text: string,
    images?: PromptImage[],
  ): Promise<ContentBlock[]> {
    const body =
      this.gate.getMode() === 'plan' ? `${PLAN_MODE_PREAMBLE}\n\n${text}` : text
    const blocks: ContentBlock[] = []
    const pathNotes: string[] = []
    for (const img of images ?? []) {
      if (this.promptSupportsImage && img.data) {
        blocks.push({
          type: 'image',
          mimeType: img.mimeType,
          data: img.data,
        })
      } else if (img.path) {
        pathNotes.push(img.path)
      }
    }
    let textOut = body
    if (pathNotes.length) {
      const note =
        pathNotes.length === 1
          ? `\n\n[Attached image saved at: ${pathNotes[0]} — open/read this file to inspect the screenshot. ACP image prompts are not enabled by this Grok CLI build.]`
          : `\n\n[Attached images saved at:\n${pathNotes.map((p) => `- ${p}`).join('\n')}\nOpen/read these files to inspect the screenshots. ACP image prompts are not enabled by this Grok CLI build.]`
      textOut = (textOut || 'Please look at the attached image(s).') + note
    }
    if (textOut) blocks.unshift({ type: 'text', text: textOut })
    if (blocks.length === 0) blocks.push({ type: 'text', text: text || '' })
    return blocks
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
  interject(text: string, images?: PromptImage[]): void {
    const trimmed = text.trim()
    const imgs = images?.length ? images : undefined
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
      case 'fs/read_text_file':
        return this.fs.readTextFile(rawParams as ReadTextFileParams)

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

  private async onWriteRequest(params: WriteTextFileParams): Promise<null> {
    const verdict = this.gate.checkWrite(params.path)
    if (verdict.action === 'deny') throw rpcFail(-32000, verdict.reason)

    if (verdict.action === 'ask') {
      const oldText = await this.fs.currentContent(params.path)
      const decision = await this.askApproval({
        requestId: `apr-${++this.approvalSeq}`,
        kind: 'write',
        title:
          oldText === null
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
    return this.fs.writeTextFile(params)
  }

  private async onTerminalCreate(
    params: CreateTerminalParams,
  ): Promise<{ terminalId: string }> {
    const commandLine = [params.command, ...(params.args ?? [])].join(' ')
    const verdict = this.gate.checkCommand(commandLine)
    if (verdict.action === 'deny') throw rpcFail(-32000, verdict.reason)

    if (verdict.action === 'ask') {
      const decision = await this.askApproval({
        requestId: `apr-${++this.approvalSeq}`,
        kind: 'command',
        title: 'Run command',
        command: commandLine,
        cwd: params.cwd ?? this.deps.cwd,
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
      // already has its user block, so only the replay needs rendering.
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
          text: stripPlanPreamble(text),
          streaming: false,
        })
        return
      }

      case 'agent_message_chunk': {
        const text = textOf((update as { content?: unknown }).content)
        if (!text) return
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
        // Arrives before the tool call itself; shows a card the moment grok starts a tool.
        // These come in pairs and only the first carries an id — the follow-up is a raw
        // `arguments_delta`. Without this guard it minted an anonymous card that nothing ever
        // updated, which is the "() Tool" that span forever.
        const p = update as { tool_call_id?: string; name?: string }
        if (!p.tool_call_id) return
        this.closeStreams()
        this.ensureToolBlock(p.tool_call_id, { name: p.name })
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
          const existing = this.toolBlocks.get(p.toolCallId)
          if (existing) {
            this.removeBlock(existing.id)
            this.toolBlocks.delete(p.toolCallId)
          }
          return
        }
        const block = this.ensureToolBlock(p.toolCallId, {
          name: xaiName || undefined,
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

  private ensureToolBlock(
    toolCallId: string,
    seed: { name?: string },
  ): ToolBlock {
    const existing = this.toolBlocks.get(toolCallId)
    if (existing) return existing
    const name = seed.name ?? 'tool'
    const block = this.addBlock<ToolBlock>({
      id: this.nextId('tool'),
      ts: Date.now(),
      kind: 'tool',
      toolCallId,
      name,
      label: prettifyToolName(name),
      toolKind: 'unknown',
      title: prettifyToolName(name),
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
    if (xai?.name) {
      patch.name = xai.name
      patch.label = xai.label ?? prettifyToolName(xai.name)
    }
    if (xai?.kind ?? p.kind) patch.toolKind = (xai?.kind ?? p.kind) as ToolKind
    if (typeof xai?.read_only === 'boolean') patch.readOnly = xai.read_only
    if (xai?.input ?? p.rawInput) patch.input = xai?.input ?? p.rawInput
    if (p.title) patch.title = p.title
    if (p.status) patch.status = p.status
    if (p.locations) patch.locations = p.locations
    if (p.content) patch.contents = mergeContents(block.contents, p.content)
    if (p.status === 'failed')
      patch.error = firstText(p.content) ?? 'Tool failed.'
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

  private onTerminalOutput(terminalId: string, chunk: string): void {
    const blockId = this.terminalToBlock.get(terminalId)
    if (!blockId) return
    const block = this.blocks.find((b) => b.id === blockId)
    if (!block || block.kind !== 'tool') return
    block.liveOutput = (block.liveOutput ?? '') + chunk
    this.deps.post({
      type: 'blockPatch',
      id: blockId,
      patch: {},
      appendOutput: chunk,
    })
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
    this.clearTranscript()
    this.status.agentState = 'starting'
    this.pushStatus()
    try {
      // session/load replays the whole update stream, which rebuilds the transcript for free.
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
      this.closeStreams()
    } catch (err) {
      this.addNotice(
        'error',
        `Could not load session: ${(err as Error).message}`,
      )
    } finally {
      this.status.agentState = this.client?.running ? 'idle' : 'stopped'
      this.pushStatus()
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

function prettifyToolName(name: string): string {
  return name
    .split(/[_\-.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Replayed history includes anything we prepended, which the user never typed. */
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

function stripPlanPreamble(text: string): string {
  return text.startsWith('<system-reminder>')
    ? text.replace(/^<system-reminder>[\s\S]*?<\/system-reminder>\s*/, '')
    : text
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
