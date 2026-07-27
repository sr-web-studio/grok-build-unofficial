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
  <div class="stats">
    <span class="add">+{result.added}</span>
    <span class="del">-{result.removed}</span>
    {#if result.coarse}<span class="coarse">whole-file replace</span>{/if}
  </div>
  <div class="rows">
    {#each visible as row, i (i)}
      {#if row.type === 'gap'}
        <div class="row gap"><span class="gutter"></span><span class="text">{row.text}</span></div>
      {:else}
        <div class="row {row.type}">
          <span class="gutter">{row.oldLine ?? ''}</span>
          <span class="gutter">{row.newLine ?? ''}</span>
          <span class="sign">{row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}</span>
          <span class="text">{row.text || ' '}</span>
        </div>
      {/if}
    {/each}
  </div>
  {#if preview}
    {#if hidden > 0}
      <div class="more hint">+{hidden} more lines</div>
    {/if}
  {:else if hidden > 0}
    <button class="more" onclick={() => (expanded = true)}>Show {hidden} more lines</button>
  {:else if expanded && result.rows.length > maxRows}
    <button class="more" onclick={() => (expanded = false)}>Collapse</button>
  {/if}
</div>

<style>
  .diff {
    font-family: var(--gb-mono);
    font-size: 12px;
    border: 1px solid var(--gb-rule);
    border-radius: var(--gb-radius);
    overflow: hidden;
    background: var(--vscode-editor-background);
  }

  .stats {
    display: flex;
    gap: 9px;
    padding: 3px 9px;
    border-bottom: 1px solid var(--gb-rule);
    background: var(--gb-surface);
    font-size: 11.5px;
    font-weight: 700;
  }

  .add {
    color: var(--vscode-gitDecoration-addedResourceForeground, #4ec97b);
  }

  .del {
    color: var(--vscode-gitDecoration-deletedResourceForeground, #e15c5c);
  }

  .coarse {
    color: var(--gb-dim);
    font-weight: 400;
  }

  .row {
    display: flex;
    /* Long lines soft-wrap rather than scroll sideways. In a 300–380px sidebar a horizontal
       scrollbar hides the right half of every edit, and the diff is the one thing you have to
       read before approving it. The gutters stay pinned to the first visual row, so the wrapped
       remainder hangs under the code column and still reads as one line. */
    align-items: flex-start;
    line-height: 1.5;
  }

  .row.add {
    background: var(--vscode-diffEditor-insertedTextBackground, rgba(78, 201, 123, 0.14));
  }

  .row.del {
    background: var(--vscode-diffEditor-removedTextBackground, rgba(225, 92, 92, 0.14));
  }

  .row.gap {
    color: var(--gb-dim);
    background: var(--gb-surface);
    font-style: italic;
  }

  .gutter {
    flex: 0 0 3ch;
    text-align: right;
    padding-right: 0.5ch;
    color: var(--vscode-editorLineNumber-foreground);
    user-select: none;
    white-space: pre;
  }

  .sign {
    flex: 0 0 1.5ch;
    user-select: none;
    white-space: pre;
  }

  .text {
    flex: 1 1 auto;
    min-width: 0;
    padding-right: 0.6em;
    /* pre-wrap keeps the leading indentation; anywhere breaks the tokens that have no space in
       them at all (minified lines, long paths, base64) instead of forcing the row wider. */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* Flush left like every other label in the system, not centred across the card. */
  .more {
    display: block;
    width: 100%;
    text-align: left;
    padding: 4px 9px;
    border: none;
    border-top: 1px solid var(--gb-rule);
    border-radius: var(--gb-radius);
    background: var(--gb-surface);
    color: var(--gb-accent);
    cursor: pointer;
    font-family: inherit;
    font-size: 11.5px;
    font-weight: 700;
  }

  .more:hover {
    background: var(--vscode-list-hoverBackground);
  }

  /* Not a button: it must not light up on hover, or it reads as a second thing to click. */
  .more.hint {
    background: var(--gb-surface);
    color: var(--gb-dim);
    font-weight: 400;
    cursor: default;
  }
</style>
