/**
 * Grok CLI argument assembly.
 *
 * Order is load-bearing and not guessable from `--help`:
 *   grok [global flags] agent [agent flags] stdio
 * `--permission-mode` / `--allow` / `--deny` are global (before `agent`), while
 * `--model` / `--reasoning-effort` / `--always-approve` / `--no-leader` belong to `agent`
 * (between `agent` and `stdio`). Anything placed after `stdio` fails with
 * "error: unexpected argument". Verified against grok 0.2.112.
 */

export interface SpawnOptions {
  /** Grok's own gate. We keep it out of the way because this extension enforces approvals itself. */
  permissionMode?: 'default' | 'acceptEdits' | 'auto' | 'dontAsk' | 'bypassPermissions' | 'plan';
  model?: string;
  reasoningEffort?: string;
  /** Attach to the shared leader at ~/.grok/leader.sock so sessions stay in sync with the TUI. */
  useSharedLeader?: boolean;
  allow?: string[];
  deny?: string[];
}

export function buildAgentArgs(opts: SpawnOptions): string[] {
  const args: string[] = [];

  if (opts.permissionMode) args.push('--permission-mode', opts.permissionMode);
  for (const rule of opts.allow ?? []) args.push('--allow', rule);
  for (const rule of opts.deny ?? []) args.push('--deny', rule);

  args.push('agent');

  if (opts.model) args.push('--model', opts.model);
  if (opts.reasoningEffort) args.push('--reasoning-effort', opts.reasoningEffort);
  if (opts.useSharedLeader === false) args.push('--no-leader');

  args.push('stdio');
  return args;
}
