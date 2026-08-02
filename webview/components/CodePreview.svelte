<script lang="ts">
  /**
   * Always-visible code preview for WRITE tool rows.
   * Dumb: text + row cap in, expand state local. No wrap — long lines scroll horizontally.
   */
  interface Props {
    text: string;
    /** Visible line count when collapsed. */
    maxRows?: number;
    /** Real file line of `text`'s first line, so the gutter matches the editor. */
    startLine?: number;
    /**
     * When false the overflow is announced instead of offered. A write row already has `open`,
     * which shows the whole file in a real editor — a second way to read it inline only makes a
     * short answer look long, which is the thing the preview was meant to avoid.
     */
    expandable?: boolean;
  }

  let { text, maxRows = 8, startLine = 1, expandable = true }: Props = $props();

  let expanded = $state(false);

  const lines = $derived(
    text.length === 0
      ? ['']
      : text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n'),
  );
  const overflows = $derived(lines.length > maxRows);
  const canExpand = $derived(expandable && overflows);
  const visible = $derived(expanded || !overflows ? lines : lines.slice(0, maxRows));
  const hidden = $derived(lines.length - visible.length);
</script>

<div class="code-preview">
  <div class="scroll">
    {#each visible as line, i (i)}
      <div class="line">
        <span class="num">{i + startLine}</span>
        <span class="content">{line.length ? line : ' '}</span>
      </div>
    {/each}
  </div>
  {#if !expanded && overflows}
    <div class="fade" aria-hidden="true"></div>
  {/if}
  {#if canExpand}
    <button
      type="button"
      class="toggle"
      title={expanded ? 'Collapse preview' : 'Expand preview'}
      aria-label={expanded ? 'Collapse preview' : 'Expand preview'}
      onclick={() => (expanded = !expanded)}
    >
      {expanded ? 'collapse' : 'expand'}
    </button>
  {:else if overflows}
    <div class="toggle hint">+{hidden} more lines</div>
  {/if}
</div>

<style>
  .code-preview {
    position: relative;
    min-width: 0;
    background-color: var(--bg-inset);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .scroll {
    overflow-x: auto;
    overflow-y: hidden;
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--text);
    /*
     * No max-height. The row slice above is the cap, and a pixel cap on top of it clipped the
     * last line whenever a horizontal scrollbar claimed a few pixels inside the box.
     */
  }

  .line {
    display: flex;
    align-items: flex-start;
    white-space: pre;
    min-width: min-content;
  }

  .num {
    width: 28px;
    min-width: 28px;
    text-align: right;
    padding: 0 6px 0 8px;
    color: var(--text-faint);
    user-select: none;
    flex-shrink: 0;
  }

  .content {
    flex: 1 0 auto;
    padding-right: 8px;
    min-width: 0;
  }

  .fade {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 28px;
    height: 28px;
    pointer-events: none;
    background: linear-gradient(to bottom, transparent, var(--bg-inset));
  }

  .toggle {
    display: block;
    width: 100%;
    text-align: left;
    padding: 4px 9px;
    border: none;
    border-top: 1px solid var(--border);
    background: var(--bg);
    /* Same muted register as the row's own `open` / `diff` actions — this used to be accent blue,
       which made the preview toggle shout louder than the buttons above it. */
    color: var(--text-muted);
    cursor: pointer;
    font-family: var(--font-ui);
    font-size: 11.5px;
    font-weight: 500;
    line-height: 1.2;
  }

  .toggle:hover,
  .toggle:focus-visible {
    background: var(--bg-hover);
    color: var(--text);
  }

  .toggle.hint {
    color: var(--text-faint);
    font-weight: 400;
    cursor: default;
  }

  .toggle.hint:hover {
    background: var(--bg);
    color: var(--text-faint);
  }
</style>
