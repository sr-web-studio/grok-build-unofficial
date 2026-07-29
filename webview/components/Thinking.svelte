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
  <button class="head" onclick={() => (manual = !open)} aria-expanded={open}>
    <Icon name="sparkles" size={13} />
    <span class="title">{block.streaming ? 'Thinking…' : 'Thought'}</span>
    <span class="meta gb-meta">
      {#if seconds !== undefined}{seconds}s{/if}
      {#if seconds !== undefined && words > 0}·{/if}
      {#if words > 0}{words} words{/if}
    </span>
    <span class="chev" class:closed={!open}><Icon name="chevron" size={13} /></span>
  </button>
  {#if open}
    <div class="body"><Markdown text={block.text} streaming={block.streaming} /></div>
  {/if}
</div>

<style>
  /*
   * Own a solid surface so expanded thought never paints over the following "Grok" bubble
   * (stacking/overlap in the narrow sidebar).
   */
  .thinking {
    position: relative;
    z-index: 0;
    /* Vertical margin owned by transcript stack / nested-think — avoid double gaps. */
    margin: 0;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--gb-think) 22%, var(--gb-rule));
    border-left: 3px dashed var(--gb-rule);
    border-radius: var(--gb-radius);
    background: color-mix(in srgb, var(--gb-think) 8%, var(--vscode-editor-background));
    color: var(--gb-dim);
    isolation: isolate;
  }

  .thinking.streaming {
    border-left-color: var(--gb-think);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 1px 0;
    border: none;
    border-radius: var(--gb-radius);
    background: none;
    color: inherit;
    font: inherit;
    font-size: 0.9em;
    text-align: left;
    cursor: pointer;
  }

  .head:hover {
    color: var(--vscode-foreground);
  }

  .chev {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    transition: transform 0.12s ease;
  }

  .chev.closed {
    transform: rotate(-90deg);
  }

  .title {
    flex: 0 0 auto;
    font-style: italic;
    font-weight: 600;
  }

  .meta {
    display: flex;
    gap: 4px;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
  }

  .body {
    margin-top: 10px;
    font-size: 0.94em;
    opacity: 0.9;
    max-height: 18em;
    overflow: auto;
    line-height: 1.65;
  }
</style>
