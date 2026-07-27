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
    <div class="body"><Markdown text={block.text} /></div>
  {/if}
</div>

<style>
  /* Dashed, so a train of thought never reads as a section rule. */
  .thinking {
    border-left: 2px dashed var(--gb-rule);
    padding-left: 9px;
    color: var(--gb-dim);
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
    transition: transform 0.12s ease;
  }

  .chev.closed {
    transform: rotate(-90deg);
  }

  .title {
    font-style: italic;
    font-weight: 600;
  }

  .meta {
    display: flex;
    gap: 4px;
    flex: 1 1 auto;
  }

  .body {
    font-size: 0.94em;
    opacity: 0.9;
    max-height: 28em;
    overflow: auto;
  }
</style>
