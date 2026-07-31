<script lang="ts">
  import type { ToolCallContent, ToolKind } from '../../src/acp/types';
  import type { ToolBlock } from '../../src/shared/protocol';
  import { lineDiff } from '../diff';
  import { middleEllipsis, shortenPath } from '../paths';
  import DiffView from './DiffView.svelte';
  import Icon from './Icon.svelte';

  /** Uppercase verb labels from tool kind — the fixed column is sized for SEARCH. */
  const kindVerbs: Partial<Record<ToolKind | 'unknown', string>> = {
    read: 'READ',
    edit: 'EDIT',
    write: 'WRITE',
    delete: 'DELETE',
    move: 'MOVE',
    search: 'SEARCH',
    list: 'LIST',
    fetch: 'FETCH',
    execute: 'RUN',
    think: 'THINK',
    other: 'TOOL',
    permission: 'PERM',
  };

  interface Props {
    block: ToolBlock;
    cwd?: string;
    onOpenPath: (path: string, line?: number) => void;
    onOpenDiff: (blockId: string) => void;
    /** True when the block above is also a tool — spacing is CSS; prop kept for callers. */
    stacked?: boolean;
  }

  let { block, cwd, onOpenPath, onOpenDiff, stacked = false }: Props = $props();

  let manual = $state<boolean | null>(null);

  const input = $derived((block.input ?? {}) as Record<string, unknown>);

  const diff = $derived(
    block.contents.find((c): c is { type: 'diff'; path: string; oldText: string | null; newText: string } =>
      c.type === 'diff',
    ),
  );

  const output = $derived(collectText(block.contents));
  const live = $derived(block.liveOutput ?? '');
  const command = $derived(str(input.command) ?? str(input.cmd) ?? str(input.script));
  const filePath = $derived(str(input.path) ?? str(input.file_path) ?? diff?.path ?? block.locations[0]?.path);
  const query = $derived(str(input.query) ?? str(input.pattern) ?? str(input.regex));
  const shortPath = $derived(filePath ? shortenPath(filePath, cwd) : undefined);
  const displayTarget = $derived(
    command ?? (shortPath ? middleEllipsis(shortPath) : undefined) ?? query ?? block.label ?? '',
  );

  const pending = $derived(block.status === 'pending');
  const running = $derived(block.status === 'in_progress');
  const busy = $derived(pending || running);
  const failed = $derived(block.status === 'failed');
  /** Failures stay collapsed — raw dumps used to auto-expand and flood the chat. */
  const open = $derived(manual ?? false);

  const body = $derived(live || output);
  const terminal = $derived(block.toolKind === 'execute');
  const verb = $derived(kindVerbs[block.toolKind] ?? block.label?.toUpperCase() ?? 'TOOL');
  const mutating = $derived(!block.readOnly);

  const diffStats = $derived.by(() => {
    if (!diff) return undefined;
    return lineDiff(diff.oldText, diff.newText);
  });

  /**
   * One line of what the tool produced, for the collapsed row.
   *
   * A command is summed up by where it ended, so that gets the last line. A read or a search is
   * summed up by what it found, so those get the first — the last line of a file is usually a
   * lone closing brace, which tells you nothing about what was read.
   * Failures use the short host-humanized `block.error`, never the stack dump.
   */
  const tail = $derived.by(() => {
    if (failed) return block.error || 'Failed';
    const lines = body
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);
    return (terminal ? lines.at(-1) : lines[0]) ?? '';
  });

  /**
   * While the tool is still running, keep a single stable header row. Peek/tail/diff
   * previews only appear after completion — mid-flight content thrash is what made tool
   * cards feel artificial.
   */
  const showDiffSub = $derived(!busy && !failed && Boolean(diff));
  const showTail = $derived(!open && !busy && !failed && !diff && !terminal && Boolean(tail));
  /** Terminal output sits under the row once there is anything to show (live or final). */
  const showTerminalOut = $derived(terminal && !failed && Boolean(body));
  const showExpandedBody = $derived(
    open &&
      !failed &&
      !diff &&
      !terminal &&
      (Boolean(body) || Object.keys(input).length > 0),
  );

  /** Indicator state class for the reserved gutter dot. */
  const indicatorState = $derived.by(() => {
    if (block.waiting) return 'awaiting' as const;
    if (failed) return 'failed' as const;
    if (running) return 'running' as const;
    if (pending) return 'pending' as const;
    return 'done' as const;
  });

  const indicatorLabel = $derived.by(() => {
    if (block.waiting) return 'waiting';
    if (failed) return 'failed';
    if (running) return 'running';
    if (pending) return 'pending';
    return undefined;
  });

  let outputExpanded = $state(false);

  function str(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  function collectText(contents: ToolCallContent[]): string {
    const parts: string[] = [];
    for (const c of contents) {
      if (c.type === 'text' && typeof (c as { text?: string }).text === 'string') {
        parts.push((c as { text: string }).text);
      } else if (c.type === 'content') {
        const inner = (c as { content?: { type?: string; text?: string } }).content;
        if (typeof inner?.text === 'string') parts.push(inner.text);
      }
    }
    return parts.join('\n').trimEnd();
  }

  function toggleDiffPreview() {
    manual = !open;
  }
</script>

<div class="tool" class:stacked class:failed>
  <div class="tool-row">
    <div class="verb-col">
      {#if indicatorState !== 'done'}
        <span
          class="indicator {indicatorState}"
          aria-label={indicatorLabel}
          title={indicatorLabel}
        ></span>
      {:else}
        <span class="indicator done" aria-hidden="true"></span>
      {/if}
      {#if terminal}
        <span class="verb-icon" aria-hidden="true"><Icon name="terminal" size={14} /></span>
      {:else}
        <span class="verb" class:mutating>{verb}</span>
      {/if}
    </div>

    {#if filePath && shortPath}
      <button
        type="button"
        class="path"
        title={filePath}
        onclick={() => onOpenPath(filePath, block.locations[0]?.line)}
      >
        {middleEllipsis(shortPath)}
      </button>
    {:else if terminal && command}
      <span class="target terminal-cmd" title={command}>
        <span class="sigil">$</span>
        {command}
      </span>
    {:else}
      <span class="target" title={displayTarget || undefined}>{displayTarget}</span>
    {/if}

    <div class="actions">
      {#if diff}
        <button
          type="button"
          class="ghost-action"
          title="Open this edit in the diff editor"
          onclick={() => onOpenDiff(block.id)}>diff</button
        >
      {/if}
      {#if filePath}
        <button
          type="button"
          class="ghost-action"
          title="Open {filePath}"
          onclick={() => onOpenPath(filePath, block.locations[0]?.line)}>open</button
        >
      {/if}
    </div>
  </div>

  {#if failed && block.error}
    <div class="error-line">{block.error}</div>
  {/if}

  {#if showTail}
    <button type="button" class="subrow tail" title={tail} onclick={() => (manual = true)}>
      {tail}
    </button>
  {/if}

  {#if showDiffSub && diff && diffStats}
    <div class="subrow">
      <span class="diff-counts">
        <span class="diff-add">+{diffStats.added}</span>
        <span class="diff-del">−{diffStats.removed}</span>
      </span>
      <button type="button" class="ghost-action" onclick={toggleDiffPreview}>
        {open ? 'collapse diff' : 'preview diff'}
      </button>
    </div>
    {#if open}
      <div class="sub-body">
        <DiffView oldText={diff.oldText} newText={diff.newText} />
      </div>
    {/if}
  {/if}

  {#if showTerminalOut}
    <div class="sub-body">
      <pre class="terminal-out" class:expanded={outputExpanded}>{body}</pre>
      {#if body.split('\n').length > 12 || body.length > 800}
        <button
          type="button"
          class="ghost-action show-all"
          onclick={() => (outputExpanded = !outputExpanded)}
        >
          {outputExpanded ? 'collapse' : 'show all'}
        </button>
      {/if}
    </div>
  {:else if showExpandedBody}
    <div class="sub-body">
      {#if body}
        <pre class="terminal-out" class:expanded={outputExpanded}>{body}</pre>
      {:else if Object.keys(input).length > 0}
        <pre class="terminal-out dim">{JSON.stringify(input, null, 2)}</pre>
      {/if}
      <button type="button" class="ghost-action show-all" onclick={() => (manual = false)}>
        collapse
      </button>
    </div>
  {/if}
</div>

<style>
  .tool {
    min-width: 0;
  }

  /* One row metric only: padding 6px 0 on every tool row, stacked or not. */
  .tool-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    min-width: 0;
  }

  /*
   * 56px of verb + permanently reserved 10px dot gutter. The dot is absolute so pending /
   * running / failed never shift the verb text.
   */
  .verb-col {
    position: relative;
    flex: 0 0 66px;
    padding-left: 10px;
    display: flex;
    align-items: center;
    text-align: left;
    min-width: 0;
  }

  .indicator {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .indicator.pending {
    border: 1px solid var(--text-faint);
    background: transparent;
  }

  .indicator.running {
    background-color: var(--accent);
    animation: pulse 1.5s infinite ease-in-out;
  }

  .indicator.done {
    display: none;
  }

  .indicator.failed {
    background-color: var(--danger);
  }

  .indicator.awaiting {
    background-color: var(--warning);
  }

  @keyframes pulse {
    0% {
      opacity: 0.4;
      transform: translateY(-50%) scale(0.9);
    }
    50% {
      opacity: 1;
      transform: translateY(-50%) scale(1.1);
    }
    100% {
      opacity: 0.4;
      transform: translateY(-50%) scale(0.9);
    }
  }

  .verb {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
    flex-shrink: 0;
    line-height: 1;
  }

  .verb.mutating {
    color: var(--text-muted);
  }

  .verb-icon {
    display: flex;
    align-items: center;
    color: var(--text-muted);
  }

  .path,
  .target {
    flex: 1 1 auto;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.45;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
  }

  .path {
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    cursor: pointer;
    text-decoration: none;
  }

  .path:hover {
    text-decoration: underline;
  }

  /* Tool rows: focus = hover wash + 2px focus left edge, not a full ring. */
  .path:focus-visible {
    outline: none;
    background-color: var(--bg-hover);
    box-shadow: inset 2px 0 0 var(--focus);
  }

  .target {
    color: var(--text);
  }

  .terminal-cmd {
    color: var(--text);
    font-weight: 500;
  }

  .sigil {
    color: var(--text-faint);
    font-weight: 400;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
    margin-left: auto;
  }

  .ghost-action {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    line-height: 1.2;
  }

  .ghost-action:hover,
  .ghost-action:focus-visible {
    color: var(--text);
    background-color: var(--bg-hover);
  }

  /* Sub-rows share one left edge: 10 + 56 + 8 = 74px (dot gutter + verb + gap). */
  .subrow {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding-left: 74px;
    margin-top: 4px;
    font-size: 11.5px;
    min-width: 0;
  }

  .subrow.tail {
    display: block;
    width: 100%;
    border: none;
    background: none;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.45;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
    cursor: pointer;
    padding-top: 0;
    padding-bottom: 0;
    padding-right: 0;
  }

  .subrow.tail:hover {
    color: var(--text-muted);
  }

  .diff-counts {
    font-family: var(--font-mono);
    font-size: 11.5px;
    display: inline-flex;
    gap: 6px;
  }

  .diff-add {
    color: var(--diff-add-text);
  }

  .diff-del {
    color: var(--diff-del-text);
  }

  .error-line {
    font-size: 11.5px;
    color: var(--danger);
    margin-top: 4px;
    padding-left: 74px;
    overflow-wrap: anywhere;
  }

  .sub-body {
    padding-left: 74px;
    margin-top: var(--space-2);
    min-width: 0;
  }

  .cmd {
    margin: 0 0 var(--space-2);
    padding: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text);
  }

  .terminal-out {
    margin: 0;
    max-height: 12rem;
    overflow: auto;
    padding: var(--space-2) var(--space-3);
    background: var(--bg-inset);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text-muted);
  }

  .terminal-out.expanded {
    max-height: none;
  }

  .terminal-out.dim {
    color: var(--text-faint);
  }

  .show-all {
    margin-top: 4px;
    padding-left: 0;
  }
</style>
