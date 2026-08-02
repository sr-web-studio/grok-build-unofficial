<script lang="ts">
  import type { ToolCallContent, ToolKind } from '../../src/acp/types';
  import type { ToolBlock } from '../../src/shared/protocol';
  import { lineDiff } from '../diff';
  import { middleEllipsis, shortenPath } from '../paths';
  import CodePreview from './CodePreview.svelte';
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

  /**
   * A peek, not a viewer. WRITE and EDIT show enough to recognise the change; `diff` and `open`
   * are how you actually read it, so the inline preview stays short and has no expand of its own.
   */
  const PREVIEW_MAX_ROWS = 8;

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
  let outputExpanded = $state(false);
  let cmdExpanded = $state(false);
  let cmdTruncated = $state(false);
  let cmdEl: HTMLElement | undefined = $state();

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
  const kindVerb = $derived(kindVerbs[block.toolKind]);
  /*
   * The label is only a usable target when it is not already the verb. An unmapped tool kind
   * falls back to the uppercased label for the verb, and repeating it here read "ASK USER
   * Ask User" on the same row.
   */
  const displayTarget = $derived(
    command ??
      (shortPath ? middleEllipsis(shortPath) : undefined) ??
      query ??
      (kindVerb ? block.label : undefined) ??
      '',
  );

  const pending = $derived(block.status === 'pending');
  const running = $derived(block.status === 'in_progress');
  const busy = $derived(pending || running);
  const failed = $derived(block.status === 'failed');
  /** Failures stay collapsed — raw dumps used to auto-expand and flood the chat. */
  const open = $derived(manual ?? false);

  const body = $derived(live || output);
  const terminal = $derived(block.toolKind === 'execute');
  const verb = $derived(kindVerb ?? block.label?.toUpperCase() ?? 'TOOL');
  const mutating = $derived(!block.readOnly);

  /** WRITE = new file (diff with null oldText). EDIT = real change (non-null oldText). */
  const isWriteDiff = $derived(Boolean(diff && diff.oldText === null));
  const isEditDiff = $derived(Boolean(diff && diff.oldText !== null));

  const diffStats = $derived.by(() => {
    if (!diff || !isEditDiff) return undefined;
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
   * A READ renders as the link alone — no preview. The agent reading a file is a step, not an
   * answer, and a dozen inline file views turned a three-line reply into a wall. The one thing
   * worth keeping from the output is where the read started: Grok prefixes every line `N→` with
   * the real file line, so the first N tells `open` where to put the cursor.
   */
  const readStartLine = $derived.by(() => {
    if (!body || terminal || block.toolKind !== 'read') return undefined;
    const first = /^\s*(\d+)→/m.exec(body);
    return first ? Number(first[1]) : undefined;
  });

  /** Where `open` should land: the line the read actually started at, if we know it. */
  const openLine = $derived(block.locations[0]?.line ?? readStartLine);

  /**
   * While the tool is still running, keep a single stable header row. Peek/tail/diff
   * previews only appear after completion — mid-flight content thrash is what made tool
   * cards feel artificial. Terminal output is the exception (streams live).
   */
  const showWritePreview = $derived(!busy && !failed && isWriteDiff && Boolean(diff?.newText));
  const showEditPreview = $derived(!busy && !failed && isEditDiff && Boolean(diff));
  /** SEARCH / LIST / FETCH / other — single-line tail, not a code preview. */
  const showTail = $derived(
    !open &&
      !busy &&
      !failed &&
      !diff &&
      !terminal &&
      block.toolKind !== 'read' &&
      Boolean(tail),
  );
  const showTerminalOut = $derived(terminal && !failed && Boolean(body));
  const showExpandedBody = $derived(
    open &&
      !failed &&
      !diff &&
      !terminal &&
      block.toolKind !== 'read' &&
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

  /** Measure whether the single-line command is actually ellipsised. */
  $effect(() => {
    const el = cmdEl;
    const cmd = command;
    if (!el || !cmd || !terminal) {
      cmdTruncated = false;
      return;
    }
    const check = () => {
      cmdTruncated = el.scrollWidth > el.clientWidth + 1;
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  });

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

  function toggleCmdExpand() {
    cmdExpanded = !cmdExpanded;
  }
</script>

<div class="tool" class:stacked class:failed>
  <div class="tool-row">
    <div class="verb-col" class:icon-only={terminal}>
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
        onclick={() => onOpenPath(filePath, openLine)}
      >
        {middleEllipsis(shortPath)}
      </button>
    {:else if terminal && command}
      <button
        type="button"
        class="target terminal-cmd"
        class:expandable={cmdTruncated || cmdExpanded}
        title={command}
        bind:this={cmdEl}
        onclick={() => {
          if (cmdTruncated || cmdExpanded) toggleCmdExpand();
        }}
        aria-expanded={cmdTruncated || cmdExpanded ? cmdExpanded : undefined}
        aria-label={
          cmdTruncated || cmdExpanded
            ? cmdExpanded
              ? 'Collapse full command'
              : 'Show full command'
            : undefined
        }
      >
        <span class="sigil">$</span>
        {command}
      </button>
    {:else}
      <span class="target" title={displayTarget || undefined}>{displayTarget}</span>
    {/if}

    <div class="actions">
      {#if terminal && command && (cmdTruncated || cmdExpanded)}
        <button
          type="button"
          class="ghost-action"
          title={cmdExpanded ? 'Collapse full command' : 'Show full command'}
          aria-label={cmdExpanded ? 'Collapse full command' : 'Show full command'}
          onclick={toggleCmdExpand}
        >
          {cmdExpanded ? 'collapse' : 'expand'}
        </button>
      {/if}
      {#if isEditDiff}
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
          onclick={() => onOpenPath(filePath, openLine)}>open</button
        >
      {/if}
    </div>
  </div>

  {#if failed && block.error}
    <div class="error-line">{block.error}</div>
  {/if}

  {#if terminal && command && cmdExpanded}
    <div class="cmd-full">
      <span class="sigil">$</span>
      {command}
    </div>
  {/if}

  {#if showTail}
    <button type="button" class="subrow tail" title={tail} onclick={() => (manual = true)}>
      {tail}
    </button>
  {/if}

  {#if showWritePreview && diff}
    <div class="preview-body">
      <CodePreview text={diff.newText} maxRows={PREVIEW_MAX_ROWS} expandable={false} />
    </div>
  {/if}

  {#if showEditPreview && diff && diffStats}
    <div class="subrow edit-meta">
      <span class="diff-counts">
        <span class="diff-add">+{diffStats.added}</span>
        <span class="diff-del">−{diffStats.removed}</span>
      </span>
    </div>
    <div class="preview-body">
      <DiffView oldText={diff.oldText} newText={diff.newText} maxRows={PREVIEW_MAX_ROWS} preview />
    </div>
  {/if}

  {#if showTerminalOut}
    <div class="preview-body">
      <pre class="terminal-out" class:expanded={outputExpanded}>{body}</pre>
      {#if body.split('\n').length > 8 || body.length > 600}
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
    <div class="preview-body">
      {#if body}
        <!-- This branch *is* the expanded view — the row's own tail is what collapsed looks like. -->
        <pre class="terminal-out expanded">{body}</pre>
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

  /*
   * A terminal row has an icon, not a verb, so the 56px verb slot was empty space between the
   * icon and the command. Shrink the column to the icon and give those pixels to the command,
   * which is the row that most needs the width.
   */
  .verb-col.icon-only {
    flex: 0 0 24px;
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

  /* Command target is a button so keyboard users can expand a truncated command. */
  button.target.terminal-cmd {
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--text);
    font-weight: 500;
    cursor: default;
  }

  button.target.terminal-cmd.expandable {
    cursor: pointer;
  }

  button.target.terminal-cmd:focus-visible {
    outline: none;
    background-color: var(--bg-hover);
    box-shadow: inset 2px 0 0 var(--focus);
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

  /*
   * SEARCH/LIST single-line tails still sit under the path column. Preview boxes
   * (code / diff / terminal) are full transcript width — no 74px indent.
   */
  .subrow {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding-left: 74px;
    margin-top: 4px;
    font-size: 11.5px;
    min-width: 0;
  }

  .subrow.edit-meta {
    padding-left: 0;
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
    overflow-wrap: anywhere;
  }

  /* Full-width previews — verb column is header-only. */
  .preview-body {
    margin-top: var(--space-2);
    min-width: 0;
  }

  .cmd-full {
    margin-top: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--bg-inset);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text);
    min-width: 0;
  }

  .terminal-out {
    margin: 0;
    /* A peek — roughly eight lines, matching the code preview's row cap. */
    max-height: 9rem;
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
