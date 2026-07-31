<script lang="ts">
  import type { ThinkingBlock } from '../../src/shared/protocol';
  import Icon from './Icon.svelte';
  import Markdown from './Markdown.svelte';

  interface Props {
    block: ThinkingBlock;
    autoExpand: boolean;
  }

  let { block, autoExpand }: Props = $props();

  let manual = $state<boolean | null>(null);

  /** While streaming, follow the setting; once closed, collapse unless the user opened it. */
  const open = $derived(manual ?? (block.streaming && autoExpand));

  const seconds = $derived(block.durationMs ? Math.round(block.durationMs / 100) / 10 : undefined);
  const words = $derived(block.text.trim() ? block.text.trim().split(/\s+/).length : 0);
</script>

<div class="thinking" class:streaming={block.streaming}>
  <button class="head" type="button" onclick={() => (manual = !open)} aria-expanded={open}>
    <Icon name="sparkles" size={12} />
    <span class="title">{block.streaming ? 'Thinking…' : 'Thought'}</span>
    <span class="meta">
      {#if seconds !== undefined || words > 0}
        ·
        {#if seconds !== undefined}{seconds}s{/if}
        {#if seconds !== undefined && words > 0}
          ·
        {/if}
        {#if words > 0}{words} words{/if}
      {/if}
    </span>
    <span class="chev" class:closed={!open}><Icon name="chevron" size={12} /></span>
  </button>
  {#if open}
    <div class="body"><Markdown text={block.text} streaming={block.streaming} /></div>
  {/if}
</div>

<style>
  /* Level 0 — no card, no purple rail on the collapsed row. */
  .thinking {
    position: relative;
    z-index: 0;
    margin: 0;
    padding: var(--space-1) 0;
    color: var(--text-muted);
    min-width: 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    user-select: none;
  }

  .head:hover {
    color: var(--text);
  }

  .head :global(.icon) {
    color: var(--text-faint);
    flex: 0 0 auto;
  }

  .title {
    flex: 0 0 auto;
    font-style: italic;
  }

  .meta {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-faint);
    font-size: 11.5px;
  }

  .chev {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    margin-left: auto;
    color: var(--text-faint);
    transition: transform var(--dur-fast) var(--ease-standard);
  }

  .chev.closed {
    transform: rotate(-90deg);
  }

  /* Expanded body: muted aside with a 1px --border left rail only. */
  .body {
    margin-top: var(--space-2);
    padding-left: var(--space-3);
    border-left: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 12.5px;
    line-height: 1.65;
    max-height: 18em;
    overflow: auto;
  }

  .body :global(.md) {
    font-size: 12.5px;
    color: var(--text-muted);
  }

  .body :global(.md p) {
    color: var(--text-muted);
  }
</style>
