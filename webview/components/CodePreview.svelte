<script lang="ts">
  /**
   * Always-visible code preview for READ and WRITE tool rows.
   * Dumb: text + row cap in, expand state local. No wrap — long lines scroll horizontally.
   */
  interface Props {
    text: string;
    /** Visible line count when collapsed. ~10–12 lines of 12.5px/1.55 mono. */
    maxRows?: number;
  }

  let { text, maxRows = 11 }: Props = $props();

  let expanded = $state(false);

  const lines = $derived(
    text.length === 0
      ? ['']
      : text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n'),
  );
  const overflows = $derived(lines.length > maxRows);
  const visible = $derived(expanded || !overflows ? lines : lines.slice(0, maxRows));
</script>

<div class="code-preview">
  <div class="scroll" class:capped={!expanded && overflows}>
    {#each visible as line, i (i)}
      <div class="line">
        <span class="num">{i + 1}</span>
        <span class="content">{line.length ? line : ' '}</span>
      </div>
    {/each}
  </div>
  {#if !expanded && overflows}
    <div class="fade" aria-hidden="true"></div>
  {/if}
  {#if overflows}
    <button
      type="button"
      class="toggle"
      title={expanded ? 'Collapse preview' : 'Expand preview'}
      aria-label={expanded ? 'Collapse preview' : 'Expand preview'}
      onclick={() => (expanded = !expanded)}
    >
      {expanded ? 'collapse' : 'expand'}
    </button>
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
    /* ~11 lines: 11 * 12.5 * 1.55 ≈ 213px; slice is the real cap. */
    max-height: calc(11 * 12.5px * 1.55);
  }

  .scroll:not(.capped) {
    max-height: none;
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
</style>
