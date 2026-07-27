<script lang="ts">
  import type { ToolCallContent, ToolKind } from '../../src/acp/types';
  import type { ToolBlock } from '../../src/shared/protocol';
  import DiffView from './DiffView.svelte';
  import Icon, { type IconName } from './Icon.svelte';

  /** One glyph per tool kind; anything unmapped falls back to the generic file icon. */
  const kindIcons: Partial<Record<ToolKind | 'unknown', IconName>> = {
    execute: 'terminal',
    edit: 'edit',
    write: 'edit',
    delete: 'edit',
    move: 'edit',
    search: 'search',
    list: 'list',
    fetch: 'search',
    think: 'sparkles',
  };

  interface Props {
    block: ToolBlock;
    cwd?: string;
    onOpenPath: (path: string, line?: number) => void;
    onOpenDiff: (blockId: string) => void;
    /** True when the card directly above is also a tool card, so the two share one border. */
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
  const target = $derived(command ?? (filePath ? shorten(filePath, cwd) : undefined) ?? query ?? '');

  const running = $derived(block.status === 'pending' || block.status === 'in_progress');
  /*
   * Only failures open themselves now. grok fires tool calls faster than they can be read, and a
   * self-expanding console for every one of them pushed the conversation off the screen — the
   * collapsed card carries a one-line tail instead, which is enough to follow along.
   */
  const autoOpen = $derived(block.status === 'failed');
  const open = $derived(manual ?? autoOpen);

  const body = $derived(live || output);
  /**
   * One line of what the tool produced, for the collapsed card.
   *
   * A command is summed up by where it ended, so that gets the last line. A read or a search is
   * summed up by what it found, so those get the first — the last line of a file is usually a
   * lone closing brace, which tells you nothing about what was read.
   */
  const tail = $derived.by(() => {
    const lines = body
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.length > 0);
    return (terminal ? lines.at(-1) : lines[0]) ?? '';
  });
  /**
   * While the tool is still running, keep the card one fixed-height header row. Peek/tail/diff
   * previews only appear after completion — mid-flight content thrash (empty → first line →
   * multi-line) is what made tool cards feel artificial.
   */
  const showPeek = $derived(!open && !running && Boolean(diff));
  const showTail = $derived(!open && !running && !diff && Boolean(tail));
  const hasBody = $derived(Boolean(diff) || body.length > 0 || Object.keys(input).length > 0);
  const icon = $derived(kindIcons[block.toolKind] ?? 'file');
  /** Terminal output gets the console treatment; anything else stays in the editor's code block. */
  const terminal = $derived(block.toolKind === 'execute');

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

  function shorten(p: string, root?: string): string {
    if (!root) return p;
    const normalized = p.replace(/\\/g, '/');
    const base = root.replace(/\\/g, '/').replace(/\/$/, '');
    return normalized.toLowerCase().startsWith(base.toLowerCase() + '/')
      ? normalized.slice(base.length + 1)
      : normalized;
  }
</script>

<div class="tool" class:failed={block.status === 'failed'} class:stacked>
  <div class="head">
    <button class="toggle" onclick={() => (manual = !open)} disabled={!hasBody} aria-expanded={open}>
      <span class="status" class:running>
        {#if running}
          <span class="spinner"></span>
        {:else if block.status === 'failed'}
          <Icon name="close" size={13} />
        {:else}
          <Icon name={icon} size={13} />
        {/if}
      </span>
      <span class="label gb-kicker">{block.label}</span>
      <span class="target" title={target || undefined}>{target}</span>
      {#if block.waiting}<span class="gb-tag">waiting</span>{/if}
      {#if !block.readOnly}<span class="gb-tag mutating">writes</span>{/if}
    </button>
    {#if diff}
      <button class="open" title="Open this edit in the diff editor" onclick={() => onOpenDiff(block.id)}
        >diff</button
      >
    {/if}
    {#if filePath}
      <button
        class="open"
        title="Open {filePath}"
        onclick={() => onOpenPath(filePath, block.locations[0]?.line)}>open</button
      >
    {/if}
  </div>

  <!-- Preview only after the tool finishes — in-flight cards stay a single stable header row. -->
  {#if showPeek && diff}
    <button class="peek" onclick={() => (manual = true)} aria-label="Expand this edit">
      <DiffView oldText={diff.oldText} newText={diff.newText} maxRows={6} preview />
    </button>
  {:else if showTail}
    <div class="tail" title={tail}>{tail}</div>
  {/if}

  {#if open}
    <div class="body">
      {#if diff}
        <DiffView oldText={diff.oldText} newText={diff.newText} />
      {/if}
      <!-- The header truncates the command to one line, so an expanded run-command card repeats it
           in full above its output. Otherwise the console block is all you see and the command
           reads as a footnote *below* what it produced. -->
      {#if terminal && command}
        <pre class="cmd">{command}</pre>
      {/if}
      {#if body}
        <pre class="out" class:terminal>{body}</pre>
      {/if}
      {#if !diff && !body && Object.keys(input).length > 0}
        <pre class="out dim">{JSON.stringify(input, null, 2)}</pre>
      {/if}
      {#if block.error}
        <div class="err">{block.error}</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tool {
    border: 1px solid var(--gb-rule);
    border-radius: var(--gb-radius);
    background: var(--gb-surface);
    overflow: hidden;
  }

  .tool.failed {
    border-color: var(--gb-danger);
  }

  /*
   * Runs of tool calls are drawn as one block with shared rules instead of a ladder of separate
   * boxes. Same information, a third of the lines — which is what made a fast burst unreadable.
   * Transcript closes the gap; this side only drops the doubled rule.
   */
  .tool.stacked {
    border-top: none;
  }

  .head {
    display: flex;
    align-items: stretch;
  }

  .toggle {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    padding: 6px 9px;
    border: none;
    background: none;
    color: var(--vscode-foreground);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .toggle:disabled {
    cursor: default;
  }

  .toggle:hover:not(:disabled) {
    background: var(--vscode-list-hoverBackground);
  }

  .status {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    color: var(--gb-accent);
  }

  .tool.failed .status {
    color: var(--gb-danger);
  }

  .status.running {
    color: var(--gb-accent);
  }

  /*
   * Spinner is intentionally a bit louder than the rest of the chrome — write/search calls can
   * finish in a blink, so the in-flight state needs to be obvious while it lasts.
   */
  .spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid color-mix(in srgb, var(--gb-accent) 35%, transparent);
    border-top-color: var(--gb-accent);
    border-radius: 50%;
    animation: spin 0.65s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .tool:has(.status.running) {
    border-color: color-mix(in srgb, var(--gb-accent) 45%, var(--gb-rule));
  }

  .label {
    flex: 0 0 auto;
    min-width: 4.5em;
  }

  /* Always reserve the target slot so path/query arriving a beat later does not reflow the head. */
  .target {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 1.2em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--gb-dim);
    font-family: var(--gb-mono);
    font-size: 0.9em;
  }

  .target:empty::after {
    content: '\00a0';
  }

  .mutating {
    background: color-mix(in srgb, var(--gb-warn) 22%, transparent);
    color: var(--vscode-foreground);
  }

  /* Flush right against the card edge, split off by a rule — the design's "open" affordance. */
  .open {
    flex: 0 0 auto;
    border: none;
    border-left: 1px solid var(--gb-rule);
    border-radius: var(--gb-radius);
    background: none;
    color: var(--gb-accent);
    font: inherit;
    font-size: 11px;
    font-weight: 700;
    padding: 0 11px;
    cursor: pointer;
  }

  .open:hover {
    background: var(--vscode-list-hoverBackground);
  }

  /*
   * The preview is the whole click target — the point is that a glance at the change is always
   * there and expanding it never needs aim. It carries no chrome of its own so it reads as part
   * of the card rather than a control sitting inside one.
   */
  .peek {
    display: block;
    width: 100%;
    padding: 0 9px 8px;
    border: none;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .peek:hover {
    background: var(--vscode-list-hoverBackground);
  }

  /* One line of what the tool is producing, clipped — enough to follow a fast run, no more. */
  .tail {
    padding: 0 9px 6px 29px;
    color: var(--gb-dim);
    font-family: var(--gb-mono);
    font-size: 11px;
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 7px 9px 8px;
    border-top: 1px solid var(--gb-rule);
  }

  /* Prompt-marked and accent-ruled so the command reads as input, not as more output. */
  .cmd {
    margin: 0;
    padding: 5px 8px 5px 6px;
    border-left: 2px solid var(--gb-accent);
    background: var(--gb-surface-sunken);
    border-radius: var(--gb-radius);
    font-family: var(--gb-mono);
    font-size: 11.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .cmd::before {
    content: '$ ';
    color: var(--gb-accent);
    font-weight: 700;
  }

  .out {
    margin: 0;
    max-height: 220px;
    overflow: auto;
    padding: 7px 8px;
    background: var(--gb-surface-sunken);
    border-radius: var(--gb-radius);
    font-family: var(--gb-mono);
    font-size: 11.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /*
   * Command output belongs on a console ground, not the editor's code-block tint — but the mock's
   * hardcoded near-black would be a hole in a light theme, so it comes from the terminal's own
   * theme colours and lands right in both.
   */
  .out.terminal {
    background: var(--vscode-terminal-background, var(--vscode-panel-background, var(--gb-surface-sunken)));
    color: var(--vscode-terminal-foreground, inherit);
  }

  .out.dim {
    color: var(--gb-dim);
  }

  .err {
    color: var(--gb-danger);
    font-size: 0.9em;
  }
</style>
