import * as path from 'node:path';
import type { ApprovalDecision, ApprovalRequest, PermissionMode } from '../shared/protocol';

export type GateVerdict =
  | { action: 'allow' }
  | { action: 'ask' }
  | { action: 'deny'; reason: string };

/**
 * The approval gate.
 *
 * Grok's ACP server never raises `session/request_permission` (see docs/acp-findings.md), so
 * approvals are enforced where we are genuinely in control: the `fs/write_text_file` and
 * `terminal/create` callbacks. Nothing can touch the workspace without passing through here.
 */
export class PermissionGate {
  private allowedCommandPrefixes = new Set<string>();
  private deniedCommandPrefixes = new Set<string>();
  private allowedWritePaths = new Set<string>();

  constructor(private mode: PermissionMode) {}

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  /** Session-scoped memory only — nothing is persisted to disk on purpose. */
  reset(): void {
    this.allowedCommandPrefixes.clear();
    this.deniedCommandPrefixes.clear();
    this.allowedWritePaths.clear();
  }

  checkWrite(filePath: string): GateVerdict {
    if (this.mode === 'bypassPermissions') return { action: 'allow' };
    if (this.mode === 'plan') {
      return {
        action: 'deny',
        reason:
          'Plan mode is active: file writes are blocked. Present the plan for approval instead of editing.',
      };
    }
    if (this.mode === 'acceptEdits') return { action: 'allow' };
    if (this.allowedWritePaths.has(normalize(filePath))) return { action: 'allow' };
    if (this.allowedWritePaths.has(dirScope(filePath))) return { action: 'allow' };
    return { action: 'ask' };
  }

  checkCommand(command: string): GateVerdict {
    if (this.mode === 'bypassPermissions') return { action: 'allow' };
    if (this.mode === 'plan') {
      return {
        action: 'deny',
        reason:
          'Plan mode is active: shell commands are blocked. Use read-only tools and present a plan.',
      };
    }
    const prefixes = commandPrefixes(command);
    const denied = prefixes.find((p) => this.deniedCommandPrefixes.has(p));
    if (denied) {
      return { action: 'deny', reason: `\`${denied}\` was rejected earlier in this session.` };
    }
    // Every part of a chained command has to be covered; one unknown segment still asks.
    if (prefixes.every((p) => this.allowedCommandPrefixes.has(p))) return { action: 'allow' };
    return { action: 'ask' };
  }

  /** Fold an answered approval into the session's memory. */
  remember(request: ApprovalRequest, decision: ApprovalDecision): void {
    if (request.kind === 'command' && request.command) {
      for (const prefix of commandPrefixes(request.command)) {
        if (decision === 'always') this.allowedCommandPrefixes.add(prefix);
        if (decision === 'rejectAlways') this.deniedCommandPrefixes.add(prefix);
      }
      return;
    }
    if (request.kind === 'write' && request.path) {
      // "Always" on a write means "stop asking about edits", matching Claude Code's
      // accept-edits toggle, rather than accumulating one rule per file.
      if (decision === 'always') this.mode = 'acceptEdits';
      return;
    }
  }

  describeAlwaysScope(request: ApprovalRequest): string | undefined {
    if (request.kind === 'command' && request.command) {
      return commandPrefixes(request.command)
        .map((p) => `Bash(${p}:*)`)
        .join(' + ');
    }
    if (request.kind === 'write') return 'Edit(all files this session)';
    return undefined;
  }
}

function normalize(p: string): string {
  return path.resolve(p).toLowerCase();
}

function dirScope(p: string): string {
  return normalize(path.dirname(p));
}

/**
 * Reduce a command line to the token an "always allow" should cover: `npm run test -- -w`
 * becomes `npm run`, `git status` becomes `git status`, `node x.js` becomes `node`.
 * Deliberately conservative — a broader rule would silently authorise more than the user saw.
 */
export function commandPrefix(command: string): string {
  const trimmed = command.trim();
  // Substitutions and redirections can hide a second command inside an argument, so those stay
  // whole — but plain chains are split by `commandPrefixes` before they ever reach here.
  if (/[><`$(]/.test(trimmed)) return trimmed;
  const tokens = trimmed.split(/\s+/);
  const head = tokens[0] ?? trimmed;
  const second = tokens[1];
  const subcommandHosts = new Set(['git', 'npm', 'pnpm', 'yarn', 'cargo', 'docker', 'wrangler', 'gh', 'python', 'pip']);
  if (second && !second.startsWith('-') && subcommandHosts.has(head)) return `${head} ${second}`;
  return head;
}

/**
 * One prefix per command in a chain, so "Always allow" on `npm ci && npm test` learns both parts
 * and actually stops the prompts. Splitting only on plain operators keeps it honest: a command
 * with substitution or redirection is still remembered verbatim by `commandPrefix`.
 */
export function commandPrefixes(command: string): string[] {
  const trimmed = command.trim();
  if (/[><`$(]/.test(trimmed)) return [commandPrefix(trimmed)];
  const segments = trimmed
    .split(/\s*(?:&&|\|\||[;|])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return [commandPrefix(trimmed)];
  return [...new Set(segments.map(commandPrefix))];
}
