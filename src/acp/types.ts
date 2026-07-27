/**
 * Wire types for Grok Build CLI's ACP surface.
 *
 * These describe what grok v0.2.112 actually sends, which differs from the published
 * ACP docs in two ways that matter: `sessionUpdate` discriminators are snake_case, and
 * a large amount of behaviour lives in `_meta["x.ai/*"]` / `_x.ai/*` methods.
 * See docs/acp-findings.md for the recordings these were derived from.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  /**
   * Never present — declared so a request (which carries an id) is not structurally assignable
   * to a notification. Without it, `!isNotification(frame)` narrows requests away too.
   */
  id?: undefined;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export type JsonRpcFrame = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function isRequest(f: JsonRpcFrame): f is JsonRpcRequest {
  return 'method' in f && 'id' in f && f.id !== undefined && f.id !== null;
}

export function isNotification(f: JsonRpcFrame): f is JsonRpcNotification {
  return 'method' in f && !('id' in f);
}

export function isResponse(f: JsonRpcFrame): f is JsonRpcResponse {
  return !('method' in f) && 'id' in f;
}

// ---------------------------------------------------------------- content blocks

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  mimeType?: string;
  data?: string;
  uri?: string;
}

export interface ResourceLinkContent {
  type: 'resource_link';
  uri: string;
  name?: string;
}

export type ContentBlock = TextContent | ImageContent | ResourceLinkContent | { type: string; [k: string]: unknown };

/** Tool output. `content` is display-ready; `diff` arrives pre-computed for edits. */
export type ToolCallContent =
  | { type: 'content'; content: ContentBlock }
  | { type: 'diff'; path: string; oldText: string | null; newText: string }
  | { type: 'text'; text: string }
  | { type: 'terminal'; terminalId: string }
  | { type: string; [k: string]: unknown };

export interface ToolLocation {
  path: string;
  line?: number;
}

// ---------------------------------------------------------------- x.ai tool meta

export type ToolKind = 'read' | 'edit' | 'execute' | 'search' | 'fetch' | 'think' | 'other' | 'permission' | 'write' | 'list' | 'move' | 'delete';

/** `_meta["x.ai/tool"]` — the richest source for rendering a tool card. */
export interface XaiToolMeta {
  version?: number;
  name?: string;
  kind?: ToolKind;
  namespace?: string;
  label?: string;
  read_only?: boolean;
  input?: Record<string, unknown>;
}

export interface UpdateMeta {
  'x.ai/tool'?: XaiToolMeta;
  modelId?: string;
  promptIndex?: number;
  [k: string]: unknown;
}

// ---------------------------------------------------------------- session updates

export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface ToolCallUpdatePayload {
  toolCallId: string;
  title?: string;
  kind?: ToolKind;
  status?: ToolCallStatus;
  content?: ToolCallContent[];
  locations?: ToolLocation[];
  rawInput?: Record<string, unknown>;
  rawOutput?: unknown;
  _meta?: UpdateMeta;
}

export interface PlanEntry {
  content: string;
  priority?: 'high' | 'medium' | 'low';
  status?: 'pending' | 'in_progress' | 'completed';
}

export interface TurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedReadTokens?: number;
  reasoningTokens?: number;
  modelCalls?: number;
  apiDurationMs?: number;
  /** USD × 1e9. */
  costUsdTicks?: number;
  modelUsage?: Record<string, TurnUsage>;
  numTurns?: number;
}

export interface AvailableCommand {
  name: string;
  description?: string;
  input?: { hint?: string } | null;
}

export type SessionUpdate =
  | { sessionUpdate: 'user_message_chunk'; content: ContentBlock; _meta?: UpdateMeta }
  | { sessionUpdate: 'agent_message_chunk'; content: ContentBlock; _meta?: UpdateMeta }
  | { sessionUpdate: 'agent_thought_chunk'; content: ContentBlock; _meta?: UpdateMeta }
  | ({ sessionUpdate: 'tool_call' } & ToolCallUpdatePayload)
  | ({ sessionUpdate: 'tool_call_update' } & ToolCallUpdatePayload)
  | { sessionUpdate: 'tool_call_delta_chunk'; tool_call_id: string; tool_index?: number; name?: string }
  | { sessionUpdate: 'plan'; entries: PlanEntry[] }
  | { sessionUpdate: 'available_commands_update'; availableCommands: AvailableCommand[] }
  | { sessionUpdate: 'turn_completed'; prompt_id?: string; stop_reason?: string; usage?: TurnUsage }
  | { sessionUpdate: 'pending_interaction'; tool_call_id: string; kind?: string }
  | { sessionUpdate: 'interaction_resolved'; tool_call_id: string }
  | { sessionUpdate: 'session_summary_generated'; session_summary: string }
  | { sessionUpdate: 'model_changed'; modelId?: string; reasoningEffort?: string; [k: string]: unknown }
  | { sessionUpdate: 'image_compressed'; [k: string]: unknown }
  | { sessionUpdate: string; [k: string]: unknown };

export interface SessionNotification {
  sessionId: string;
  update: SessionUpdate;
}

// ---------------------------------------------------------------- handshake

export interface InitializeResponse {
  protocolVersion: number;
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean };
    mcpCapabilities?: { http?: boolean; sse?: boolean };
    _meta?: Record<string, unknown>;
  };
  authMethods?: { id: string; name?: string; description?: string }[];
  _meta?: {
    agentVersion?: string;
    agentId?: string;
    hostname?: string;
    modelState?: Record<string, unknown>;
    availableCommands?: AvailableCommand[];
    cancelRewind?: boolean;
    sessionRecap?: boolean;
    [k: string]: unknown;
  };
}

export interface AgentModel {
  modelId: string;
  name?: string;
  description?: string;
  _meta?: {
    totalContextTokens?: number;
    supportsReasoningEffort?: boolean;
    reasoningEffort?: string;
    reasoningEfforts?: { id?: string; value: string; label?: string; description?: string; default?: boolean }[];
    [k: string]: unknown;
  };
}

/** `_meta["x.ai/sessionConfig"].options` — `category: "mode"` means *reasoning effort*. */
export interface SessionConfigOption {
  id: string;
  category: 'model' | 'mode' | string;
  label?: string;
  description?: string;
  selected?: boolean;
}

export interface NewSessionResponse {
  sessionId: string;
  models?: { currentModelId?: string; availableModels?: AgentModel[] };
  modes?: { currentModeId?: string; availableModes?: { id: string; name?: string }[] };
  _meta?: {
    currentWorkingDirectory?: string;
    codebaseIndexed?: unknown;
    isGitRepo?: boolean;
    gitRoot?: string | null;
    showNonGitWarning?: boolean;
    'x.ai/sessionConfig'?: { options?: SessionConfigOption[] };
    'x.ai/sessionDetail'?: { sessionId?: string; kind?: string; cwd?: string; currentModelId?: string };
    [k: string]: unknown;
  };
}

export interface PromptResponse {
  stopReason: 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled' | string;
  _meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------- client-side requests

export interface ReadTextFileParams {
  sessionId: string;
  path: string;
  line?: number | null;
  limit?: number | null;
}

export interface WriteTextFileParams {
  sessionId: string;
  path: string;
  content: string;
}

export type PermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}

/**
 * Never observed in the wild on v0.2.112 (grok resolves its own permission checkpoint
 * internally), but the binary links agent-client-protocol 0.10.4 so handle it defensively.
 */
export interface RequestPermissionParams {
  sessionId: string;
  toolCall: ToolCallUpdatePayload;
  options?: PermissionOption[];
}

export type RequestPermissionOutcome =
  | { outcome: { outcome: 'selected'; optionId: string } }
  | { outcome: { outcome: 'cancelled' } };

export interface CreateTerminalParams {
  sessionId: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: { name: string; value: string }[];
  outputByteLimit?: number;
}

export interface TerminalExitStatus {
  exitCode: number | null;
  signal: string | null;
}

export interface TerminalOutputResponse {
  output: string;
  truncated: boolean;
  exitStatus?: TerminalExitStatus | null;
}
