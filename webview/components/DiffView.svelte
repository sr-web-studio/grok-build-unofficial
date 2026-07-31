<script lang="ts">
  import { lineDiff } from '../diff';

  interface Props {
    oldText: string | null;
    newText: string;
    /** Collapsed views cap the height and hide the rest behind a toggle. */
    maxRows?: number;
    /**
     * Preview mode: the card above already owns the expand gesture, so the rest of the diff is
     * announced rather than offered — a second "show more" button inside a peek reads as clutter
     * and steals the click that should have opened the whole card.
     */
    preview?: boolean;
  }

  let { oldText, newText, maxRows = 40, preview = false }: Props = $props();

  const result = $derived(lineDiff(oldText, newText));
  let expanded = $state(false);
  const visible = $derived(expanded && !preview ? result.rows : result.rows.slice(0, maxRows));
  const hidden = $derived(result.rows.length - visible.length);
</script>

<div class="diff">
  {#if result.coarse}
    <div class="coarse-note">whole-file replace</div>
  {/if}
  <div class="rows">
    {#each visible as row, i (i)}
      {#if row.type === 'gap'}
        <div class="line gap">
          <!-- Gutter-span is flex: 0 0 auto so @@ markers are not clamped to 56px and overflow. -->
          <span class="gutter-span">{row.text}</span>
          {#if hidden > 0 && preview}
            <span class="gap-label">Show more unchanged lines</span>
          {/if}
        </div>
      {:else}
        <div class="line {row.type}">
          <span class="num old">{row.oldLine ?? ''}</span>
          <span class="num new">{row.newLine ?? ''}</span>
          <span class="content">{row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}{row.text || ' '}</span>
        </div>
      {/if}
    {/each}
  </div>
  {#if preview}
    {#if hidden > 0}
      <div class="more hint">+{hidden} more lines</div>
    {/if}
  {:else if hidden > 0}
    <button
      type="button"
      class="more"
      title="Expand full diff"
      aria-label="Expand full diff"
      onclick={() => (expanded = true)}
    >
      expand
    </button>
  {:else if expanded && result.rows.length > maxRows}
    <button
      type="button"
      class="more"
      title="Collapse diff"
      aria-label="Collapse diff"
      onclick={() => (expanded = false)}
    >
      collapse
    </button>
  {/if}
</div>

<style>
  .diff {
    background-color: var(--bg-inset);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    overflow: hidden;
    min-width: 0;
  }

  .coarse-note {
    padding: 4px var(--space-2);
    font-size: 11px;
    color: var(--text-faint);
    border-bottom: 1px solid var(--border);
  }

  .line {
    display: flex;
    align-items: flex-start;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .line.add {
    background-color: var(--diff-add-bg);
    color: var(--diff-add-text);
  }

  .line.del {
    background-color: var(--diff-del-bg);
    color: var(--diff-del-text);
  }

  .line.same,
  .line.ctx {
    color: var(--text);
  }

  .num {
    width: 28px;
    min-width: 28px;
    text-align: right;
    padding-right: 6px;
    color: var(--text-faint);
    user-select: none;
    flex-shrink: 0;
    white-space: nowrap;
    font-family: var(--font-mono);
  }

  .num.new {
    padding-right: 8px;
  }

  .content {
    flex: 1;
    padding-left: 6px;
    padding-right: 8px;
    min-width: 0;
    /* pre-wrap keeps leading indentation; anywhere breaks unbreakable tokens. */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .line.gap {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 4px 0;
    font-size: 11px;
    font-style: italic;
    color: var(--text-faint);
    background-color: var(--bg);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
  }

  /*
   * The @@ / gap marker spans both gutter columns, so it must size to its own text
   * instead of being clamped to a fixed gutter and overflowing onto the content.
   */
  .gutter-span {
    flex: 0 0 auto;
    padding-left: 6px;
    text-align: left;
    color: var(--text-faint);
    user-select: none;
    font-family: var(--font-mono);
    white-space: nowrap;
    font-style: normal;
  }

  .gap-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding-left: 0;
  }

  .more {
    display: block;
    width: 100%;
    text-align: left;
    padding: 4px 9px;
    border: none;
    border-top: 1px solid var(--border);
    background: var(--bg);
    color: var(--accent);
    cursor: pointer;
    font-family: inherit;
    font-size: 11.5px;
    font-weight: 500;
  }

  .more:hover {
    background: var(--bg-hover);
  }

  .more.hint {
    color: var(--text-faint);
    font-weight: 400;
    cursor: default;
  }
</style>
